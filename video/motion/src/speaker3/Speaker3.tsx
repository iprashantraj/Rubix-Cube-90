import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing, Img, staticFile} from 'remotion';
import {ShieldCheck} from 'lucide-react';
import {C, SERIF, SANS, MONO, DEVA, rise, Chip, Card} from '../speaker2/ui';
import {Graph, NODES, NodeCard, nodeBox, NODE_W} from './graph';

export const S3_SECONDS = 68;

/**
 * Speaker 3 — the workflow walk-through, as two alternating sections.
 *
 *   GRAPH    the whole flowchart is on screen. A connector draws from the last node
 *            into the new one, which pops. The viewer always sees how far along we are.
 *   EXPLAIN  that node's card flies to the top-left and stays there as the heading,
 *            while the real app fills the frame underneath it.
 *
 * Then back to the graph for the next line. Beat sheet and the three guards this section
 * must not break: video/SPEAKER3-SPEC.md.
 */

type Beat = {
  id: string;
  at: number;
  /** Seconds the graph holds before the node flies out — long enough to draw its nodes. */
  graph: number;
  /** Which NODES entry becomes the top-left heading. */
  chip?: number;
};

const MORPH = 0.75;

const BEATS: Beat[] = [
  {id: 'intro',   at: 0,    graph: 3.5},
  {id: 'login',   at: 3.5,  graph: 1.5, chip: 0},
  {id: 'capture', at: 12.5, graph: 1.5, chip: 1},
  {id: 'retry',   at: 22.0, graph: 2.6, chip: 3},
  {id: 'voice',   at: 30.0, graph: 1.5, chip: 4},
  {id: 'price',   at: 39.5, graph: 1.5, chip: 5},
  {id: 'listing', at: 47.0, graph: 3.2, chip: 8},
  {id: 'order',   at: 57.5, graph: 2.4, chip: 10},
  {id: 'close',   at: 65.0, graph: 3.0},
];

const beatAt = (t: number) => {
  let b = BEATS[0];
  BEATS.forEach((x) => {
    if (t >= x.at) b = x;
  });
  return b;
};
const endOf = (b: Beat) => BEATS[BEATS.indexOf(b) + 1]?.at ?? S3_SECONDS;

const CHIP_X = 80;
const CHIP_Y = 58;

const Phone: React.FC<{shot: string; w?: number; style?: React.CSSProperties}> = ({shot, w = 400, style}) => (
  <div
    style={{
      position: 'absolute',
      width: w,
      height: Math.round((w / 470) * 1018),
      borderRadius: w * 0.094,
      border: `1px solid ${C.hairStrong}`,
      background: '#fff',
      boxShadow: '0 2px 6px rgba(28,25,23,0.08), 0 22px 60px rgba(28,25,23,0.18)',
      overflow: 'hidden',
      ...style,
    }}
  >
    <Img src={staticFile(`shots/${shot}`)} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center'}} />
  </div>
);

const Lead: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{font: `400 38px/1.4 ${SANS}`, color: C.ink, width: 820, ...style}}>{children}</div>
);

const Note: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{font: `400 29px/1.5 ${SANS}`, color: C.muted, width: 800, ...style}}>{children}</div>
);

export const Speaker3: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const beat = beatAt(t);
  const bt = t - beat.at;            // seconds into this beat
  const bf = frame - beat.at * fps;  // frames into this beat

  const morph = interpolate(bt, [beat.graph, beat.graph + MORPH], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic),
  });
  const hasChip = beat.chip !== undefined;
  const explainIn = interpolate(bt, [beat.graph + MORPH * 0.7, beat.graph + MORPH + 0.5], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const explainOut = interpolate(t, [endOf(beat) - 0.4, endOf(beat)], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const a = explainIn * explainOut;
  // Frames since the explanation began, so every beat's stagger runs from its own zero.
  const ef = bf - (beat.graph + MORPH) * fps;

  // The chip must not stand in for its node before that node has landed, or two cards
  // glow at once: the real one lighting up in the chart and the floating one out front.
  const chipIdx = beat.chip as number | undefined;
  const chipLanded = hasChip && t >= NODES[chipIdx as number].at;
  const chipNode = chipLanded ? NODES[chipIdx as number] : null;
  const box = chipNode ? nodeBox(chipNode) : null;

  return (
    <AbsoluteFill style={{backgroundColor: C.cream}}>
      <Graph
        t={t}
        draw={interpolate(bt, [0, Math.max(0.8, beat.graph - 0.3)], [0, 1], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad),
        })}
        hideIndex={chipLanded ? chipIdx : undefined}
        opacity={hasChip ? 1 - morph : 1}
      />

      {/* The node that flies out of the chart and becomes the heading. At morph 0 it sits
          exactly on its own slot, so the hand-off is invisible. */}
      {chipNode && box && (
        <div
          style={{
            position: 'absolute',
            left: interpolate(morph, [0, 1], [box.x, CHIP_X]),
            top: interpolate(morph, [0, 1], [box.y, CHIP_Y]),
            transform: `scale(${interpolate(morph, [0, 1], [1, 1.04])})`,
            transformOrigin: 'left top',
            width: NODE_W,
          }}
        >
          <NodeCard n={chipNode} state="now" pop={1} at={{x: 0, y: 0}} />
        </div>
      )}

      {/* ── explanations ─────────────────────────────────────────────────────── */}
      {beat.id === 'intro' && (
        <div style={{position: 'absolute', left: 80, top: 62, opacity: interpolate(bt, [0, 0.7], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
            <div style={{font: `400 64px/1 ${SERIF}`, color: C.ink}}>Sunita</div>
            <span style={{font: `600 15px/1 ${MONO}`, letterSpacing: '0.16em', color: C.muted, border: `1px solid ${C.hairStrong}`, borderRadius: 6, padding: '7px 11px'}}>
              ILLUSTRATIVE
            </span>
          </div>
          <div style={{font: `400 30px/1.35 ${SANS}`, color: C.muted, marginTop: 10}}>
            makes clay matkas in Ajmer. One product, start to finish.
          </div>
        </div>
      )}

      {beat.id === 'login' && (
        <div style={{position: 'absolute', inset: 0, opacity: a}}>
          <Lead style={{position: 'absolute', left: 80, top: 280, ...rise(ef, 2, 20)}}>
            She signs in with the beneficiary ID she already has.
          </Lead>
          <Card style={{position: 'absolute', left: 80, top: 420, width: 760, padding: '34px 38px', ...rise(ef, 14, 22)}}>
            <div style={{font: `500 20px/1 ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted}}>Beneficiary ID</div>
            <div style={{font: `500 48px/1 ${MONO}`, color: C.ink, marginTop: 16, letterSpacing: '0.04em'}}>PMV‑RJ‑0416‑2291</div>
            <div style={{display: 'flex', alignItems: 'center', gap: 12, marginTop: 24}}>
              <ShieldCheck size={26} color={C.ok} strokeWidth={2} />
              <span style={{font: `400 27px/1.3 ${SANS}`, color: C.muted}}>PM Vishwakarma · already issued</span>
            </div>
          </Card>
          {/* The officer is a DESTINATION, never a screen — the government dashboard is
              not built. SPEAKER3-SPEC.md guard 1. */}
          <div style={{position: 'absolute', left: 80, top: 680, ...rise(ef, 40, 24)}}>
            <svg width={900} height={60}>
              <circle cx={10} cy={30} r={6} fill={C.coral} />
              <path d="M20 30 L840 30" stroke={C.coral} strokeWidth={2.5} strokeDasharray="9 9" fill="none" />
              <path d="M830 21 L843 30 L830 39" stroke={C.coral} strokeWidth={2.5} fill="none" />
            </svg>
            <Note style={{marginTop: 6, width: 900}}>
              Verification <b style={{color: C.ink, fontWeight: 600}}>routes to the government officer who already does this job.</b> No second identity system.
            </Note>
          </div>
        </div>
      )}

      {beat.id === 'capture' && (
        <div style={{position: 'absolute', inset: 0, opacity: a}}>
          <Phone shot="s3-camera-reject.png" w={410} style={{left: 1290, top: 42, ...rise(ef, 6, 26)}} />
          <Lead style={{position: 'absolute', left: 80, top: 280, width: 1050, ...rise(ef, 2, 20)}}>
            The shutter is genuinely dead until the frame is good enough.
          </Lead>
          <div style={{position: 'absolute', left: 80, top: 430, display: 'flex', flexDirection: 'column', gap: 20}}>
            {[
              ['Blur', 'phone sthir rakhein', 16],
              ['Light', 'roshni mein laayein', 28],
              ['Framing', 'khada · zameen par', 40],
            ].map(([k, hi, at]) => (
              <div key={k as string} style={{display: 'flex', alignItems: 'center', gap: 22, ...rise(ef, at as number, 18)}}>
                <span style={{font: `500 23px/1 ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, width: 140}}>{k}</span>
                <Chip style={{background: C.tile, fontSize: 25}}>{hi}</Chip>
              </div>
            ))}
          </div>
          <Note style={{position: 'absolute', left: 80, top: 730, ...rise(ef, 56, 22)}}>
            Said out loud, in her language — the one problem that matters most, and only that one.
          </Note>
        </div>
      )}

      {beat.id === 'retry' && (
        <div style={{position: 'absolute', inset: 0, opacity: a}}>
          <Phone shot="s3-capture-review.png" w={400} style={{left: 1340, top: 60, ...rise(ef, 20, 26)}} />
          <Lead style={{position: 'absolute', left: 80, top: 280, width: 900, ...rise(ef, 2, 20)}}>
            Background out, light corrected — and if it is not right, she retakes it.
          </Lead>
          <div style={{position: 'absolute', left: 80, top: 420, ...rise(ef, 12, 22)}}>
            <div style={{position: 'relative', width: 380, height: 380, borderRadius: 10, border: `1px solid ${C.hair}`, overflow: 'hidden', background: '#fff'}}>
              <Img src={staticFile('pot-original.png')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
              <div style={{position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - interpolate(ef, [46, 76], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}% 0 0)`}}>
                <Img src={staticFile('pot-cutout.png')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
              </div>
            </div>
            <div style={{font: `500 21px/1 ${MONO}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.coral, marginTop: 18}}>
              as photographed → as listed
            </div>
          </div>
          <Note style={{position: 'absolute', left: 560, top: 470, width: 700, ...rise(ef, 60, 22)}}>
            The retake loop is the only decision node on the whole flowchart — so it is the
            one place the app can send her backwards, and it does.
          </Note>
        </div>
      )}

      {beat.id === 'voice' && (
        <div style={{position: 'absolute', inset: 0, opacity: a}}>
          <Phone shot="s3-voice-listening.png" w={372} style={{left: 1050, top: 52, ...rise(ef, 6, 26)}} />
          <Phone shot="s3-voice-heard.png" w={372} style={{left: 1470, top: 52, ...rise(ef, 52, 26)}} />
          <Lead style={{position: 'absolute', left: 80, top: 280, width: 900, ...rise(ef, 2, 20)}}>
            She talks. It reads her own sentence back and waits for a yes.
          </Lead>
          <div style={{position: 'absolute', left: 80, top: 430, width: 900, font: `500 42px/1.4 ${DEVA}`, color: C.ink, ...rise(ef, 62, 24)}}>
            “यह मिट्टी की सुराही है, हाथ से बनी, अजमेर की”
          </div>
          <div style={{position: 'absolute', left: 80, top: 620, display: 'flex', gap: 14, ...rise(ef, 88, 20)}}>
            <Chip style={{background: C.tile, fontSize: 25}}>never guesses</Chip>
            <Chip style={{background: C.tile, fontSize: 25}}>matka stays matka</Chip>
          </div>
          <Note style={{position: 'absolute', left: 80, top: 730, ...rise(ef, 104, 20)}}>
            We fix the light and the background. We never touch the craft word.
          </Note>
        </div>
      )}

      {beat.id === 'price' && (
        <div style={{position: 'absolute', inset: 0, opacity: a}}>
          <Phone shot="s3-price.png" w={400} style={{left: 1340, top: 60, ...rise(ef, 18, 26)}} />
          <Lead style={{position: 'absolute', left: 80, top: 280, width: 880, ...rise(ef, 2, 20)}}>
            It suggests a price. She accepts — or overrides it.
          </Lead>
          <div style={{position: 'absolute', left: 80, top: 390, display: 'flex', alignItems: 'baseline', gap: 24, ...rise(ef, 14, 22)}}>
            <span style={{font: `400 132px/1 ${SERIF}`, color: C.coral}}>₹1049</span>
            <span style={{font: `500 25px/1 ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted}}>suggested</span>
          </div>
          <Note style={{position: 'absolute', left: 80, top: 590, width: 860, ...rise(ef, 34, 22)}}>
            Floor ₹759 — her material, her hours at the cluster wage, margin. Comparables may
            raise it, never drop it below what the work cost her.
          </Note>
        </div>
      )}

      {beat.id === 'listing' && (
        <div style={{position: 'absolute', inset: 0, opacity: a}}>
          <Phone shot="s3-publish.png" w={372} style={{left: 1470, top: 52, ...rise(ef, 6, 26)}} />
          <Lead style={{position: 'absolute', left: 80, top: 260, width: 1280, ...rise(ef, 2, 20)}}>
            One tap. Where an API exists it is automatic — where it does not, she is handed the exact text for the exact field.
          </Lead>
          <div style={{position: 'absolute', left: 80, top: 410, width: 1300}}>
            {[
              ['Hamara Bazaar', 'A', 'Live', C.ok],
              ['ONDC', 'A', 'Mapped · dry run', C.muted],
              ['GeM', 'C', 'Workbook ready to upload', C.ink],
              ['Amazon', 'B', 'One tap, after connect', C.ink],
              ['Flipkart', 'B', 'One tap, after connect', C.ink],
              ['Meesho', 'D', 'Guided copy-paste', C.ink],
              ['WhatsApp', 'D', 'Guided copy-paste', C.ink],
            ].map(([name, tier, status, colour], i) => (
              <div key={name as string} style={{display: 'flex', alignItems: 'center', gap: 28, padding: '12px 0', borderTop: `1px solid ${C.hair}`, ...rise(ef, 14 + i * 8, 16, 16)}}>
                <span style={{font: `500 23px/1 ${MONO}`, color: C.coral, width: 30}}>{tier}</span>
                <span style={{font: `500 34px/1 ${SANS}`, color: C.ink, width: 360}}>{name}</span>
                <span style={{font: `400 28px/1.3 ${SANS}`, color: colour as string, flex: 1}}>{status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {beat.id === 'order' && (
        <div style={{position: 'absolute', inset: 0, opacity: a}}>
          <Phone shot="s3-home.png" w={400} style={{left: 1340, top: 60, ...rise(ef, 18, 26)}} />
          <Lead style={{position: 'absolute', left: 80, top: 280, width: 900, ...rise(ef, 2, 20)}}>
            An order lands. She tracks it from the same screen she listed from.
          </Lead>
          <div style={{position: 'absolute', left: 80, top: 410, display: 'flex', flexWrap: 'wrap', gap: 12, width: 860, ...rise(ef, 14, 20)}}>
            {['artisan', 'product', 'marketplace', 'orders'].map((x) => (
              <Chip key={x} style={{background: C.tile, fontSize: 25}}>{x}</Chip>
            ))}
          </div>
          <Note style={{position: 'absolute', left: 80, top: 540, width: 880, ...rise(ef, 30, 22)}}>
            One PostgreSQL spine — the same rows the government and buyer views are designed on.
          </Note>
          <Lead style={{position: 'absolute', left: 80, top: 700, width: 880, ...rise(ef, 48, 22)}}>
            And the price assistant learns from what actually sold.
          </Lead>
        </div>
      )}

      {/* Close on the finished chart — the whole walk visible at once behind the line. */}
      {beat.id === 'close' && (
        <div style={{position: 'absolute', inset: 0, background: 'rgba(248,243,241,0.88)', opacity: interpolate(bt, [0, 0.6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
          <div style={{position: 'absolute', left: 80, top: 420}}>
            <div style={{font: `400 118px/1.08 ${SERIF}`, color: C.ink, ...rise(bf, 10, 24)}}>She typed</div>
            <div style={{font: `400 118px/1.08 ${SERIF}`, color: C.coral, ...rise(bf, 24, 24)}}>nothing.</div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
