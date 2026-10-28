/**
 * A small discrete-event simulation kernel.
 *
 * - Virtual time in milliseconds; events run in time order (ties in scheduling order).
 * - Processes are generator functions that `yield` a Signal and are resumed with its value,
 *   so a request handler reads like normal sequential code:
 *       const ok = yield inst.threads.acquire();
 *       yield sim.sleep(12);
 *       const res = yield call(db, req);
 * - Resources are FIFO server pools (threads, CPU cores, DB connections) with
 *   time-weighted busy/queue statistics.
 */

export type Proc<T = unknown> = Generator<Signal<any>, T, any>;

/** A value that becomes available once (like a promise, but resolved synchronously in sim time). */
export class Signal<T = void> {
  done = false;
  value!: T;
  private cbs: ((v: T) => void)[] | null = null;

  resolve(v: T): void {
    if (this.done) return;
    this.done = true;
    this.value = v;
    const cbs = this.cbs;
    this.cbs = null;
    if (cbs) for (const cb of cbs) cb(v);
  }

  on(cb: (v: T) => void): void {
    if (this.done) cb(this.value);
    else (this.cbs ??= []).push(cb);
  }

  static of<T>(v: T): Signal<T> {
    const s = new Signal<T>();
    s.resolve(v);
    return s;
  }
}

interface Ev {
  t: number;
  seq: number;
  /** Either a callback or a signal to resolve (sleeps: no closure needed). */
  fn: (() => void) | null;
  sig: Signal<void> | null;
}

/** Timeouts of one length expire in the order they were set, so each length gets a FIFO line instead of heap entries. */
interface TimeoutLine {
  items: { t: number; out: Signal<any>; v: unknown }[];
  head: number;
  armed: boolean;
}

export class Sim {
  now = 0;
  private heap: Ev[] = [];
  private seq = 0;
  /** Events processed (for performance checks). */
  events = 0;

  private timeoutLines = new Map<number, TimeoutLine>();

  at(t: number, fn: () => void): void {
    this.push({ t: Math.max(t, this.now), seq: this.seq++, fn, sig: null });
  }

  private push(ev: Ev): void {
    const h = this.heap;
    h.push(ev);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(h[p], ev)) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = ev;
  }

  after(ms: number, fn: () => void): void {
    this.at(this.now + ms, fn);
  }

  sleep(ms: number): Signal<void> {
    if (ms <= 0) return DONE;
    const s = new Signal<void>();
    this.push({ t: this.now + ms, seq: this.seq++, fn: null, sig: s });
    return s;
  }

  /** Runs events until `until` (exclusive) or until nothing is left. */
  run(until: number): void {
    const h = this.heap;
    while (h.length) {
      const top = h[0];
      if (top.t >= until) break;
      const last = h.pop()!;
      if (h.length) {
        // sift down
        let i = 0;
        const n = h.length;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= n) break;
          const r = l + 1;
          const c = r < n && less(h[r], h[l]) ? r : l;
          if (less(last, h[c])) break;
          h[i] = h[c];
          i = c;
        }
        h[i] = last;
      }
      this.now = top.t;
      this.events++;
      if (top.sig) top.sig.resolve();
      else top.fn!();
    }
    this.now = Math.max(this.now, until);
  }

  /** Starts a process; the returned signal resolves with its return value. */
  spawn<T>(gen: Proc<T>): Signal<T> {
    const out = new Signal<T>();
    const step = (input: unknown) => {
      let v: unknown = input;
      for (;;) {
        const r = gen.next(v);
        if (r.done) {
          out.resolve(r.value);
          return;
        }
        const sig = r.value;
        if (sig.done) {
          v = sig.value;
          continue;
        }
        sig.on(step);
        return;
      }
    };
    step(undefined);
    return out;
  }

  /** Resolves with the signal's value, or with `onTimeout` after `ms` (whichever comes first). */
  race<T, U>(sig: Signal<T>, ms: number, onTimeout: U): Signal<T | U> {
    if (sig.done || !(ms < Infinity)) return sig as Signal<T | U>;
    const out = new Signal<T | U>();
    sig.on((v) => out.resolve(v));
    let line = this.timeoutLines.get(ms);
    if (!line) this.timeoutLines.set(ms, (line = { items: [], head: 0, armed: false }));
    line.items.push({ t: this.now + ms, out, v: onTimeout });
    if (!line.armed) this.arm(line);
    return out;
  }

  private arm(line: TimeoutLine): void {
    // skip timeouts whose race is already over
    while (line.head < line.items.length && line.items[line.head].out.done) line.head++;
    if (line.head > 4096 && line.head * 2 > line.items.length) {
      line.items = line.items.slice(line.head);
      line.head = 0;
    }
    if (line.head >= line.items.length) {
      line.armed = false;
      return;
    }
    line.armed = true;
    this.at(line.items[line.head].t, () => {
      while (line.head < line.items.length && line.items[line.head].t <= this.now) {
        const it = line.items[line.head++];
        it.out.resolve(it.v);
      }
      this.arm(line);
    });
  }
}

function less(a: Ev, b: Ev): boolean {
  return a.t < b.t || (a.t === b.t && a.seq < b.seq);
}

/**
 * A pool of `capacity` identical servers with a FIFO waiting line of at most `maxQueue`.
 * `acquire()` resolves true when a slot is granted, false when the line is full (rejected).
 */
export class Resource {
  busy = 0;
  private q: Signal<boolean>[] = [];
  private qHead = 0;
  // time-weighted statistics
  private lastT = 0;
  busyArea = 0;
  queueArea = 0;
  maxQueueSeen = 0;
  rejected = 0;
  granted = 0;

  constructor(
    private sim: Sim,
    public capacity: number,
    public maxQueue = Infinity,
  ) {
    this.lastT = sim.now;
  }

  get queued(): number {
    return this.q.length - this.qHead;
  }

  private tick(): void {
    const dt = this.sim.now - this.lastT;
    if (dt > 0) {
      this.busyArea += dt * Math.min(this.busy, this.capacity);
      this.queueArea += dt * this.queued;
      this.lastT = this.sim.now;
    }
  }

  acquire(): Signal<boolean> {
    this.tick();
    if (this.busy < this.capacity) {
      this.busy++;
      this.granted++;
      return GRANTED;
    }
    if (this.queued >= this.maxQueue) {
      this.rejected++;
      return REJECTED;
    }
    const s = new Signal<boolean>();
    this.q.push(s);
    if (this.queued > this.maxQueueSeen) this.maxQueueSeen = this.queued;
    return s;
  }

  release(): void {
    this.tick();
    if (this.queued > 0 && this.busy <= this.capacity) {
      const next = this.q[this.qHead++];
      if (this.qHead > 1024 && this.qHead * 2 > this.q.length) {
        this.q = this.q.slice(this.qHead);
        this.qHead = 0;
      }
      this.granted++;
      // hand the slot over in a fresh event (keeps the call stack flat)
      this.sim.at(this.sim.now, () => next.resolve(true));
    } else {
      this.busy--;
    }
  }

  /** Changes the number of servers (autoscaling, vertical resize). Waiters are let in if room appears. */
  resize(capacity: number): void {
    this.tick();
    this.capacity = capacity;
    while (this.busy < this.capacity && this.queued > 0) {
      this.busy++;
      const next = this.q[this.qHead++];
      this.granted++;
      this.sim.at(this.sim.now, () => next.resolve(true));
    }
  }

  /** Rejects everyone waiting (the server died). */
  failWaiters(): void {
    this.tick();
    while (this.queued > 0) {
      const next = this.q[this.qHead++];
      this.rejected++;
      this.sim.at(this.sim.now, () => next.resolve(false));
    }
  }

  /** Time-averaged busy servers and queue length since `from` (call `snapshot` to reset). */
  stats(): { busyArea: number; queueArea: number } {
    this.tick();
    return { busyArea: this.busyArea, queueArea: this.queueArea };
  }
}

const DONE = Signal.of<void>(undefined);
const GRANTED = Signal.of(true);
const REJECTED = Signal.of(false);
