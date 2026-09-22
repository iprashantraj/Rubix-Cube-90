import { getOverview, rupees, count, ceiling, line } from '@/lib/admin';

/** /admin — Programme overview.
 *
 *  ⚠️ SUPERSEDED. A separate design for this screen was built and is the one we ship;
 *  this is the earlier take. Kept for the chart scaling, the "what we do not claim" panel
 *  and the copy — see `README.md` in this directory, which also specifies the six screens
 *  that design does NOT cover and that are still ours to build.
 *
 *  It answers an evaluator's question rather than ours: how many artisans, how much
 *  realised GMV, and how much of it reached the artisan instead of a middle-man.
 *
 *  `/admin` was the staff login stub. Login moves to `/admin/login` when auth is wired —
 *  see the note in `layout.tsx`. */

export default async function Page() {
  const o = await getOverview();
  const gmvs = o.months.map((m) => m.gmv);
  const maxListings = Math.max(...o.months.map((m) => m.listings));
  const W = 640, H = 186;
  const top = ceiling(gmvs);
  const path = line(gmvs, W, H, top);
  // Four labelled gridlines plus the baseline, top-down.
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => `${((top * f) / 1e7).toFixed(0)}Cr`);

  return (
    <>
      <div className="head">
        <span className="eyebrow">Programme overview · PS 26090</span>
        <div>
          <h1>AI-driven market linkage for artisans</h1>
          <p>
            Every number below is realised — an order a buyer placed, not a listing view.
            Income uplift is measured against the middle-man baseline collected in
            <b> research/pricing</b>, not modelled.
          </p>
        </div>
      </div>

      {/* ── hero band ── */}
      <div className="band">
        <div className="lead">
          <div>
            <div className="eyebrow">Gross merchandise value · FY 2026-27</div>
            <div className="num mono">
              ₹{(o.gmv / 1e7).toFixed(1)}
              <small>Cr</small>
            </div>
            <div className="delta">↑ {o.gmv_delta}% YoY</div>
          </div>
          <div className="spark">
            <svg viewBox={`0 0 260 56`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              <defs>
                <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="rgba(214,138,46,.30)" />
                  <stop offset="1" stopColor="rgba(214,138,46,0)" />
                </linearGradient>
              </defs>
              <path d={`${line(gmvs, 260, 52, top)} L260 56 L0 56Z`} fill="url(#sg)" />
              <path d={line(gmvs, 260, 52, top)} fill="none" stroke="#D68A2E" strokeWidth="1.6" />
            </svg>
          </div>
        </div>

        <div className="stat c-indigo">
          <div className="eyebrow">Artisans onboarded</div>
          <b className="mono">{count(o.artisans)}</b>
          <div className="track"><i style={{ width: '62%' }} /></div>
          <div className="sub"><em>+{count(o.artisans_added)}</em> this month</div>
        </div>
        <div className="stat c-teal">
          <div className="eyebrow">Listings published</div>
          <b className="mono">{count(o.listings)}</b>
          <div className="track"><i style={{ width: '78%' }} /></div>
          <div className="sub"><em>+{o.listings_delta}%</em> month on month</div>
        </div>
        <div className="stat c-green">
          <div className="eyebrow">Median income uplift</div>
          <b className="mono">+{o.uplift}%</b>
          <div className="track"><i style={{ width: `${o.uplift}%` }} /></div>
          <div className="sub">against middle-man baseline</div>
        </div>
        <div className="stat">
          <div className="eyebrow">Craft clusters live</div>
          <b className="mono">{count(o.clusters)}</b>
          <div className="track"><i style={{ width: '54%' }} /></div>
          <div className="sub"><em>+{o.clusters_added}</em> districts this quarter</div>
        </div>
      </div>

      <div className="cols">
        {/* ── left ── */}
        <div>
          <div className="panel">
            <div className="ph">
              <h2>Listings &amp; realised GMV</h2>
              <span className="eyebrow">Monthly · Apr 2026 → Mar 2027</span>
            </div>
            <div className="chart">
              <div className="yax">
                {ticks.map((t, i) => <span key={t + i}>{i === ticks.length - 1 ? '0' : t}</span>)}
              </div>
              <div className="plot">
                {[0, 25, 50, 75].map((t) => <div key={t} className="gl" style={{ top: `${t}%` }} />)}
                <div className="gl" style={{ top: '100%', background: 'var(--hair-2)' }} />
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <defs>
                    <linearGradient id="ar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="rgba(199,121,20,.22)" />
                      <stop offset="1" stopColor="rgba(199,121,20,0)" />
                    </linearGradient>
                  </defs>
                  <g fill="#C7D2E4" opacity=".75">
                    {o.months.map((m, i) => {
                      const bw = W / o.months.length;
                      const bh = (m.listings / maxListings) * H * 0.92;
                      return <rect key={m.month} x={i * bw + bw * 0.22} y={H - bh} width={bw * 0.56} height={bh} />;
                    })}
                  </g>
                  <path d={`${path} L${W} ${H} L0 ${H}Z`} fill="url(#ar)" />
                  <path d={path} fill="none" stroke="#C77914" strokeWidth="1.9" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="xax">
                {o.months.map((m) => <span key={m.month}>{m.month}</span>)}
              </div>
            </div>
            <div className="clegend">
              <span><u style={{ width: 9, height: 9, background: '#C7D2E4' }} />Listings published</span>
              <span><u style={{ width: 14, height: 2, background: '#C77914' }} />Realised GMV</span>
              <span style={{ marginLeft: 'auto' }}>
                Festive demand captured year-round — no dependency on physical fairs
              </span>
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <h2>Where the money reached</h2>
              <span className="eyebrow">Last 30 days · by channel</span>
            </div>
            {o.channels.map((c, i) => (
              <div key={c.channel} className="chrow">
                <u style={{ background: ['#C77914', '#0F766E', '#4338CA', '#BE3455'][i] }} />
                <em>{c.label}</em>
                <s className="mono">{rupees(c.gmv)}</s>
                <s className="mono" style={{ color: 'var(--ink-3)', width: 34, textAlign: 'right' }}>{c.share}%</s>
              </div>
            ))}
            <p className="note" style={{ marginTop: 14 }}>
              <b>GeM is the hard one and the valuable one.</b> 10,700+ categories, no seller
              API, and a wrong category is the most common listing failure in this sector.
              The workbook we generate <i>is</i> the official integration.
            </p>
          </div>
        </div>

        {/* ── right ── */}
        <div>
          <div className="panel">
            <div className="ph">
              <h2>Onboarding language</h2>
              <span className="eyebrow">Voice input</span>
            </div>
            {o.languages.map((l) => (
              <div key={l.label} className="lr">
                <span className="n">{l.label}</span>
                <span className="b"><i style={{ width: `${(l.share / 31) * 100}%`, background: l.colour }} /></span>
                <span className="v">{l.share}%</span>
              </div>
            ))}
            <div style={{ display: 'flex', paddingTop: 9, fontSize: 10.5, color: 'var(--ink-3)' }}>
              <span>+17 more scheduled languages</span>
              <span className="mono" style={{ marginLeft: 'auto' }}>20%</span>
            </div>
            <div className="strip">
              <div>
                <b className="mono">{o.zero_typing}%</b>
                <span>listings created with zero typing</span>
              </div>
              <div>
                <b className="mono" style={{ color: 'var(--c-teal)' }}>{o.median_minutes_to_live}</b>
                <span>median photo → live on marketplace</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <h2>Activity ledger</h2>
              <span className="eyebrow">Most recent first</span>
            </div>
            {o.activity.map((e) => (
              <div key={e.head} className="ev">
                <span className="tag" style={{ borderColor: e.colour, color: e.colour }}>{e.tag}</span>
                <div className="tx">
                  {e.head}
                  <span>{e.sub}</span>
                </div>
                <span className="tm">{e.when}</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="ph"><h2>What we do not claim</h2></div>
            <p className="note">
              <b>We cannot see an artisan&apos;s bank account.</b> Every settlement figure here is
              what a marketplace <i>promised</i>. The gap between that and money actually
              arriving is measured by one tap in the app — &ldquo;Paisa aaya?&rdquo; — and shown on
              the orders screen, never averaged away.
            </p>
            <p className="note" style={{ marginTop: 12 }}>
              <b>GeM has no order API.</b> Those orders live on the GeM dashboard and nowhere
              else. A coordinator reconciles them by hand. We do not fake a sync.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
