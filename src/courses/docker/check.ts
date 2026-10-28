/**
 * Checks Docker-course answers: the learner's answer and the reference answer
 * run on identically prepared engines, then their states (and the output of
 * follow-up commands) are compared. Feedback says exactly what differs.
 */
import type { DockerSpec, Exercise, ProjectTask, SandboxEnv } from '../../content/types';
import { buildSteps, DockerEngine } from './engine';
import type { Line } from './engine/types';

export const PROJECT = '/home/learner/myapp';

export interface TranscriptEntry {
  cmd: string;
  lines: Line[];
  code: number;
}

export interface DockerOutcome {
  status: 'correct' | 'wrong' | 'error';
  feedback: string[];
  transcript: TranscriptEntry[];
  /** The learner's engine after the answer (for showing the result). */
  engine?: DockerEngine;
}

/** A fresh engine with the project files and setup commands applied. */
export function sandbox(env?: SandboxEnv, seed = 11): DockerEngine {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(env?.files ?? {})) files[k.startsWith('/') ? k : `${PROJECT}/${k}`] = v;
  const e = new DockerEngine({ seed, files, cwd: PROJECT });
  for (const c of env?.setup ?? []) e.exec(c);
  e.journal = [];
  return e;
}

/** Answer text → the commands it stands for. */
export function answerLines(answer: string): string[] {
  return answer
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function exec(e: DockerEngine, cmd: string, t: TranscriptEntry[]): TranscriptEntry {
  const r = e.exec(cmd);
  const entry = { cmd, lines: r.lines, code: r.exitCode };
  t.push(entry);
  return entry;
}

/** Apply an answer to an engine. Returns the transcript and whether the main step failed. */
export function applyAnswer(e: DockerEngine, spec: DockerSpec, answer: string): { transcript: TranscriptEntry[]; failed: TranscriptEntry | null } {
  const t: TranscriptEntry[] = [];
  let failed: TranscriptEntry | null = null;
  if (spec.target === 'commands') {
    for (const c of answerLines(answer)) {
      const r = exec(e, c, t);
      if (r.code !== 0 && !failed) failed = r;
    }
  } else if (spec.target === 'dockerfile') {
    e.files[`${PROJECT}/Dockerfile`] = answer.endsWith('\n') ? answer : answer + '\n';
    const r = exec(e, `docker build -t ${spec.tag ?? 'app'} .`, t);
    if (r.code !== 0) failed = r;
  } else {
    e.files[`${PROJECT}/compose.yaml`] = answer.endsWith('\n') ? answer : answer + '\n';
    const r = exec(e, 'docker compose up -d', t);
    if (r.code !== 0) failed = r;
  }
  if (!failed || spec.target === 'commands') for (const c of spec.after ?? []) exec(e, c, t);
  return { transcript: t, failed };
}

function makeNoise(names: string[]) {
  const nameRe = names.length ? new RegExp(`\\b(${names.join('|')})\\b`, 'g') : null;
  return (s: string) => {
    let t = s
      .replace(/sha256:[0-9a-f]{64}/g, '<digest>')
      .replace(/\b[0-9a-f]{64}\b/g, '<id>')
      .replace(/\b[0-9a-f]{12}\b/g, '<id>')
      .replace(/(Less than a second|About a minute|\d+ (seconds?|minutes?)) ago/g, '<ago>')
      .replace(/Up (Less than a second|About a minute|\d+ (seconds?|minutes?))/g, 'Up <t>')
      .replace(/\b172\.\d+\.0\.\d+\b/g, '<ip>');
    if (nameRe) t = t.replace(nameRe, '<name>');
    return t.replace(/ {2,}/g, '  ').replace(/\s+$/, '');
  };
}

/** What the answer's own commands printed (pull progress and pulls left out). */
function stdoutOf(t: TranscriptEntry[], noise: (s: string) => string): string[] {
  return t
    .filter((x) => !/^docker (image )?pull\b/.test(x.cmd))
    .flatMap((x) => x.lines.filter((l) => l.kind === 'out' || l.kind === 'err').map((l) => noise(l.text)))
    .filter((l) => l !== '');
}

function defaultsFor(spec: DockerSpec): NonNullable<DockerSpec['compare']> {
  if (spec.compare) return spec.compare;
  if (spec.target === 'dockerfile') return ['output'];
  if (spec.target === 'compose') return ['containers', 'volumes', 'networks', 'output'];
  return ['containers', 'images', 'volumes', 'networks', 'output'];
}

const statusWord = (c: { status: string; exitCode: number | null }) =>
  c.status === 'running' ? 'running' : c.status === 'exited' ? `Exited (${c.exitCode})` : c.status === 'restarting' ? 'Restarting' : 'Created (never started)';

type Snap = ReturnType<DockerEngine['snapshot']>;
type SnapC = Snap['containers'][number];

/** Differences between one of the learner's containers and the reference one. */
function compareContainer(label: string, mc: SnapC, rc: SnapC, out: string[]) {
  if (mc.attached && !rc.attached && mc.status === 'running') out.push(`${label} was started in the foreground, so it would hold your terminal. Add \`-d\` to run it in the background.`);
  if (mc.status !== rc.status) out.push(`${label} is ${statusWord(mc)} but should be ${statusWord(rc)}.`);
  else if (rc.status === 'exited' && mc.exitCode !== rc.exitCode) out.push(`${label} exited with code ${mc.exitCode}; expected ${rc.exitCode}.`);
  if (mc.image !== rc.image) out.push(`${label} runs \`${mc.image}\` but should run \`${rc.image}\`.`);
  else if (mc.cmd !== rc.cmd && rc.auto) out.push(`${label} runs the command \`${mc.cmd}\` instead of \`${rc.cmd}\`.`);
  if (JSON.stringify(mc.ports) !== JSON.stringify(rc.ports)) {
    const fmt = (p: string[]) => (p.length ? p.map((x) => `\`${x}\``).join(', ') : 'no ports');
    const reversed = rc.ports.length && mc.ports.length && mc.ports.some((p) => rc.ports.some((q) => p.replace(/(\d+)->(\d+)/, '$2->$1') === q));
    out.push(`${label} publishes ${fmt(mc.ports)} but should publish ${fmt(rc.ports)}${reversed ? ' (host port goes first: `-p HOST:CONTAINER`)' : ''}.`);
  }
  if (JSON.stringify(mc.mounts) !== JSON.stringify(rc.mounts)) out.push(`${label} mounts ${mc.mounts.map((m) => `\`${m}\``).join(', ') || 'nothing'} but should mount ${rc.mounts.map((m) => `\`${m}\``).join(', ') || 'nothing'}.`);
  const extraNet = mc.networks.filter((n) => !rc.networks.includes(n));
  const missNet = rc.networks.filter((n) => !mc.networks.includes(n));
  const nets = (l: string[]) => l.map((n) => `\`${n}\``).join(', ');
  if (missNet.length && extraNet.length) out.push(`${label} is on ${nets(extraNet)} but should be on ${nets(rc.networks)}.`);
  else if (missNet.length) out.push(`${label} is not on network${missNet.length > 1 ? 's' : ''} ${nets(missNet)}.`);
  else if (extraNet.length) out.push(`${label} is also on ${extraNet.map((n) => `\`${n}\``).join(', ')}, which wasn't asked for.`);
  const missEnv = rc.env.filter((x) => !mc.env.includes(x));
  if (missEnv.length) out.push(`${label} is missing the environment variable${missEnv.length > 1 ? 's' : ''} ${missEnv.map((x) => `\`${x}\``).join(', ')}.`);
  if (mc.restart !== rc.restart) out.push(`${label} has restart policy \`${mc.restart}\`; expected \`${rc.restart}\`.`);
}

/** Human-readable differences between the learner's engine and the reference. */
export function diffEngines(mine: DockerEngine, ref: DockerEngine, compare: NonNullable<DockerSpec['compare']>): string[] {
  const out: string[] = [];
  const a = mine.snapshot();
  const b = ref.snapshot();
  if (compare.includes('containers')) {
    const used = new Set<SnapC>();
    const take = (pred: (c: SnapC) => boolean) => {
      const c = a.containers.find((x) => !used.has(x) && pred(x));
      if (c) used.add(c);
      return c;
    };
    // Named containers first: they must match by name.
    for (const rc of b.containers.filter((c) => !c.auto)) {
      const mc = take((c) => c.name === rc.name);
      if (mc) {
        compareContainer(`\`${rc.name}\``, mc, rc, out);
        continue;
      }
      const other = take((c) => c.image === rc.image && !b.containers.some((x) => !x.auto && x.name === c.name));
      if (other) out.push(other.auto ? `Your ${rc.image} container got a random name, \`${other.name}\`; it should be named \`${rc.name}\`. Use \`--name ${rc.name}\`.` : `Your ${rc.image} container is named \`${other.name}\`; it should be named \`${rc.name}\`.`);
      else out.push(`There's no container called \`${rc.name}\`.`);
    }
    // Containers whose name Docker picked: match by image and command.
    for (const rc of b.containers.filter((c) => c.auto)) {
      const mc = take((c) => c.image === rc.image && c.cmd === rc.cmd) ?? take((c) => c.image === rc.image);
      if (mc) compareContainer(`Your \`${rc.image}\` container`, mc, rc, out);
      else out.push(`There should be a container from \`${rc.image}\`${rc.cmd ? ` running \`${rc.cmd}\`` : ''} (${statusWord(rc)}), but there isn't.`);
    }
    for (const mc of a.containers) if (!used.has(mc)) out.push(`There's an extra container \`${mc.name}\` (${mc.image}, ${statusWord(mc)}) that shouldn't be there.`);
  }
  if (compare.includes('images')) {
    for (const i of b.images) if (!a.images.includes(i)) out.push(`The image \`${i}\` should be on your machine but isn't.`);
    for (const i of a.images) if (!b.images.includes(i)) out.push(`The image \`${i}\` shouldn't be there.`);
  }
  if (compare.includes('volumes')) {
    for (const v of b.volumes) {
      const mv = a.volumes.find((x) => x.name === v.name);
      if (!mv) out.push(`There's no volume called \`${v.name}\`.`);
      else {
        const miss = v.files.filter((f) => !mv.files.includes(f));
        if (miss.length) out.push(`The volume \`${v.name}\` is missing ${miss.slice(0, 3).map((f) => `\`${f}\``).join(', ')}${miss.length > 3 ? '…' : ''}.`);
      }
    }
    for (const v of a.volumes) if (!b.volumes.some((x) => x.name === v.name)) out.push(`There's an extra volume \`${v.name}\`.`);
  }
  if (compare.includes('networks')) {
    for (const n of b.networks) if (!a.networks.includes(n)) out.push(`There's no network called \`${n}\`.`);
    for (const n of a.networks) if (!b.networks.includes(n)) out.push(`There's an extra network \`${n}\`.`);
  }
  return out;
}

export function evaluateDocker(item: Exercise, answer: string): DockerOutcome {
  const spec = item.docker;
  if (!spec) throw new Error(`${item.id} has no docker spec`);
  if (/___/.test(answer)) return { status: 'wrong', feedback: ['Fill in every ___ blank first.'], transcript: [] };
  if (!answer.trim()) return { status: 'wrong', feedback: ['Write your answer first!'], transcript: [] };
  const reference = 'solution' in item ? (item as { solution: string }).solution : 'blocks' in item ? (item as { blocks: string[] }).blocks.join('\n') : '';
  const mine = sandbox(spec);
  const ref = sandbox(spec);
  const r = applyAnswer(ref, spec, reference);
  if (r.failed && spec.target !== 'commands') throw new Error(`Reference answer of ${item.id} failed: ${r.failed.lines.map((l) => l.text).join('\n')}`);
  const m = applyAnswer(mine, spec, answer);
  const feedback: string[] = [];
  if (m.failed && spec.target !== 'commands') {
    const errs = m.failed.lines.filter((l) => l.kind === 'err').map((l) => l.text);
    const why = (spec.target === 'dockerfile' ? errs.find((l) => /^ERROR: /.test(l)) : errs.find((l) => l.trim() && !/^\s*Container \S+ Error$/.test(l)))?.replace(/^ERROR: failed to build: failed to solve: /, '').slice(0, 220);
    return { status: 'error', feedback: [spec.target === 'dockerfile' ? `The build failed${why ? `: ${why}` : '. Read the error at the end of the build output.'}` : `\`docker compose up\` failed${why ? `: ${why}` : '. Read the error message.'}`], transcript: m.transcript, engine: mine };
  }
  const compare = defaultsFor(spec);
  feedback.push(...diffEngines(mine, ref, compare));
  const noise = makeNoise([...mine.generatedNames, ...ref.generatedNames]);
  // The most telling line of some output: an error line if there is one, else the first.
  const first = (s: string) => {
    const lines = s.split('\n');
    const oci = /exec: "([^"]+)": executable file not found in \$PATH/.exec(s);
    if (oci) return `exec: "${oci[1]}": executable file not found in $PATH`;
    const err = lines.find((l) => /\b(Error|error|ERROR)\b|not found|[Cc]annot|can't|denied|refused|No such/.test(l));
    return ((err ?? lines[0]) || '(nothing)').slice(0, 140);
  };
  if (compare.includes('output')) {
    const outOf = (t: TranscriptEntry[], c: string) => t.filter((x) => x.cmd === c).pop();
    for (const c of spec.after ?? []) {
      const want = outOf(r.transcript, c);
      const got = outOf(m.transcript, c);
      if (!want || !got) continue;
      const w = want.lines.map((l) => noise(l.text));
      const g = got.lines.map((l) => noise(l.text));
      if (w.join('\n') !== g.join('\n') || want.code !== got.code) {
        // Show the first line that differs (pull progress and other shared lines are skipped).
        // A listing (ls, ps…) with a few extra or missing lines: name them.
        const extra = g.filter((l) => l && !w.includes(l));
        const missing = w.filter((l) => l && !g.includes(l));
        if (w.length > 2 && want.code === got.code && extra.length + missing.length <= 4 && extra.length + missing.length > 0) {
          const q = (xs: string[]) => xs.map((x) => `\`${x}\``).join(', ');
          if (extra.length) feedback.push(`After your answer, \`${c}\` also shows ${q(extra)}, which shouldn't be there.`);
          if (missing.length) feedback.push(`After your answer, \`${c}\` doesn't show ${q(missing)}.`);
          continue;
        }
        let i = 0;
        while (i < w.length && i < g.length && w[i] === g[i]) i++;
        if (i >= w.length && i >= g.length) i = 0;
        feedback.push(`After your answer, \`${c}\` gives \`${first(g.slice(i).join('\n'))}\`, but it should give \`${first(w.slice(i).join('\n'))}\`.`);
      }
    }
  }
  if (compare.includes('stdout')) {
    const w = stdoutOf(r.transcript, noise);
    const g = stdoutOf(m.transcript, noise);
    const i = w.findIndex((l, k) => g[k] !== l);
    if (i >= 0 || g.length > w.length) {
      const k = i >= 0 ? i : w.length;
      feedback.push(g[k] === undefined ? `Your commands should also print \`${w[k]}\`.` : w[k] === undefined ? `Your commands print more than expected, starting with \`${g[k]}\`.` : `Your commands print \`${g[k]}\` where \`${w[k]}\` was expected.`);
    }
  }
  if (spec.target === 'dockerfile' && spec.user !== undefined) {
    const img = mine.findImage(spec.tag ?? 'app');
    if (img && img.config.user !== spec.user) feedback.push(img.config.user ? `The image runs as \`${img.config.user}\`; it should run as \`${spec.user}\` (USER).` : `The image runs as **root**. Add \`USER ${spec.user}\` so the app runs without root rights.`);
  }
  if (spec.target === 'dockerfile' && spec.rebuild && !feedback.length) {
    const miss = rebuildMisses(mine, spec);
    if (miss.length) feedback.push(`After a change to \`${spec.rebuild.edit}\`, ${miss.map((m) => `\`${m}\``).join(' and ')} ran again instead of coming from the cache. Put the steps that don't need \`${spec.rebuild.edit}\` before the COPY that brings it in.`);
  }
  if (spec.target === 'dockerfile' && spec.maxSizeMb !== undefined) {
    const img = mine.findImage(spec.tag ?? 'app');
    if (img && img.size > spec.maxSizeMb) feedback.push(`Your image is ${Math.round(img.size)} MB; it should be under ${spec.maxSizeMb} MB.`);
  }
  if (spec.target === 'dockerfile' && spec.compare?.includes('config')) {
    const a = mine.findImage(spec.tag ?? 'app');
    const b = ref.findImage(spec.tag ?? 'app');
    if (a && b) {
      if (b.config.workdir && a.config.workdir !== b.config.workdir) feedback.push(`The image's working directory is \`${a.config.workdir || '/'}\`; expected \`${b.config.workdir}\` (WORKDIR).`);
      if (b.config.user && a.config.user !== b.config.user) feedback.push(`The image runs as \`${a.config.user || 'root'}\`; expected \`${b.config.user}\` (USER).`);
      const missPorts = b.config.exposed.filter((p) => !a.config.exposed.includes(p));
      if (missPorts.length) feedback.push(`The image doesn't EXPOSE ${missPorts.join(', ')}.`);
    }
  }
  if (feedback.length && m.failed && spec.target === 'commands') {
    const errLine = m.failed.lines.find((l) => l.kind === 'err')?.text ?? '';
    feedback.unshift(`\`${m.failed.cmd}\` failed${errLine ? `: ${errLine.slice(0, 160)}` : '.'}`);
  }
  return { status: feedback.length ? 'wrong' : 'correct', feedback, transcript: m.transcript, engine: mine };
}

/** Change a file, rebuild, and list the expected-cached steps that ran again. */
export function rebuildMisses(e: DockerEngine, spec: DockerSpec): string[] {
  if (!spec.rebuild) return [];
  const path = `${PROJECT}/${spec.rebuild.edit}`;
  e.files[path] = (e.files[path] ?? '') + (/\.(py|txt|sh|ya?ml)$/.test(path) ? '\n# a small change\n' : /\.html?$/.test(path) ? '\n<!-- a small change -->\n' : '\n// a small change\n');
  const r = e.exec(`docker build -t ${spec.tag ?? 'app'} .`);
  const steps = buildSteps(r.lines);
  return spec.rebuild.cached.filter((want) => !steps.some((s) => s.instr.startsWith(want) && s.cached));
}

/** Run an answer without checking it (the Run button). */
export function tryDocker(spec: DockerSpec, answer: string): { transcript: TranscriptEntry[]; engine: DockerEngine } {
  const e = sandbox(spec);
  const { transcript } = applyAnswer(e, spec, answer);
  return { transcript, engine: e };
}

export interface RequirementOutcome {
  ok: boolean;
  /** What the requirement's command printed (for "why not?"). */
  output: string;
}

/** Project tasks: run the learner's commands, then each requirement's check command on the same machine. */
export function checkDockerProject(task: ProjectTask, answer: string): { transcript: TranscriptEntry[]; engine: DockerEngine; requirements: RequirementOutcome[] } {
  const e = sandbox(task.docker);
  const { transcript } = applyAnswer(e, { target: 'commands', ...task.docker }, answer);
  const requirements = task.requirements.map((r) => {
    // Several lines: all run, the last one decides.
    let res = e.exec('true');
    let last = '';
    for (const line of answerLines(r.sql)) res = e.exec((last = line));
    // A build's step lines (CACHED…) are progress output, but they're what a cache requirement looks at.
    const build = /^docker (buildx )?build\b/.test(last);
    const output = res.lines.filter((l) => l.kind !== 'dim' || (build && /^#\d+ (\[(?!internal)|CACHED$)/.test(l.text))).map((l) => l.text).join('\n');
    const ok = res.exitCode === (r.code ?? 0) && (!r.expect || new RegExp(r.expect, 'm').test(output));
    return { ok, output };
  });
  return { transcript, engine: e, requirements };
}
