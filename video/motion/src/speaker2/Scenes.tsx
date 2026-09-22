import React from 'react';
import {interpolate, useCurrentFrame, Easing, Img, staticFile} from 'remotion';
import {C, SERIF, SANS, MONO, DEVA, PAD, rise, countTo, Scene, Kicker, Headline, MonoUp, Chip, Phone, Card} from './ui';

/* ============================================================================
   Every number, string and status in this file was read off the running code,
   not invented for the video:

     price          ai/price/compute.py quote(180, 4, "sambalpur", "gem", …)
     comparables    ai/price/comps.py market_range("pottery.terracotta", "clay")
     channel text   ai/catalog/seo.py shape(<channel>, listing, "Sunita Devi")
     tiers/statuses web/api/channels/base.py Tier + STATUSES, registry.py order
     pipeline       ai/enhance/pipeline.py run() -> ["stages"]

   If one of those changes, re-run it and change the constant here. Do not
   round a figure to make it read better — video/README.md house rule.
   ============================================================================ */

export const DUR = {five: 240, clean: 300, catalog: 360, price: 270, channels: 210, manager: 150, bhashini: 180};

// ─────────────────────────────────────────────────────────────────────────────
// 1. What the AI does — the five capabilities, in the speaker's order.
// ─────────────────────────────────────────────────────────────────────────────

const FIVE = [
  ['Guided capture & AI studio', 'the phone coaches the shot, the server cleans it'],
  ['Voice-first cataloguer', 'she speaks; it writes the listing in Hindi and English'],
  ['Fair-price assistant', 'cost floor first, market second'],
  ['One-tap listing', 'one catalogue, seven marketplace formats'],
  ['AI business manager', 'orders, restock, and a price that learns'],
];

export const SceneFive: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene durationInFrames={DUR.five}>
      <div style={{position: 'absolute', left: PAD, top: 96, ...rise(frame, 0, 14)}}>
        <Kicker>✱ She photographs, and she answers out loud</Kicker>
      </div>
      <Headline style={{position: 'absolute', left: PAD, top: 150, ...rise(frame, 6, 22)}}>
        From that, the AI does five things.
      </Headline>

      <div style={{position: 'absolute', left: PAD, top: 330, width: 1760}}>
        {FIVE.map(([title, sub], i) => (
          <div
            key={title}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 40,
              padding: '30px 0',
              borderTop: i === 0 ? 'none' : `1px solid ${C.hair}`,
              ...rise(frame, 45 + i * 32, 20, 26),
            }}
          >
            <span style={{font: `400 72px/1 ${SERIF}`, color: C.coral, width: 90}}>{i + 1}</span>
            <span style={{font: `500 54px/1.2 ${SANS}`, color: C.ink, width: 720}}>{title}</span>
            <span style={{font: `400 32px/1.4 ${SANS}`, color: C.muted, flex: 1}}>{sub}</span>
          </div>
        ))}
      </div>
    </Scene>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. The photograph — the one the user asked to land on the 1:00 mark.
//    Stage chips are pipeline.run()'s own `stages` array, in its own order.
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = ['gate', 'master 2000px', 'segment', 'matte', 'tier A', 'white balance', 'tone', 'render', 'export'];

const WIPE_AT = 60; // ≈2.0s into the scene

export const SceneClean: React.FC = () => {
  const frame = useCurrentFrame();

  // The coral bar sweeps left to right and leaves the real cut-out behind it.
  const bar = interpolate(frame, [WIPE_AT, WIPE_AT + 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.in(Easing.quad),
  });
  const barOut = interpolate(frame, [WIPE_AT + 18, WIPE_AT + 38], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });
  const reveal = interpolate(frame, [WIPE_AT + 16, WIPE_AT + 36], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const done = frame > WIPE_AT + 26;

  return (
    <Scene durationInFrames={DUR.clean}>
      <div style={{position: 'absolute', left: PAD, top: 96, ...rise(frame, 0, 14)}}>
        <Kicker>✱ On the server, in one call</Kicker>
      </div>
      <Headline style={{position: 'absolute', left: PAD, top: 150, width: 1180, ...rise(frame, 6, 22)}}>
        It cleans the photograph she already took.
      </Headline>

      <div style={{position: 'absolute', left: PAD, top: 410, ...rise(frame, 20, 20)}}>
        <div style={{position: 'relative', width: 520, height: 520, borderRadius: 8, border: `1px solid ${C.hair}`, background: '#fff', overflow: 'hidden'}}>
          <Img src={staticFile('pot-original.png')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
          <div style={{position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - reveal}% 0 0)`}}>
            <Img src={staticFile('pot-cutout.png')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: C.coral,
              transformOrigin: barOut > 0 ? 'right center' : 'left center',
              transform: `scaleX(${bar - barOut})`,
            }}
          />
        </div>
        <MonoUp style={{marginTop: 20, color: done ? C.coral : C.muted}}>
          {done ? 'As listed · real BiRefNet output' : 'As photographed'}
        </MonoUp>
      </div>

      <div style={{position: 'absolute', left: 700, top: 410, width: 560}}>
        <MonoUp style={{...rise(frame, 100, 16)}}>What actually ran</MonoUp>
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24}}>
          {STAGES.map((s, i) => (
            <span key={s} style={{...rise(frame, 110 + i * 7, 14, 12)}}>
              <Chip>{s}</Chip>
            </span>
          ))}
        </div>
        <div style={{marginTop: 46, ...rise(frame, 195, 20)}}>
          <div style={{font: `400 34px/1.5 ${SANS}`, color: C.muted, width: 540}}>
            Background removed, light corrected, framed to every channel's size — and the
            original is never overwritten. We store the recipe and render on demand.
          </div>
        </div>
      </div>

      <Phone shot="14-product-detail.png" style={{left: 1370, top: 31, ...rise(frame, 30, 24)}} />
    </Scene>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. One spoken sentence -> filled slots -> per-channel SEO text she can paste.
//    The three cards are seo.shape() output, character-for-character.
// ─────────────────────────────────────────────────────────────────────────────

const SLOTS = [
  ['Material', 'मिट्टी'],
  ['Size', '2 लीटर'],
  ['Origin', 'अजमेर'],
  ['Time', 'दो दिन'],
];

const CHANNEL_CARDS = [
  {
    name: 'GeM',
    limit: 'title 200 · no keyword field',
    title: 'Handmade Terracotta Matka Water Pot 2 L',
    note: 'Her name is cut. GeM rejects any listing carrying seller information.',
  },
  {
    name: 'Amazon',
    limit: 'title 75 · keywords 249 bytes · 5 bullets',
    title: 'Handmade Terracotta Matka Water Pot 2 L by Sunita Devi',
    note: 'Keywords are trimmed by BYTES — Devanagari is three bytes a letter.',
  },
  {
    name: 'Flipkart',
    limit: 'title 200 · exactly 3 keywords',
    title: 'Handmade Terracotta Matka Water Pot 2 L by Sunita Devi',
    note: 'terracotta matka · clay water pot · handmade pottery',
  },
];

const PHASE_B = 150;

export const SceneCatalog: React.FC = () => {
  const frame = useCurrentFrame();
  const a = interpolate(frame, [PHASE_B, PHASE_B + 18], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  // Phase A's entrance and its exit both own `opacity`, so they have to be multiplied
  // rather than spread — the later spread would otherwise silently win and the quote
  // would sit on top of phase B forever.
  const quoteIn = rise(frame, 6, 24);

  return (
    <Scene durationInFrames={DUR.catalog}>
      <div style={{position: 'absolute', left: PAD, top: 96, ...rise(frame, 0, 14)}}>
        <Kicker>✱ One sentence, her own language</Kicker>
      </div>

      <div style={{position: 'absolute', left: PAD, top: 160, width: 1180, ...quoteIn, opacity: a * quoteIn.opacity}}>
        <MonoUp>She said, once</MonoUp>
        <div style={{font: `500 66px/1.25 ${DEVA}`, color: C.ink, marginTop: 22}}>
          “यह मिट्टी की सुराही है, हाथ से बनी, अजमेर की, दो लीटर की”
        </div>
      </div>

      {/* Phase A — the slots that one sentence filled. */}
      <div style={{position: 'absolute', left: PAD, top: 470, width: 1180, opacity: a}}>
        {SLOTS.map(([f, v], i) => (
          <Card
            key={f}
            style={{display: 'flex', alignItems: 'baseline', gap: 26, padding: '20px 26px', marginBottom: 14, ...rise(frame, 55 + i * 12, 16, -14)}}
          >
            <span style={{font: `500 24px/1 ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.coral, width: 190}}>{f}</span>
            <span style={{font: `500 40px/1.2 ${DEVA}`, color: C.ink}}>{v}</span>
          </Card>
        ))}
        <MonoUp style={{marginTop: 26, ...rise(frame, 115, 18)}}>
          One answer · four slots filled · nothing asked twice
        </MonoUp>
      </div>

      {/* Phase B — the same listing, cut to each marketplace's real limits. */}
      <div style={{position: 'absolute', left: PAD, top: 150, width: 1180}}>
        <Headline style={{...rise(frame, PHASE_B + 6, 22)}}>Then it writes the listing. Once.</Headline>
        <div style={{font: `400 32px/1.45 ${SANS}`, color: C.muted, marginTop: 16, width: 1140, ...rise(frame, PHASE_B + 14, 20)}}>
          Cut to every channel's real limits. Where there is no write API, she copies one
          field at a time — and the app reads each one out as she goes.
        </div>

        <div style={{marginTop: 40}}>
          {CHANNEL_CARDS.map((ch, i) => {
            const at = PHASE_B + 40 + i * 26;
            const copied = frame > at + 70 + i * 14;
            return (
              <Card key={ch.name} style={{padding: '20px 26px', marginBottom: 14, ...rise(frame, at, 20)}}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                  <div style={{display: 'flex', alignItems: 'baseline', gap: 20}}>
                    <span style={{font: `500 30px/1 ${SANS}`, color: C.ink}}>{ch.name}</span>
                    <span style={{font: `500 20px/1 ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted}}>
                      {ch.limit}
                    </span>
                  </div>
                  <span
                    style={{
                      font: `500 20px/1 ${MONO}`,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: copied ? '#fff' : C.tileStrong,
                      background: copied ? C.ok : C.tile,
                      borderRadius: 9999,
                      padding: '12px 22px',
                    }}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </span>
                </div>
                <div style={{font: `400 32px/1.3 ${SANS}`, color: C.ink, marginTop: 12}}>{ch.title}</div>
                <div style={{font: `400 24px/1.35 ${SANS}`, color: C.coral, marginTop: 8}}>{ch.note}</div>
              </Card>
            );
          })}
        </div>
      </div>

      <Phone shot="11-products.png" style={{left: 1370, top: 31, ...rise(frame, 24, 24)}} />
    </Scene>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. The price. Cost-up, then the market — never the other way round.
// ─────────────────────────────────────────────────────────────────────────────

const ROWS: [string, string, number][] = [
  ['Material', 'what the clay cost her', 180],
  ['Labour · 4 h × ₹120 Sambalpur rate', 'the input she was never taught to count', 480],
  ['Margin · 15%', '', 99],
];

const BAND = {low: 799, high: 1299, suggested: 1049, sample: 11};

export const ScenePrice: React.FC = () => {
  const frame = useCurrentFrame();
  const barW = interpolate(frame, [110, 137], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });
  // Where ₹1049 sits inside ₹799–₹1299, as a fraction of the drawn band.
  const markX = (BAND.suggested - BAND.low) / (BAND.high - BAND.low);

  return (
    <Scene durationInFrames={DUR.price}>
      <div style={{position: 'absolute', left: PAD, top: 96, ...rise(frame, 0, 14)}}>
        <Kicker>✱ Arithmetic, not a guess</Kicker>
      </div>

      <div style={{position: 'absolute', left: PAD, top: 150, width: 1180}}>
        {ROWS.map(([label, sub, value], i) => (
          <div key={label} style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 0', ...rise(frame, 12 + i * 18, 14)}}>
            <span style={{maxWidth: 780}}>
              <span style={{font: `500 26px/1.3 ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted}}>{label}</span>
              {sub ? <span style={{display: 'block', font: `400 26px/1.4 ${SANS}`, color: C.muted, marginTop: 8}}>{sub}</span> : null}
            </span>
            <span style={{font: `400 56px/1 ${SERIF}`, color: C.ink}}>₹{countTo(frame, 12 + i * 18, value)}</span>
          </div>
        ))}

        <div style={{height: 1, background: C.hairStrong, transformOrigin: 'left center', transform: `scaleX(${interpolate(frame, [72, 87], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})})`}} />

        <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 20, ...rise(frame, 80, 20)}}>
          <span style={{font: `500 26px/1 ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.coral}}>Floor</span>
          <span style={{font: `400 80px/1 ${SERIF}`, color: C.ink}}>₹759</span>
        </div>
      </div>

      <div style={{position: 'absolute', left: PAD, top: 620, width: 1180}}>
        <MonoUp style={{marginBottom: 14, ...rise(frame, 130, 18)}}>
          {BAND.sample} comparable terracotta listings, collected — not modelled
        </MonoUp>
        <div style={{position: 'relative', height: 78, borderRadius: 6, background: 'rgba(28,25,23,0.10)', transformOrigin: 'left center', transform: `scaleX(${barW})`}}>
          <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px'}}>
            <span style={{font: `500 26px/1 ${MONO}`, color: C.muted}}>₹{BAND.low}</span>
            <span style={{font: `500 26px/1 ${MONO}`, color: C.muted}}>₹{BAND.high}</span>
          </div>
        </div>
        {/* The marker hangs BELOW the band: above it, ₹1049 lands on top of the floor row. */}
        <div style={{position: 'absolute', left: markX * 1180 - 120, top: 160, width: 240, textAlign: 'center', ...rise(frame, 150, 20)}}>
          <div style={{width: 2, height: 22, background: C.coral, margin: '0 auto'}} />
          <div style={{font: `400 64px/1 ${SERIF}`, color: C.coral, marginTop: 6}}>₹{BAND.suggested}</div>
          <div style={{font: `500 22px/1 ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.coral, marginTop: 6}}>Suggested</div>
        </div>
      </div>

      <div style={{position: 'absolute', left: PAD, top: 930, width: 1180, ...rise(frame, 185, 22)}}>
        <Chip style={{background: C.tile}}>GeM MRP ₹1166 · clears the floor after the 10% mandated discount</Chip>
        <div style={{font: `400 28px/1.4 ${SANS}`, color: C.muted, marginTop: 14}}>
          Comparables may raise it. Never below what the work cost her.
        </div>
      </div>

      <Phone shot="14-product-detail.png" style={{left: 1370, top: 31, ...rise(frame, 20, 24)}} />
    </Scene>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Seven formats — with what each one HONESTLY does. Tiers from
//    web/api/channels/base.py, order from registry.py.
// ─────────────────────────────────────────────────────────────────────────────

const CHANNELS: [string, string, string, string][] = [
  ['Hamara Bazaar', 'A', 'Live', C.ok],
  ['ONDC', 'A', 'Mapped · dry run until the subscriber id is issued', C.muted],
  ['GeM', 'C', 'Bulk workbook rendered · she uploads it', C.ink],
  ['Amazon', 'B', 'One tap, after a one-time connect', C.ink],
  ['Flipkart', 'B', 'One tap, after a one-time connect', C.ink],
  ['Meesho', 'D', 'Guided copy-paste, field by field', C.ink],
  ['WhatsApp', 'D', 'Guided copy-paste, field by field', C.ink],
];

export const SceneChannels: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene durationInFrames={DUR.channels}>
      <div style={{position: 'absolute', left: PAD, top: 96, ...rise(frame, 0, 14)}}>
        <Kicker>✱ One catalogue, seven formats</Kicker>
      </div>
      <Headline style={{position: 'absolute', left: PAD, top: 150, width: 1500, ...rise(frame, 6, 22)}}>
        Where an API exists, it is one tap. Where it doesn't, she is handed the exact text.
      </Headline>

      <div style={{position: 'absolute', left: PAD, top: 352, width: 1760}}>
        {CHANNELS.map(([name, tier, status, colour], i) => (
          <div
            key={name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 34,
              padding: '16px 0',
              borderTop: `1px solid ${C.hair}`,
              ...rise(frame, 30 + i * 14, 16, 18),
            }}
          >
            <span style={{font: `500 26px/1 ${MONO}`, color: C.coral, width: 40}}>{tier}</span>
            <span style={{font: `500 46px/1 ${SANS}`, color: C.ink, width: 420}}>{name}</span>
            <span style={{font: `400 34px/1.3 ${SANS}`, color: colour, flex: 1}}>{status}</span>
          </div>
        ))}
      </div>

      <MonoUp style={{position: 'absolute', left: PAD, top: 940, ...rise(frame, 150, 20)}}>
        Tier A owns the write path · B is a real API after OAuth · C renders a file · D is guided
      </MonoUp>
    </Scene>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. The business manager — the stated USP, given its own full stop.
// ─────────────────────────────────────────────────────────────────────────────

const MANAGER = [
  ['Orders', 'tracked on the same screen she listed from'],
  ['Restock', 'flagged before the listing goes dead'],
  ['Price', 'corrected by what actually sold, not by a guess'],
];

export const SceneManager: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene durationInFrames={DUR.manager}>
      <div style={{position: 'absolute', left: PAD, top: 96, ...rise(frame, 0, 14)}}>
        <Kicker>✱ And then it keeps learning</Kicker>
      </div>
      <Headline style={{position: 'absolute', left: PAD, top: 150, width: 1100, ...rise(frame, 6, 22)}}>
        The listing is the start, not the finish.
      </Headline>

      <div style={{position: 'absolute', left: PAD, top: 400, width: 1180}}>
        {MANAGER.map(([k, v], i) => (
          <Card key={k} style={{padding: '34px 38px', marginBottom: 20, ...rise(frame, 30 + i * 18, 18)}}>
            <div style={{font: `500 24px/1 ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.coral}}>{k}</div>
            <div style={{font: `400 40px/1.35 ${SANS}`, color: C.ink, marginTop: 14}}>{v}</div>
          </Card>
        ))}
      </div>

      <Phone shot="01-home.png" style={{left: 1370, top: 31, ...rise(frame, 18, 24)}} />
    </Scene>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. The stack, and the sign-off.
// ─────────────────────────────────────────────────────────────────────────────

const LANGS = ['हिन्दी', 'ଓଡ଼ିଆ', 'English', 'বাংলা', 'தமிழ்', 'मराठी', 'ગુજરાતી', 'ಕನ್ನಡ', 'తెలుగు', 'ਪੰਜਾਬੀ'];

export const SceneBhashini: React.FC = () => {
  const frame = useCurrentFrame();
  const lang = LANGS[Math.floor(frame / 9) % LANGS.length];
  return (
    <Scene durationInFrames={DUR.bhashini}>
      <div style={{position: 'absolute', left: PAD, top: 200, width: 1760, ...rise(frame, 0, 20)}}>
        <Kicker>✱ The stack underneath</Kicker>
        <Headline style={{marginTop: 26, width: 1500}}>Built to run on India's BHASHINI stack.</Headline>
      </div>

      <div style={{position: 'absolute', left: PAD, top: 470, display: 'flex', gap: 110}}>
        <div style={{...rise(frame, 24, 20)}}>
          <div style={{font: `400 150px/1 ${SERIF}`, color: C.ink}}>36</div>
          <MonoUp style={{marginTop: 12}}>Indian languages available</MonoUp>
        </div>
        <div style={{...rise(frame, 36, 20)}}>
          <div style={{font: `400 150px/1 ${SERIF}`, color: C.ink}}>350+</div>
          <MonoUp style={{marginTop: 12}}>AI models on the platform</MonoUp>
        </div>
        <div style={{...rise(frame, 48, 20)}}>
          <div style={{font: `400 150px/1 ${DEVA}`, color: C.coral, minWidth: 380}}>{lang}</div>
          <MonoUp style={{marginTop: 12}}>Hindi, Odia and English ship at launch</MonoUp>
        </div>
      </div>

      <div style={{position: 'absolute', left: PAD, top: 820, ...rise(frame, 90, 24)}}>
        <div style={{font: `400 96px/1.1 ${SERIF}`, color: C.ink}}>The artisan speaks.</div>
        <div style={{font: `400 96px/1.1 ${SERIF}`, color: C.coral, marginTop: 6}}>The AI sells.</div>
      </div>
    </Scene>
  );
};
