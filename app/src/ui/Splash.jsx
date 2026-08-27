import { useEffect, useState } from 'react';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import Mark from './Mark.jsx';

/**
 * The opening animation. A loom threading itself.
 *
 * Why this exists at all: the app was showing the stock Capacitor splash — the logo of the
 * toolchain it happens to be built with. For a judge that reads as an unfinished project;
 * for an artisan it is a picture of nothing.
 *
 * Why a LOOM and not a logo reveal. The PS is market linkage and cataloging for
 * marginalised artisans, and the first two seconds are the only moment in the app that is
 * pure statement — nothing is being asked, nothing has to be understood. So it shows the
 * work, not the brand: five warp threads are laid down, five weft threads cross them, the
 * cloth becomes the ikat lozenge, and one thread lifts off the loom and goes somewhere.
 * That last stroke is the entire product. Someone who cannot read the word "Kaarigar" can
 * watch a piece of weaving happen.
 *
 * ⏱ It is not a loading screen and must never become one. Nothing is fetched here, the
 * router is already mounted underneath, and the timeline is fixed — the app is usable the
 * moment this element leaves the tree, whatever the network is doing. Anything that needs
 * to wait for data waits on its own screen, where it can say so out loud.
 *
 * It ran for 2.1s, of which the first 1.18s were spent with the mark INVISIBLE while the
 * loom drew itself. By then the artisan had already seen that mark twice — once on the
 * launcher tile, once on the system splash Android draws from the same PNG — so the app
 * appeared to show it, lose it, and find it again. Now the mark carries straight over from
 * the system splash and the loom draws in behind it, which takes 1.2s in total.
 *
 * ♿ Reduced motion: the CSS at the bottom of styles.css freezes every animation in the
 * app, which for a purely decorative sequence would leave a half-drawn loom on screen
 * forever. So the preference is read here too and the whole thing collapses to a static
 * final frame — nothing is lost, because nothing in this animation carries information the
 * rest of the app does not repeat.
 */

const RUN_MS = 1200;
const FADE_MS = 400;
const STATIC_MS = 900; // reduced motion: long enough to read, short enough not to annoy

export default function Splash({ onDone }) {
  const { lang } = useVoice();
  const [leaving, setLeaving] = useState(false);

  const still =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const hold = setTimeout(() => setLeaving(true), still ? STATIC_MS : RUN_MS);
    const gone = setTimeout(onDone, (still ? STATIC_MS : RUN_MS) + FADE_MS);
    return () => {
      clearTimeout(hold);
      clearTimeout(gone);
    };
  }, [onDone, still]);

  return (
    <div
      className={`splash${leaving ? ' splash--out' : ''}${still ? ' splash--still' : ''}`}
      // The animation says nothing the app does not say again on /home a second later, and
      // announcing a decorative loom over the top of the first screen's spoken prompt is
      // pure noise for the users this app is built for.
      aria-hidden="true"
    >
      <div className="splash__stage">
        <svg className="splash__loom" viewBox="0 0 120 120" aria-hidden="true">
          {/* Warp first — the threads a weaver strings up before any weaving happens.
              Drawn top to bottom via stroke-dashoffset; see .splash__warp in styles.css. */}
          <g className="splash__warp">
            {[30, 45, 60, 75, 90].map((x, i) => (
              <line key={x} x1={x} y1="18" x2={x} y2="102" style={{ '--i': i }} />
            ))}
          </g>
          {/* Weft second, left to right, one after another. This is the part that reads as
              weaving rather than as a grid appearing. */}
          <g className="splash__weft">
            {[30, 45, 60, 75, 90].map((y, i) => (
              <line key={y} x1="18" y1={y} x2="102" y2={y} style={{ '--i': i }} />
            ))}
          </g>
        </svg>

        {/* The cloth resolving into the motif, on top of the loom it came off. */}
        <Mark className="splash__mark" size={120} />
      </div>

      <p className="splash__word">{t(lang, 'app.name')}</p>
      <p className="splash__tag">{t(lang, 'splash.tagline')}</p>
    </div>
  );
}
