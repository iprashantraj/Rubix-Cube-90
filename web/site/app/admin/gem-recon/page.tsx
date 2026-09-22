import { getGemRecon, rupees } from '@/lib/admin';

/** /admin/gem-recon — the manual bridge to GeM.
 *
 *  ⚠️ This screen exists because of a gap we refuse to paper over: **GeM has no order
 *  API.** Orders live on the GeM seller dashboard and nowhere else. A cluster coordinator
 *  reads them there and reconciles them here. Faking a sync would put numbers in front of
 *  an artisan that no system can stand behind, so instead the mismatch is the screen. */
export default async function Page() {
  const rows = await getGemRecon();
  const pending = rows.filter((r) => !r.reconciled);
  const value = pending.reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <div className="head">
        <span className="eyebrow">GeM reconciliation · manual by design</span>
        <div>
          <h1>GeM reconciliation</h1>
          <p>
            {pending.length} orders worth {rupees(value)} are ahead of us on the GeM
            dashboard. Open GeM, read the state, set it here. <b>There is no API to do this
            for you</b> — not one we are missing, one that does not exist.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="ph">
          <h2>Out of step</h2>
          <span className="eyebrow">GeM says one thing, we hold another</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>GeM order</th><th>Artisan</th><th>Product</th><th className="num-c">Qty</th>
              <th className="num-c">Value</th><th>On GeM</th><th>We hold</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">
                  {r.gem_order_id}
                  {r.reconciled && <span className="sub2">matched</span>}
                </td>
                <td>{r.artisan}</td>
                <td>{r.product}</td>
                <td className="num-c mono">{r.quantity}</td>
                <td className="num-c mono">{rupees(r.amount)}</td>
                <td><span className="pill">{r.gem_state}</span></td>
                <td>
                  {r.our_state
                    ? <span className={`pill ${r.our_state}`}>{r.our_state}</span>
                    : <span className="pill no">no record</span>}
                  {!r.reconciled && !r.our_state && (
                    <span className="why">Order placed on GeM never reached us</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cols">
        <div>
          <div className="panel">
            <div className="ph"><h2>Why GeM is worth the manual work</h2></div>
            <p className="note">
              <b>10,700+ categories, and the wrong one is the most common listing failure in
              this sector.</b> An entire consultancy industry exists purely to fill these
              sheets correctly, charging artisans for it. Automating the category mapping is
              the actual &ldquo;AI-driven market linkage&rdquo; the problem statement asks for —
              background removal is a commodity, this is not.
            </p>
          </div>
        </div>
        <div>
          <div className="panel">
            <div className="ph"><h2>The discount guard</h2></div>
            <p className="note">
              GeM mandates roughly a 10% discount off MRP. When that would push a price below
              the artisan&apos;s cost floor, <b>we refuse to emit the workbook at all</b> rather
              than generate a sheet that sells their week at a loss. Under-pricing is the
              epidemic in this sector, not over-pricing.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
