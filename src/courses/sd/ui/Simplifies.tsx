/** The honest list of what the simulator leaves out, shown on the sandbox page. */
export function Simplifies() {
  return (
    <details className="card small">
      <summary>
        <b>What this simulator simplifies</b>
      </summary>
      <ul>
        <li>
          <b>Requests are simulated one by one</b> (a discrete-event simulation) with a seeded random generator: the same design, traffic and seed always give the same result. Its queueing matches the textbook formulas (M/M/1, Erlang C, Little’s law); that is tested.
        </li>
        <li>
          <b>Work times</b> are random around round, typical averages (5 ms of CPU per request, 2 ms per database read, 6 ms per write…). Real systems add long tails from garbage collection, disks and noisy neighbours.
        </li>
        <li>
          <b>The network</b> has fixed delays (0.25 ms within a zone, 0.75 ms across zones, 40 ms to users) and no bandwidth limit or packet loss, except the partitions you inject.
        </li>
        <li>
          <b>Databases</b> have no query planner, locks or disks: each read or write costs a fixed amount of work, a size only changes cores and connection limits, and a “query” costs two reads.
        </li>
        <li>
          <b>Replication</b>: asynchronous replicas apply writes in order after a random lag; synchronous ones apply each write before it is confirmed (like PostgreSQL’s remote_apply). Failover promotes the most up-to-date replica, and there is never a split brain. Quorum stores have no read repair or hinted handoff.
        </li>
        <li>
          <b>Caches</b> are LRU by item count, 1 KB per item by default.
        </li>
        <li>
          <b>Costs</b> are rounded on-demand list prices. Usage is scaled to 30 days as if the run repeated all month, so a 10-second spike is billed as if it never stopped. No discounts, storage, or people.
        </li>
        <li>
          <b>Time is compressed</b>: runs last seconds, so health checks, failovers and zone outages happen within them. A misbehaving <code>abuser</code> client’s own requests are left out of the results.
        </li>
      </ul>
    </details>
  );
}
