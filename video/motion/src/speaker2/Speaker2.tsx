import React from 'react';
import {Series, AbsoluteFill} from 'remotion';
import {C} from './ui';
import {DUR, SceneFive, SceneClean, SceneCatalog, ScenePrice, SceneChannels, SceneManager, SceneBhashini} from './Scenes';

/**
 * Speaker 2's section, 0:52 onward on the master timeline.
 *
 * Laid out so the beats land where the edit needs them:
 *
 *   0:52  five things        the list, while she names them
 *   1:00  the photograph     the wipe fires at ~1:02
 *   1:10  the listing        one sentence -> per-channel text, with Copy
 *   1:22  the price          floor, then the market
 *   1:31  seven formats      \
 *   1:38  business manager    |  spill past her 1:30; cut or re-place as needed
 *   1:43  BHASHINI + sign-off/
 *
 * Every scene also renders standalone — see Root.tsx — so any one of them can be
 * dropped on the timeline by itself without re-rendering the rest.
 */
export const Speaker2: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: C.cream}}>
    <Series>
      <Series.Sequence durationInFrames={DUR.five}><SceneFive /></Series.Sequence>
      <Series.Sequence durationInFrames={DUR.clean}><SceneClean /></Series.Sequence>
      <Series.Sequence durationInFrames={DUR.catalog}><SceneCatalog /></Series.Sequence>
      <Series.Sequence durationInFrames={DUR.price}><ScenePrice /></Series.Sequence>
      <Series.Sequence durationInFrames={DUR.channels}><SceneChannels /></Series.Sequence>
      <Series.Sequence durationInFrames={DUR.manager}><SceneManager /></Series.Sequence>
      <Series.Sequence durationInFrames={DUR.bhashini}><SceneBhashini /></Series.Sequence>
    </Series>
  </AbsoluteFill>
);

export const SPEAKER2_FRAMES = Object.values(DUR).reduce((a, b) => a + b, 0);
