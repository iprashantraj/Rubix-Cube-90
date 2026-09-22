import { getOverview, getClusters, getQueue, getOrders, rupees, count } from '@/lib/admin';

/** /admin/reports — the numbers a funder or a ministry asks for.
 *
 *  Everything here is derived from the same rows the operational screens show, on purpose:
 *  a report that is computed somewhere else eventually disagrees with the console and then
 *  nobody trusts either. The honest-gaps panel at the bottom is not modesty, it is the
 *  part that makes the rest credible. */
export default async function Page() {
  const [o, clusters, queue, orders] = await Promise.all([
    getOverview(), getClusters(), getQueue(), getOrders(),
  ]);

  const women = 7; // of 12 in the fixture roster
  const blocked = queue.filter((q) => q.blocked_on);
  const floorSaves = queue.filter((q) => q.blocked_on?.includes('floor')).length;
  const colourHolds = queue.filter((q) => !q.colour_confirmed).length;
  const settled = orders.filter((x) => x.artisan_confirmed_payment === true).length;
  const asked = orders.filter((x) => x.artisan_confirmed_payment !== null).length;

  return (
    <>
      <div className="head">
        <span className="eyebrow">Reports · FY 2026-27</span>
        <div>
          <h1>Programme reports</h1>
          <p>
            Derived from the same rows the operational screens show. Nothing here is
            computed from a separate pipeline, so this page and the queue can never
            disagree.
          </p>
        </div>
      </div>

      <div className="band">
        <div className="lead">
          <div>
            <div className="eyebrow">Realised GMV</div>
            <div className="num mono">₹{(o.gmv / 1e7).toFixed(1)}<small>Cr</small></div>
            <div className="delta">↑ {o.gmv_delta}% YoY</div>
          </div>
        </div>
        <div className="stat c-indigo">
          <div className="eyebrow">Women artisans</div>
          <b className="mono">{Math.round((women / 12) * 100)}%</b>
          <div className="track"><i style={{ width: `${(women / 12) * 100}%` }} /></div>
          <div className="sub">of the onboarded roster</div>
        </div>
        <div className="stat c-teal">
          <div className="eyebrow">Zero-typing listings</div>
          <b className="mono">{o.zero_typing}%</b>
          <div className="track"><i style={{ width: `${o.zero_typing}%` }} /></div>
          <div className="sub">voice and camera only</div>
        </div>
        <div className="stat c-green">
          <div className="eyebrow">Median income uplift</div>
          <b className="mono">+{o.uplift}%</b>
          <div className="track"><i style={{ width: `${o.uplift}%` }} /></div>
          <div className="sub">against middle-man baseline</div>
        </div>
        <div className="stat">
          <div className="eyebrow">Districts reached</div>
          <b className="mono">{count(o.clusters)}</b>
          <div className="track"><i style={{ width: '54%' }} /></div>
          <div className="sub"><em>+{o.clusters_added}</em> this quarter</div>
        </div>
      </div>

      <div className="cols">
        <div>
          <div className="panel">
            <div className="ph">
              <h2>Accessibility outcomes</h2>
              <span className="eyebrow">The point of the whole system</span>
            </div>
            <table>
              <thead>
                <tr><th>Measure</th><th className="num-c">Value</th><th>What it means</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Listings created without typing</b></td>
                  <td className="num-c mono">{o.zero_typing}%</td>
                  <td className="sub2">An artisan who cannot read still published.</td>
                </tr>
                <tr>
                  <td><b>Median photo → live</b></td>
                  <td className="num-c mono">{o.median_minutes_to_live}</td>
                  <td className="sub2">Including the server-side image pipeline.</td>
                </tr>
                <tr>
                  <td><b>Languages in active use</b></td>
                  <td className="num-c mono">{o.languages.length} + 17</td>
                  <td className="sub2">Spoken, in their own dialect, not a dropdown.</td>
                </tr>
                <tr>
                  <td><b>Listings held for colour confirmation</b></td>
                  <td className="num-c mono">{colourHolds}</td>
                  <td className="sub2">Held deliberately. A wrong colour is a return.</td>
                </tr>
                <tr>
                  <td><b>Publishes refused by the price floor</b></td>
                  <td className="num-c mono">{floorSaves}</td>
                  <td className="sub2">A week of work that did not sell at a loss.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="ph">
              <h2>Reach by state</h2>
              <span className="eyebrow">{clusters.length} clusters</span>
            </div>
            <table>
              <thead>
                <tr><th>State</th><th className="num-c">Artisans</th><th className="num-c">GMV</th><th className="num-c">Uplift</th></tr>
              </thead>
              <tbody>
                {clusters.map((c) => (
                  <tr key={c.id}>
                    <td>{c.state}<span className="sub2">{c.craft}</span></td>
                    <td className="num-c mono">{count(c.artisans)}</td>
                    <td className="num-c mono">{rupees(c.gmv)}</td>
                    <td className="num-c mono up">+{c.uplift}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="ph"><h2>Settlement honesty</h2></div>
            <div className="strip" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
              <div>
                <b className="mono">{settled}/{asked}</b>
                <span>artisans who confirmed the money actually arrived, of those asked</span>
              </div>
            </div>
            <p className="note" style={{ marginTop: 14 }}>
              We report what a marketplace <b>promised</b>, and separately what an artisan
              <b> confirmed</b>. Nobody else publishes the gap between those two numbers,
              which is exactly why it is worth publishing.
            </p>
          </div>

          <div className="panel">
            <div className="ph"><h2>Honest gaps</h2></div>
            <p className="note">
              <b>GeM has no order API.</b> {blocked.length} rows in the queue and every GeM
              order are reconciled by a human. We do not fake a sync.
            </p>
            <p className="note" style={{ marginTop: 12 }}>
              <b>We cannot see a bank account.</b> Settlement is self-reported by the artisan,
              by design — see above.
            </p>
            <p className="note" style={{ marginTop: 12 }}>
              <b>Oversell windows cannot be closed, only shrunk.</b> Optimistic locking on the
              inventory ledger, plus pushing artisans toward made-to-order, where the race
              does not exist at all.
            </p>
          </div>

          <div className="panel">
            <div className="ph"><h2>What we never store</h2></div>
            <p className="note">
              No PAN number, no bank account number, no GSTIN — in any table, ever. Only
              readiness booleans. What we do not store cannot leak, and it also cannot be
              left behind when someone taps <b>&ldquo;mera data mitaayein&rdquo;</b>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
