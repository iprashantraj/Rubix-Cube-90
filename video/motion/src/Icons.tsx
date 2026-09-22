import React from 'react';
import {interpolate, useCurrentFrame, Easing} from 'remotion';

export const ORANGE = '#EC7C2F';
const S = {fill: 'none', stroke: ORANGE, strokeWidth: 7, strokeLinecap: 'round', strokeLinejoin: 'round'} as const;

/** Stroke length reveal: 0 -> 1 over `dur` frames starting at `from`. */
const useDraw = (from: number, dur: number) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, from + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
};

/** Beat A — hands shaping clay on a turning wheel. */
export const ArtisanIcon: React.FC<{startFrame: number}> = ({startFrame}) => {
  const frame = useCurrentFrame();
  const t = frame - startFrame;
  const draw = useDraw(startFrame, 22);
  const knead = Math.sin(t / 6) * 3; // hands squeeze and release
  const rise = Math.sin(t / 9) * 2.5; // the clay pulls upward under them

  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%">
      {/* the clay on the wheel, still soft: the walls breathe in and out as it is thrown */}
      <g strokeDasharray={900} strokeDashoffset={900 * (1 - draw)}>
        <ellipse cx={100} cy={64 - rise} rx={13} ry={4} {...S} strokeWidth={5} />
        <path
          d={`M87 ${64 - rise} C87 84 ${70 - knead} 96 ${70 - knead} 120 C${70 - knead} 140 84 150 100 150
              C116 150 ${130 + knead} 140 ${130 + knead} 120 C${130 + knead} 96 113 84 113 ${64 - rise}`}
          {...S}
        />
      </g>

      {/* speed arcs either side, so the wheel reads as turning rather than parked */}
      <g opacity={draw * 0.85}>
        <path d={`M42 ${96 + knead} C30 ${108 + knead} 28 ${124 + knead} 36 ${138 + knead}`} {...S} strokeWidth={5} />
        <path d={`M158 ${96 - knead} C170 ${108 - knead} 172 ${124 - knead} 164 ${138 - knead}`} {...S} strokeWidth={5} />
      </g>

      {/* wheelhead: dashed inner ring marches round, so the disc reads as turning */}
      <g transform="translate(100 158)" opacity={draw}>
        <ellipse rx={56} ry={13} {...S} />
        <path d="M-56 0 C-56 10 56 10 56 0" {...S} strokeWidth={5} />
        <ellipse rx={38} ry={8} {...S} strokeWidth={4}
          strokeDasharray="9 13" strokeDashoffset={-t * 3.4} opacity={0.8} />
      </g>
    </svg>
  );
};

const Sparkle: React.FC<{x: number; y: number; r: number; delay: number; startFrame: number}> = ({
  x, y, r, delay, startFrame,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [startFrame + delay, startFrame + delay + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.back(2)),
  });
  // pop in, then breathe
  const breathe = 1 + Math.sin((frame - startFrame - delay) / 7) * 0.12;
  return (
    <g transform={`translate(${x} ${y}) scale(${p * breathe})`} opacity={p}>
      <path d={`M0 ${-r} Q${r * 0.22} ${-r * 0.22} ${r} 0 Q${r * 0.22} ${r * 0.22} 0 ${r} Q${-r * 0.22} ${r * 0.22} ${-r} 0 Q${-r * 0.22} ${-r * 0.22} 0 ${-r} Z`}
        fill={ORANGE} />
    </g>
  );
};

/** Beat B — the finished matka, glaze sweeping across it. */
export const ProductIcon: React.FC<{startFrame: number}> = ({startFrame}) => {
  const frame = useCurrentFrame();
  const draw = useDraw(startFrame, 24);
  // glaze highlight sweeps left -> right once, then rests
  const sweep = interpolate(frame, [startFrame + 18, startFrame + 46], [-70, 210], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });

  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%">
      <defs>
        <clipPath id="potClip">
          <path d="M73 62 C73 80 44 86 44 118 C44 150 69 170 100 170 C131 170 156 150 156 118 C156 86 127 80 127 62 Z" />
        </clipPath>
      </defs>

      <g strokeDasharray={1200} strokeDashoffset={1200 * (1 - draw)}>
        <ellipse cx={100} cy={60} rx={29} ry={9} {...S} />
        <path d="M73 62 C73 80 44 86 44 118 C44 150 69 170 100 170 C131 170 156 150 156 118 C156 86 127 80 127 62" {...S} />
        <path d="M55 136 Q100 154 145 136" {...S} strokeWidth={5} />
      </g>

      {/* glaze sweep, clipped to the pot body */}
      <g clipPath="url(#potClip)" opacity={draw}>
        <rect x={sweep} y={40} width={26} height={150} fill={ORANGE} opacity={0.28}
          transform={`skewX(-14)`} />
      </g>

      <Sparkle x={40} y={52} r={13} delay={26} startFrame={startFrame} />
      <Sparkle x={163} y={78} r={10} delay={32} startFrame={startFrame} />
      <Sparkle x={150} y={38} r={7} delay={38} startFrame={startFrame} />
    </svg>
  );
};

/** Beat C — the product at centre, buyers arriving from every side. */
export const MarketIcon: React.FC<{startFrame: number}> = ({startFrame}) => {
  const frame = useCurrentFrame();
  const t = frame - startFrame;
  const draw = useDraw(startFrame, 16);
  const PINS = 5;
  const RING = 68;

  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%">
      <g transform="translate(100 100)">
        {/* the product, now just a node in a network */}
        <g opacity={draw} strokeDasharray={400} strokeDashoffset={400 * (1 - draw)}>
          <ellipse cx={0} cy={-18} rx={12} ry={4} {...S} strokeWidth={5} />
          <path d="M-12 -17 C-12 -9 -24 -6 -24 6 C-24 19 -13 28 0 28 C13 28 24 19 24 6 C24 -6 12 -9 12 -17" {...S} strokeWidth={5} />
        </g>

        {Array.from({length: PINS}).map((_, i) => {
          const ang = (-90 + (360 / PINS) * i) * (Math.PI / 180);
          const px = Math.cos(ang) * RING;
          const py = Math.sin(ang) * RING;
          const delay = 10 + i * 5;
          const pop = interpolate(t, [delay, delay + 12], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.back(2.2)),
          });
          // demand travels inward: dash offset marches toward the centre
          const dash = -((t - delay) * 2.2);
          return (
            <g key={i}>
              <path
                d={`M${px * 0.72} ${py * 0.72} L${px * 0.34} ${py * 0.34}`}
                {...S}
                strokeWidth={4}
                strokeDasharray="7 7"
                strokeDashoffset={dash}
                opacity={pop * 0.85}
              />
              <g transform={`translate(${px} ${py}) scale(${pop * 0.42})`} opacity={pop}>
                <path d="M0 22 C-16 2 -21 -7 -21 -15 A21 21 0 1 1 21 -15 C21 -7 16 2 0 22 Z" {...S} strokeWidth={13} />
                <circle cx={0} cy={-15} r={7} fill={ORANGE} />
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
};
