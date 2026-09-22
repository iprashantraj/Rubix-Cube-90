import Link from 'next/link';
import { getArtisans, rupees, count } from '@/lib/admin';

/** /admin/artisans — the roster a cluster coordinator works from.
 *
 *  The readiness columns are BOOLEANS and that is not a UI shortcut. `api/models.py`
 *  holds `has_pan`, never a PAN number, in any table, ever — so there is nothing behind
 *  these cells to drill into and there never will be. A coordinator seeing "no bank"
 *  knows to go help; nobody, including us, can read the account number off this screen. */

const FLAGS = [
  ['has_pan', 'PAN'],
  ['has_bank', 'BNK'],
  ['has_gst', 'GST'],
  ['has_artisan_card', 'ACD'],
] as const;

export default async function Page() {
  const artisans = await getArtisans();
  const notReady = artisans.filter((a) => !a.has_bank || a.name_check_passed === false);

  return (
    <>
      <div className="head">
        <span className="eyebrow">Artisans · {count(artisans.length)} in your clusters</span>
        <div>
          <h1>Artisan roster</h1>
          <p>
            Readiness is shown as flags only. The documents behind them are never stored, so
            this screen can tell you who needs help without holding anything that could leak.
          </p>
        </div>
      </div>

      {notReady.length > 0 && (
        <div className="panel">
          <div className="ph">
            <h2>Needs a coordinator</h2>
            <span className="eyebrow">{notReady.length} of {artisans.length}</span>
          </div>
          <p className="note">
            {notReady.map((a) => a.display_name).join(', ')} — missing a bank linkage or failed
            the name-consistency check. <b>Name mismatch across Aadhaar, PAN, GST and bank is
            the top GeM rejection cause</b>, and catching it before they list is worth more
            than any listing we could help them publish today.
          </p>
        </div>
      )}

      <div className="panel">
        <div className="ph">
          <h2>All artisans</h2>
          <span className="eyebrow">Ranked by realised GMV</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Artisan</th>
              <th>Cluster</th>
              <th>Lang</th>
              <th>Readiness</th>
              <th>Also sells on</th>
              <th className="num-c">Listings</th>
              <th className="num-c">GMV</th>
            </tr>
          </thead>
          <tbody>
            {[...artisans].sort((a, b) => b.gmv - a.gmv).map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/admin/artisans/${a.id}`}>
                    <b>{a.display_name}</b>
                  </Link>
                  <span className="sub2">{a.phone} · {a.craft}</span>
                </td>
                <td>
                  {a.cluster}
                  <span className="sub2">{a.district}, {a.state}</span>
                </td>
                <td className="mono">{a.language}</td>
                <td>
                  <div className="flags">
                    {FLAGS.map(([key, label]) => (
                      <span key={key} className={`flag${a[key] ? ' on' : ''}`} title={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                  {a.name_check_passed === false && <span className="why">Name check failed</span>}
                  {a.name_check_passed === null && <span className="sub2">Name check not run</span>}
                </td>
                <td>
                  {a.sells_on.length === 0
                    ? <span className="sub2">— asked, none</span>
                    : a.sells_on.map((c) => <span key={c} className="pill">{c}</span>)}
                </td>
                <td className="num-c mono">
                  {a.live_listings}
                  <span className="sub2">of {a.products}</span>
                </td>
                <td className="num-c mono">{rupees(a.gmv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        <b>&ldquo;Also sells on&rdquo; is a question-reduction field before it is anything else.</b> An
        artisan with no Amazon or Flipkart account is never asked for a shipping weight —
        several of the nine catalogue questions exist only to satisfy channels they may
        never use.
      </p>
    </>
  );
}
