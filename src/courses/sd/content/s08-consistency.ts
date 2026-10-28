import type { Module } from '../../../content/types';
import type { Phase, ScenarioEvent, Traffic } from '../engine/types';

/**
 * A leaderless key-value store (Dynamo/Cassandra style): 3 copies, one per availability zone.
 * The app runs in zones a and c; at 10 s a network partition cuts zone c off from a and b.
 */
const KV = (w: number, r: number) => `components:
  users: { type: client }
  lb: { type: lb, azs: [a, c] }
  app: { type: app, instances: 2, size: medium, azs: [a, c] }
  db: { type: db, quorum: { n: 3, w: ${w}, r: ${r} }, azs: [a, b, c] }
connections:
  - users -> lb
  - lb -> app
  - app -> db: { timeoutMs: 500 }
`;
const SPLIT_T: Traffic = { rps: 400, mix: { read: 0.7, write: 0.3 }, keys: 1000 };
const SPLIT_EVENTS: ScenarioEvent[] = [
  { atMs: 10_000, action: 'partition', a: 'c', b: 'a' },
  { atMs: 10_000, action: 'partition', a: 'c', b: 'b' },
];
const SPLIT_PHASES: Phase[] = [{ name: 'split', fromMs: 11_000, toMs: 30_000 }];
const SPLIT_RUN = `traffic: { rps: 400, mix: { read: 0.7, write: 0.3 }, keys: 1000 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: partition, a: c, b: a }
  - { at: 10s, action: partition, a: c, b: b }
phases:
  - { name: split, from: 11s, to: 30s }
`;

/** The same store in one zone, with slow, uneven writes (log-normal), so some copies are often behind. */
const STORE = (w: number, r: number) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium }
  db: { type: db, size: large, writeMs: 20, dist: lognormal, quorum: { n: 3, w: ${w}, r: ${r} } }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;
const STORE_T: Traffic = { rps: 600, mix: { read: 0.6, write: 0.4 }, keys: 100 };
const STORE_RUN = `traffic: { rps: 600, mix: { read: 0.6, write: 0.4 }, keys: 100 }
run: { duration: 30s, warmup: 5s }
`;
const COPY_DOWN: ScenarioEvent[] = [{ atMs: 10_000, action: 'kill', node: 'db', instance: 2 }];

/** A classic leader (primary) with two async replicas; the primary dies at 10 s. */
const LEADER = (db: string) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium }
  db: { type: db, size: medium, replicas: 2, replicationLagMs: 200${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;
const CRASH_T: Traffic = { rps: 400, mix: { read: 0.5, write: 0.5 }, keys: 1000 };
const CRASH_EVENTS: ScenarioEvent[] = [{ atMs: 10_000, action: 'kill', node: 'db', instance: 0 }];
const AFTER: Phase[] = [{ name: 'after', fromMs: 15_000, toMs: 30_000 }];
const CRASH_RUN = `traffic: { rps: 400, mix: { read: 0.5, write: 0.5 }, keys: 1000 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: kill, node: db, instance: 0 }
phases:
  - { name: after, from: 15s, to: 30s }
`;

/** Module 8: consistency. Checked by tests/sd-content.test.ts. */
export const s08: Module = {
  id: 's08',
  number: 8,
  title: 'Consistency',
  tagline: 'CAP and PACELC, quorums, eventual consistency, leader election and failover: what “consistent” costs, and when to pay for it.',
  games: [],
  concepts: [
    {
      id: 's08-cap',
      title: 'CAP: when the network splits',
      card: `Data stored on several machines stays available when one dies. But machines talk over a network, and networks **partition**: a switch fails, a zone loses its link, and two groups of servers can't reach each other while both still serve users.

During a partition, a replicated system must choose (the **CAP theorem**):

- **Consistency (CP):** refuse requests that can't reach enough copies. Users on the cut-off side get errors, but nobody ever reads old data.
- **Availability (AP):** answer anyway from whatever copies are reachable. Everyone gets an answer, but some answers are out of date, and the two sides may disagree until the network heals.

You can't have both while partitioned. Partitions aren't optional (P is a fact of life), so the real question is which one *this data* needs: a bank balance, CP; a shopping cart or a like count, usually AP.

In the simulator: a \`quorum\` database keeps \`n\` copies; \`azs: [a, b, c]\` puts one in each zone, and a \`partition\` event cuts a zone off.`,
      predict: {
        sql: KV(2, 2) + SPLIT_RUN,
        question: 'Three copies, one per zone. Every write waits for **2** copies and every read asks **2**. At 10 s, zone **c** is cut off. The app runs in zones a and c. What happens during the split?',
        choices: ['Nothing: 3 copies are plenty', 'Requests handled in zone c fail; zone a carries on, and nobody reads old data', 'Everything fails: one copy is missing', 'Both sides work, but some reads are stale'],
        answer: 1,
        why: 'The app in zone c can reach only its own copy, never 2, so its requests time out: about half of all requests. Zone a still reaches 2 copies and works. That is a CP choice: errors instead of stale data.',
        verify: ['split: errors > 30%', 'staleReads = 0'],
      },
      example: {
        sql: KV(1, 1) + SPLIT_RUN,
        note: 'With w: 1 and r: 1, each side reads and writes the copies it can reach: no errors during the split (AP), but zone c reads values that zone a has already changed. Look at the stale reads.',
      },
      cheat: { syntax: 'partition → choose C or A', note: 'During a split: refuse (consistent) or answer with possibly old data (available).' },
    },
    {
      id: 's08-quorum',
      title: 'Quorums and eventual consistency',
      card: `Leaderless stores (Cassandra, DynamoDB, Riak) keep **N** copies of each item and let you choose, per operation:

- **W**: how many copies must confirm a **write** before it succeeds;
- **R**: how many copies a **read** asks (it returns the newest version among them).

If **R + W > N**, every read set overlaps every write set in at least one copy, so a read always sees the latest acknowledged write. With N = 3, W = 2 and R = 2 is the classic “quorum” setting.

If **R + W ≤ N**, a read can ask only copies the write hasn't reached yet. The copies still converge a moment later: that's **eventual consistency**. It's faster and survives more failures, and it's fine for data where a slightly old value does no harm.

Quorums also decide what survives failures: with N = 3, W = 2, R = 2, one copy can be down and everything still works; W = 3 stops all writes when any copy is down.`,
      predict: {
        sql: STORE(1, 1) + STORE_RUN,
        question: 'N = 3 copies, **W = 1, R = 1**. Writes are sometimes slow to reach every copy. Can a read return an older value than one already acknowledged to another user?',
        choices: ['No: every copy gets every write', 'Yes: the one copy a read asks may not have the write yet', 'Only if a copy crashes'],
        answer: 1,
        why: 'R + W = 2 ≤ 3. The write was confirmed by one copy; the read asked another that was still behind. Look at the stale reads.',
        verify: ['staleReads > 10'],
      },
      example: {
        sql: STORE(2, 2) + STORE_RUN,
        note: 'W = 2, R = 2: R + W = 4 > 3, so every read overlaps the last write: no stale reads. Try W = 1, R = 3 and W = 3, R = 1: both are consistent too.',
      },
      cheat: { syntax: 'R + W > N', note: 'Read and write sets overlap → reads see the latest write. Otherwise: eventual.' },
    },
    {
      id: 's08-pacelc',
      title: 'PACELC: consistency costs latency',
      card: `CAP only talks about partitions. **PACELC** adds the everyday case: if there's a **P**artition, choose **A** or **C**; **E**lse (normal operation), choose **L**atency or **C**onsistency.

Even with a perfect network, consistency means **waiting for other machines**:

- W = 3 waits for the **slowest** of three copies on every write: one slow disk makes every write slow.
- A synchronous replica makes every commit wait a round trip, which is tiny in one zone and 50–100 ms across regions.
- Consistent reads may have to go to the leader, far away.

So systems pick defaults: DynamoDB and Cassandra lean to **latency** (eventual by default, strong reads on request); Spanner and classic SQL primaries lean to **consistency**. Good designs choose **per operation**: strong where a wrong answer costs money, eventual where speed matters more.`,
      predict: {
        sql: STORE(3, 1) + STORE_RUN,
        question: 'Same store, now **W = 3, R = 1** (strongly consistent: 3 + 1 > 3). With W = 1, R = 1 the p99 was about 77 ms. What is it now?',
        choices: ['About the same: reads are as fast as before', 'Clearly higher: every write waits for the slowest of the three copies', 'Lower: fewer copies are read'],
        answer: 1,
        why: 'A write is confirmed only when all three copies have it, so each write takes as long as the slowest copy. The p99 rises to about 150 ms.',
        verify: ['p99 > 120ms', 'staleReads = 0'],
      },
      example: {
        sql: STORE(2, 2) + STORE_RUN,
        note: 'W = 2, R = 2 is also consistent, but each operation waits only for the 2 fastest copies: the p99 is about 95 ms. Majority quorums are the usual balance.',
      },
      cheat: { syntax: 'else: latency vs consistency', note: 'Waiting for more copies is consistent and slower. Majorities balance it.' },
    },
    {
      id: 's08-leader',
      title: 'Leaders, failover and elections',
      card: `Most SQL databases (and Kafka, etcd, MongoDB…) have a **leader**: one primary takes every write and ships it to followers. Simple and consistent, until the leader dies. Then:

1. **Detect** it: followers or a monitor miss its heartbeats for a few seconds.
2. **Elect** a new leader: normally the follower furthest along the log.
3. **Reconfigure**: clients and the other followers switch to it.

Without automatic failover, writes fail until a human promotes a replica: often minutes, at night, hours.

The danger is **split brain**: the old leader was only slow or cut off, comes back, and still thinks it's the leader. Two leaders accept conflicting writes. Real systems prevent it with a **majority vote** (Raft, Paxos: a leader needs a quorum of nodes, so there can be only one) and **fencing** (the new leader gets a higher term number; storage rejects the old one).

In the simulator: \`failoverMs\` on the database promotes the most up-to-date replica that long after the primary dies.`,
      predict: {
        sql: LEADER('') + CRASH_RUN,
        question: 'The primary dies at 10 s. There are two replicas, but no automatic failover. Half the requests are writes. What happens after 10 s?',
        choices: ['A replica takes over within seconds', 'Reads keep working from the replicas; every write fails', 'Everything fails'],
        answer: 1,
        why: 'Replicas can serve reads, but only the primary takes writes, and nobody promotes a replica. About half of all requests fail until someone restores the primary.',
        verify: ['after: errors > 40%', 'after: errors < 60%'],
      },
      example: {
        sql: LEADER(', failoverMs: 3000') + CRASH_RUN,
        note: 'With failoverMs: 3000, a replica is promoted 3 s after the crash and writes work again. But look at “lost writes”: the next lesson.',
      },
      cheat: { syntax: 'failoverMs · majority vote · fencing', note: 'Detect, elect the most up-to-date follower, fence the old leader.' },
    },
    {
      id: 's08-durable',
      title: 'Failover without losing writes',
      card: `With **asynchronous** replication, the primary confirms a write as soon as it has it, and ships it to replicas a little later. If the primary dies in between, the write was **acknowledged but never replicated**: after failover, the new primary has never heard of it. The user was told “saved”; the data is gone.

**Synchronous** (semi-synchronous) replication closes the gap: the primary waits until at least one replica has the write before confirming it. Failover then promotes that replica, and nothing acknowledged is lost (RPO = 0).

The price:

- Each commit waits a round trip to the replica (fine in one region).
- If the synchronous replica is **down**, writes wait. Requiring *all* replicas to confirm means any single replica failure stops writes. So the usual setting is **one** synchronous replica out of several, or a majority (Raft).

In the simulator: \`syncReplicas: N\` makes the first N replicas synchronous.`,
      predict: {
        sql: LEADER(', failoverMs: 3000') + CRASH_RUN,
        question: 'The primary dies at 10 s; a replica takes over 3 s later. Replication is asynchronous with a lag of about 200 ms. Were any confirmed writes lost?',
        choices: ['No: the replica had everything', 'Yes: writes confirmed in the last moments before the crash never reached the replica', 'Only writes during the 3 s failover'],
        answer: 1,
        why: 'Writes confirmed in the ~200 ms before the crash were still on their way. The promoted replica never got them: about a hundred “saved” writes vanish. (Writes during the 3 s gap failed visibly; they weren’t confirmed.)',
        verify: ['lostWrites > 50'],
      },
      example: {
        sql: LEADER(', failoverMs: 3000, syncReplicas: 1') + CRASH_RUN,
        note: 'syncReplicas: 1: each write waits for the first replica, which is promoted on failover. No lost writes, for about a millisecond per write. Now try syncReplicas: 2 and watch what happens to writes after the crash.',
      },
      cheat: { syntax: 'syncReplicas: 1 · failoverMs', note: 'Async failover can lose confirmed writes; one sync replica prevents it.' },
    },
  ],
  practice: [
    {
      id: 's08-p1',
      kind: 'readQuery',
      conceptIds: ['s08-cap'],
      prompt: 'A network partition splits your data centre in two. Which service should **refuse** requests on the minority side rather than answer with possibly old data?',
      choices: ['The “people you may know” suggestions', 'Account balances for payments', 'The number of likes on a post', 'A product’s review summary'],
      answer: 1,
      hints: ['Where does a wrong answer cost real money?'],
      explanation: 'Paying from a balance that is out of date can overspend it: choose consistency and fail the request. Suggestions, likes and review summaries are fine slightly old: choose availability.',
    },
    {
      id: 's08-p2',
      kind: 'fillBlank',
      conceptIds: ['s08-quorum'],
      prompt: 'N = 3 copies and every write waits for W = 2. Fill in the **smallest R** that guarantees reads never return stale data.',
      starterSql: STORE(2, 0).replace('r: 0', 'r: ___'),
      solution: STORE(2, 2),
      wrongExample: STORE(2, 1),
      hints: ['You need R + W > N.'],
      explanation: '2 + R > 3, so **R = 2**. With R = 1, a read can ask the one copy the write hasn’t reached yet.',
      sd: { target: 'design', run: { traffic: STORE_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['staleReads = 0', 'p99 < 200ms'] } },
    },
    {
      id: 's08-p3',
      kind: 'write',
      conceptIds: ['s08-quorum'],
      prompt: 'A store keeps **N = 5** copies and writes wait for **W = 3**. What is the **smallest R** for reads that always see the latest write?',
      solution: '3',
      wrongExample: '2',
      hints: ['R + W > N.'],
      explanation: 'R + 3 > 5, so **R = 3**. With N = 5, majorities (3 and 3) overlap in at least one copy, and up to 2 copies can be down.',
      sd: { target: 'estimate', unit: 'copies', tolerance: 0.1 },
    },
    {
      id: 's08-p4',
      kind: 'fixBug',
      conceptIds: ['s08-pacelc', 's08-quorum'],
      prompt: 'Writes wait for **all three** copies and the p99 is too high. Keep reads **always up to date** (no stale reads), and bring the **p99 under 120 ms**.',
      starterSql: STORE(3, 1),
      solution: STORE(2, 2),
      wrongExample: STORE(1, 1),
      hints: ['W = 3 waits for the slowest copy.', 'Any R and W with R + W > 3 is consistent. Which waits least?'],
      explanation: '**W = 2, R = 2**: each operation waits for the 2 fastest of 3 copies, and the sets still overlap. W = 1, R = 1 is fast but lets reads miss recent writes.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: STORE_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['staleReads = 0', 'p99 < 120ms'] } },
    },
    {
      id: 's08-p5',
      kind: 'readQuery',
      conceptIds: ['s08-leader'],
      prompt: 'At 10 s the error rate jumps to about 50% and stays there. Reads still work. The simulator ran it. **What is missing?**',
      sql: LEADER('') + CRASH_RUN,
      choices: ['More read replicas', 'Automatic failover: nobody promotes a replica after the primary died', 'A cache', 'A bigger primary'],
      answer: 1,
      verify: ['after: errors > 40%'],
      hints: [],
      explanation: 'The primary is dead and writes have nowhere to go. The replicas have the data, but none is promoted. `failoverMs` promotes one automatically.',
    },
    {
      id: 's08-p6',
      kind: 'fixBug',
      conceptIds: ['s08-leader'],
      prompt: 'The primary dies at 10 s. Make writes work again **within 5 seconds** (errors < 0.1% from 15 s on).',
      starterSql: LEADER(''),
      solution: LEADER(', failoverMs: 3000'),
      wrongExample: LEADER('').replace('replicas: 2', 'replicas: 4'),
      hints: ['Replicas have the data. What has to happen for one to take writes?'],
      explanation: '**failoverMs: 3000** promotes the most up-to-date replica 3 s after the crash. More replicas don’t help: none of them is ever promoted.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: CRASH_T, durationMs: 30_000, warmupMs: 5_000, events: CRASH_EVENTS, phases: AFTER, requirements: ['after: errors < 0.1%'] } },
    },
    {
      id: 's08-p7',
      kind: 'fixBug',
      conceptIds: ['s08-durable'],
      prompt: 'Failover works, but writes confirmed just before the crash vanish. Make sure **no confirmed write is lost**, with writes working again by 15 s.',
      starterSql: LEADER(', failoverMs: 3000'),
      solution: LEADER(', failoverMs: 3000, syncReplicas: 1'),
      wrongExample: LEADER(', failoverMs: 3000, syncReplicas: 2'),
      hints: ['A confirmed write must already be on a replica.', 'What happens to writes that wait for every replica, once one of them is gone?'],
      explanation: '**syncReplicas: 1**: one replica has every confirmed write, and failover promotes it. With syncReplicas: 2, after the crash the new primary waits for a replica that is dead (the old primary): writes stop.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: CRASH_T, durationMs: 30_000, warmupMs: 5_000, events: CRASH_EVENTS, phases: AFTER, requirements: ['lostWrites = 0', 'after: errors < 0.1%'] } },
    },
    {
      id: 's08-p8',
      kind: 'parsons',
      conceptIds: ['s08-leader'],
      prompt: 'Put a safe automatic failover in order.',
      blocks: [
        'The leader stops sending heartbeats',
        'Followers notice after a timeout and start an election',
        'A majority votes for the most up-to-date follower',
        'The new leader starts a new term (a higher epoch number)',
        'Clients switch to the new leader',
        'The old leader comes back, sees the higher term and becomes a follower',
      ],
      wrongOrder: [
        'The leader stops sending heartbeats',
        'Clients switch to the new leader',
        'Followers notice after a timeout and start an election',
        'A majority votes for the most up-to-date follower',
        'The new leader starts a new term (a higher epoch number)',
        'The old leader comes back, sees the higher term and becomes a follower',
      ],
      hints: ['There is nobody to switch to before the election.'],
      explanation: 'Detect, elect by majority, bump the term, reconfigure. The higher term is what fences the old leader when it returns, so there are never two leaders accepting writes.',
    },
    {
      id: 's08-p9',
      kind: 'readQuery',
      conceptIds: ['s08-pacelc', 's08-cap'],
      prompt: 'A ticket site stores **seat reservations** and **event view counters**. Which consistency choices fit?',
      choices: ['Both eventual: it’s faster', 'Both strong: never show wrong data', 'Seats strong (quorum or leader reads), view counters eventual', 'Seats eventual, counters strong'],
      answer: 2,
      hints: ['What does a wrong answer cost in each case?'],
      explanation: 'Two people holding the same seat is a real problem: pay the latency for consistency. A view counter that’s a second behind harms nobody: take the speed. Choosing per operation is normal.',
    },
    {
      id: 's08-p10',
      kind: 'fixBug',
      conceptIds: ['s08-cap', 's08-quorum'],
      prompt: 'This store holds **shopping carts**. A slightly old cart is acceptable; an error page is not. Zone c is cut off at 10 s. Keep **errors under 1% during the split**.',
      starterSql: KV(2, 2),
      solution: KV(1, 1),
      wrongExample: KV(3, 1),
      hints: ['How many copies can the app in zone c reach?', 'Choose availability: ask for fewer copies.'],
      explanation: 'With **W = 1, R = 1**, each side works with the copies it can reach (AP). Some carts are briefly out of date, and that’s the trade Amazon’s Dynamo made for carts. W = 3 fails every write, on both sides.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: SPLIT_T, durationMs: 30_000, warmupMs: 5_000, events: SPLIT_EVENTS, phases: SPLIT_PHASES, requirements: ['split: errors < 1%'] } },
    },
  ],
  test: [
    {
      id: 's08-t1',
      kind: 'readQuery',
      conceptIds: ['s08-cap'],
      prompt: 'Which statement about the CAP theorem is right?',
      choices: [
        'Pick any two of consistency, availability and partition tolerance, at any time',
        'When the network partitions, a replicated system must give up either consistency or availability',
        'A single database server is never consistent',
        'Partitions only happen across regions',
      ],
      answer: 1,
      hints: [],
      explanation: 'Partitions happen whether you like it or not; the choice is what to give up *while* one lasts. Without a partition you can have both (but PACELC: at a latency cost).',
    },
    {
      id: 's08-t2',
      kind: 'write',
      conceptIds: ['s08-quorum'],
      prompt: 'N = 3 copies, W = 2, R = 2. **How many copies** can be down while both reads and writes keep working?',
      solution: '1',
      wrongExample: '2',
      hints: ['Each operation needs 2 copies that answer.'],
      explanation: 'With one copy down, 2 remain: enough for W = 2 and R = 2. With two down, only 1 is left. In general a majority quorum survives ⌊(N − 1) / 2⌋ failures.',
      sd: { target: 'estimate', unit: 'copies', tolerance: 0.1 },
    },
    {
      id: 's08-t3',
      kind: 'readQuery',
      conceptIds: ['s08-quorum'],
      prompt: 'Users sometimes see an older value right after someone else changed it. No machine failed. The simulator ran it. **Why?**',
      sql: STORE(1, 1) + STORE_RUN,
      choices: ['The cache is stale', 'R + W ≤ N: a read can miss copies the write reached', 'A network partition', 'Clock skew between servers'],
      answer: 1,
      verify: ['staleReads > 10', 'errors < 0.1%'],
      hints: [],
      explanation: 'W = 1 and R = 1 with N = 3: the read and write sets need not overlap. Raise W and R so that R + W > N.',
    },
    {
      id: 's08-t4',
      kind: 'fixBug',
      conceptIds: ['s08-quorum'],
      prompt: 'An inventory store: reads must **never be stale**, and it must keep working when **one copy dies** (at 10 s), with p99 under 200 ms.',
      starterSql: STORE(3, 1),
      solution: STORE(2, 2),
      wrongExample: STORE(1, 1),
      hints: ['W = 3 needs every copy.', 'Which R and W overlap and still need only 2 copies?'],
      explanation: '**W = 2, R = 2** overlaps (4 > 3) and needs only 2 of 3 copies, so one can die. W = 3 stops every write when a copy is down; W = 1, R = 1 survives but reads can be stale.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: STORE_T, durationMs: 30_000, warmupMs: 5_000, events: COPY_DOWN, requirements: ['staleReads = 0', 'errors < 0.1%', 'p99 < 200ms'] } },
    },
    {
      id: 's08-t5',
      kind: 'readQuery',
      conceptIds: ['s08-leader'],
      prompt: 'Why do Raft and similar systems require a **majority** of nodes to elect a leader?',
      choices: ['It’s faster than asking one node', 'Two majorities always overlap, so there can never be two leaders in the same term', 'So that every node holds a copy', 'To balance the load'],
      answer: 1,
      hints: [],
      explanation: 'Any two majorities share a node, and a node votes once per term. That makes split brain impossible: the minority side of a partition can’t elect its own leader.',
    },
    {
      id: 's08-t6',
      kind: 'fixBug',
      conceptIds: ['s08-leader', 's08-durable'],
      prompt: 'The primary dies at 10 s. Writes must work again **by 15 s** (errors < 0.1% after that) and **no confirmed write may be lost**.',
      starterSql: LEADER(''),
      solution: LEADER(', failoverMs: 3000, syncReplicas: 1'),
      wrongExample: LEADER(', failoverMs: 3000'),
      hints: ['Two settings: one to promote a replica, one so the replica has every confirmed write.'],
      explanation: '**failoverMs** brings writes back; **syncReplicas: 1** makes sure the replica that takes over had every write the old primary confirmed. Failover alone loses the writes still on their way.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: CRASH_T, durationMs: 30_000, warmupMs: 5_000, events: CRASH_EVENTS, phases: AFTER, requirements: ['lostWrites = 0', 'after: errors < 0.1%'] } },
    },
  ],
};
