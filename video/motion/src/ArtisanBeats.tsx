import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing} from 'remotion';
import {loadFont as loadSerif} from '@remotion/google-fonts/PlayfairDisplay';
import {loadFont as loadSans} from '@remotion/google-fonts/Inter';
import {ArtisanIcon, ProductIcon, MarketIcon, ORANGE} from './Icons';

const {fontFamily: SERIF} = loadSerif();
const {fontFamily: SANS} = loadSans();

/**
 * Beat timings, in seconds from the start of THIS clip.
 * Clip is placed at 0:19.0 on the master timeline, so t=0 is 19.0s.
 * Tune these three numbers if the voice-over drifts; nothing else needs to change.
 */
const BEATS = [
  {label: 'The artisan works', start: 0.0},
  {label: 'They create beautiful products', start: 2.3},
  {label: 'And a market is waiting', start: 4.4},
];
const TURN = 0.5; // seconds a flip takes

/**
 * Panel geometry, in 1920x1080 space. Sits over the terracotta statue in the
 * left third, so it never covers the speaker's face (x>1050) or the burned-in
 * subtitles (y>940).
 */
const PANEL = {x: 118, y: 168, w: 570, h: 640};

export const ArtisanBeats: React.FC<{bg: string}> = ({bg}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const t = frame / fps;

  const f = (sec: number) => sec * fps;
  const rot = interpolate(
    frame,
    [f(BEATS[1].start - TURN), f(BEATS[1].start), f(BEATS[2].start - TURN), f(BEATS[2].start)],
    [0, 180, 180, 360],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.65, 0, 0.35, 1)},
  );

  // Swap the icon while the card is edge-on (mid-flip), so the cut is invisible.
  const idx = t < BEATS[1].start - TURN / 2 ? 0 : t < BEATS[2].start - TURN / 2 ? 1 : 2;
  const beatStart = f(BEATS[idx].start) - (idx === 0 ? 0 : f(TURN) / 2);

  // Panel wipes up on entry, and drops away on exit.
  const enter = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic),
  });
  const vis = enter * exit;

  // Label crossfades on the beat rather than flipping with the card.
  const labelIn = interpolate(frame, [beatStart + 6, beatStart + 18], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{backgroundColor: bg}}>
      <div
        style={{
          position: 'absolute',
          left: PANEL.x,
          top: PANEL.y,
          width: PANEL.w,
          height: PANEL.h,
          opacity: vis,
          transform: `translateY(${(1 - enter) * 40}px)`,
          borderRadius: 30,
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.95)',
          boxShadow: '0 18px 52px rgba(0,0,0,0.30)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* house-style orange spine, matching the "1. Middleman" cards at 0:30 */}
        <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, background: ORANGE}} />

        <div style={{perspective: 1400, marginTop: 62, width: 340, height: 340}}>
          <div
            style={{
              width: '100%',
              height: '100%',
              transformStyle: 'preserve-3d',
              transform: `rotateY(${rot}deg)`,
            }}
          >
            {/* un-mirror the middle beat, which lands on the card's back face */}
            <div style={{width: '100%', height: '100%', transform: `rotateY(${idx === 1 ? 180 : 0}deg)`}}>
              {idx === 0 && <ArtisanIcon startFrame={beatStart} />}
              {idx === 1 && <ProductIcon startFrame={beatStart} />}
              {idx === 2 && <MarketIcon startFrame={beatStart} />}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 26,
            padding: '0 44px',
            textAlign: 'center',
            opacity: labelIn,
            transform: `translateY(${(1 - labelIn) * 14}px)`,
          }}
        >
          <div style={{fontFamily: SERIF, fontStyle: 'italic', fontWeight: 600, fontSize: 46, lineHeight: 1.18, color: '#141414'}}>
            {BEATS[idx].label}
          </div>
        </div>

        {/* beat pips, so the viewer reads this as 1-of-3 */}
        <div style={{position: 'absolute', bottom: 34, display: 'flex', gap: 12}}>
          {BEATS.map((_, i) => (
            <div key={i} style={{
              width: i === idx ? 30 : 10, height: 10, borderRadius: 5,
              background: i === idx ? ORANGE : 'rgba(20,20,20,0.20)',
              transition: 'none',
            }} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const FONT_FAMILIES = {SERIF, SANS};
