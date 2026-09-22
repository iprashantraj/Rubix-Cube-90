import { getClusters, rupees, count } from '@/lib/admin';

/** /admin/hub — the cluster view.
 *
 *  A Common Facility Centre / Block Level Cluster is government infrastructure that
 *  already exists. We plug into it rather than building a logistics operation, which is
 *  also why `wage_rate_per_hour` lives on the cluster: the pricing floor is built from the
 *  local wage, not a national average, and an artisan whose pincode matches no cluster
 *  falls back to the default rather than to a wrong one. */
export default async function Page() {
  const clusters = await getClusters();
  const artisans = clusters.reduce((s, c) => s + c.artisans, 0);
  const gmv = clusters.reduce((s, c) => s + c.gmv, 0);
  const maxGmv = Math.max(...clusters.map((c) => c.gmv));

  return (
    <>
      <div className="head">
        <span className="eyebrow">Cluster hub · {clusters.length} clusters</span>
        <div>
          <h1>Cluster hub</h1>
          <p>
            {count(artisans)} artisans, {rupees(gmv)} realised. Adoption is the share who
            published in the last 30 days — the number that says whether a cluster is live
            or merely registered.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="ph">
          <h2>State &amp; cluster performance</h2>
          <span className="eyebrow">Ranked by realised GMV</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>State · craft cluster</th>
              <th className="num-c">Artisans</th>
              <th className="num-c">Listings</th>
              <th className="num-c">GMV</th>
              <th style={{ width: 160 }}>Digital adoption</th>
              <th className="num-c">Income uplift</th>
              <th className="num-c">Wage rate</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c, i) => (
              <tr key={c.id}>
                <td>
                  <span className="rk">{String(i + 1).padStart(2, '0')}</span>
                  <b>{c.state}</b>
                  <span className="sub2" style={{ marginLeft: 22 }}>
                    {c.craft} · {c.district}
                  </span>
                </td>
                <td className="num-c mono">{count(c.artisans)}</td>
                <td className="num-c mono">{count(c.listings)}</td>
                <td className="num-c mono">{rupees(c.gmv)}</td>
                <td>
                  <div className="bar-c">
                    <u><i style={{ width: `${c.adoption}%` }} /></u>
                    <s>{c.adoption}%</s>
                  </div>
                </td>
                <td className="num-c mono up">+{c.uplift}%</td>
                <td className="num-c mono">₹{c.wage_rate_per_hour}/hr</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cols">
        <div>
          <div className="panel">
            <div className="ph">
              <h2>Share of GMV</h2>
              <span className="eyebrow">Top clusters</span>
            </div>
            {clusters.slice(0, 6).map((c) => (
              <div key={c.id} className="lr wide">
                <span className="n" style={{ width: 120 }}>{c.craft}</span>
                <span className="b"><i style={{ width: `${(c.gmv / maxGmv) * 100}%`, background: 'var(--accent)' }} /></span>
                <span className="v">{rupees(c.gmv)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="panel">
            <div className="ph"><h2>Why the wage rate is per cluster</h2></div>
            <p className="note">
              The price floor is <b>material cost + local wage × hours</b>. A national average
              wage sets a floor that is too low in Srinagar and too high in Ashoknagar, and a
              floor of the wrong size clamps nothing while sounding authoritative. Pricing
              refuses outright — <b>422, not a guess</b> — when there is neither a material
              cost nor labour hours to build one from.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
