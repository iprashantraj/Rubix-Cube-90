import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, Easing, Img, staticFile} from 'remotion';
import {loadFont as loadSerif} from '@remotion/google-fonts/EBGaramond';
import {loadFont as loadSans} from '@remotion/google-fonts/Inter';
import {loadFont as loadMono} from '@remotion/google-fonts/JetBrainsMono';
import {loadFont as loadDeva} from '@remotion/google-fonts/NotoSansDevanagari';

/**
 * The design system, lifted verbatim from video/prototype-1/index.html so this cut and the
 * 90-second cut look like one object. Change a value here only if you change it there too.
 */
export const C = {
  ink: '#1c1917',
  cream: '#f8f3f1',
  tile: '#f7e7e1',
  tileStrong: '#7a2e1a',
  coral: '#9c3d24',
  ok: '#1f9d55',
  muted: '#6b625d',
  hair: 'rgba(28,25,23,0.12)',
  hairStrong: 'rgba(28,25,23,0.20)',
};

export const SERIF = loadSerif().fontFamily;
export const SANS = loadSans().fontFamily;
export const MONO = loadMono().fontFamily;
export const DEVA = loadDeva().fontFamily;

export const PAD = 80;

/** Fade + rise, the only entrance this cut uses. `at` and `dur` are frames. */
export const rise = (frame: number, at: number, dur = 18, travel = 22) => {
  const p = interpolate(frame, [at, at + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return {opacity: p, transform: `translateY(${(1 - p) * travel}px)`};
};

/** Counts to `to` and holds. Returns an integer, so the render is deterministic. */
export const countTo = (frame: number, at: number, to: number, dur = 21) =>
  Math.round(
    interpolate(frame, [at, at + dur], [0, to], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    }),
  );

/** Whole-scene wrapper: cream field, and a fade at both ends so cuts are never hard. */
export const Scene: React.FC<{children: React.ReactNode; durationInFrames: number}> = ({
  children,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const opacity =
    interpolate(frame, [0, 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) *
    interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  return <AbsoluteFill style={{backgroundColor: C.cream, opacity}}>{children}</AbsoluteFill>;
};

export const Kicker: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({
  children,
  style,
}) => (
  <div
    style={{
      font: `500 28px/1 ${MONO}`,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: C.coral,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Headline: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({
  children,
  style,
}) => (
  <div
    style={{
      font: `400 88px/1.06 ${SERIF}`,
      letterSpacing: '-0.018em',
      color: C.ink,
      ...style,
    }}
  >
    {children}
  </div>
);

export const MonoUp: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({
  children,
  style,
}) => (
  <div
    style={{
      font: `500 24px/1.4 ${MONO}`,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: C.muted,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Chip: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({
  children,
  style,
}) => (
  <span
    style={{
      display: 'inline-block',
      font: `500 24px/1 ${MONO}`,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: C.tileStrong,
      background: C.tile,
      borderRadius: 9999,
      padding: '16px 26px',
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    {children}
  </span>
);

/**
 * The phone shell from the 90-second cut. `shot` is a filename under public/shots/.
 * Screens are real app captures, never mockups — video/README.md house rule.
 */
export const Phone: React.FC<{shot: string; style?: React.CSSProperties}> = ({shot, style}) => (
  <div
    style={{
      position: 'absolute',
      width: 470,
      height: 1018,
      borderRadius: 44,
      border: `1px solid ${C.hairStrong}`,
      background: '#fff',
      boxShadow: '0 2px 6px rgba(28,25,23,0.08), 0 18px 48px rgba(28,25,23,0.14)',
      overflow: 'hidden',
      ...style,
    }}
  >
    <Img
      src={staticFile(`shots/${shot}`)}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: 'top center',
      }}
    />
  </div>
);

export const Card: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({
  children,
  style,
}) => (
  <div
    style={{
      background: '#fff',
      border: `1px solid ${C.hair}`,
      borderRadius: 12,
      boxShadow: '0 1px 3px rgba(28,25,23,0.08), 0 4px 16px rgba(28,25,23,0.04)',
      boxSizing: 'border-box',
      ...style,
    }}
  >
    {children}
  </div>
);
