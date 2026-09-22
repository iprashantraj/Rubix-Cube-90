import React from 'react';
import {Composition} from 'remotion';
import {ArtisanBeats} from './ArtisanBeats';
import {Speaker2, SPEAKER2_FRAMES} from './speaker2/Speaker2';
import {DUR, SceneFive, SceneClean, SceneCatalog, ScenePrice, SceneChannels, SceneManager, SceneBhashini} from './speaker2/Scenes';
import {Speaker3, S3_SECONDS} from './speaker3/Speaker3';

const COMMON = {component: ArtisanBeats, durationInFrames: 180, fps: 30, width: 1920, height: 1080} as const;
const FULL = {fps: 30, width: 1920, height: 1080} as const;

export const RemotionRoot: React.FC = () => (
  <>
    {/* Speaker 1's overlay card. Alpha channel — render to .webm/.mov for editors that key it. */}
    <Composition id="ArtisanBeats-Alpha" {...COMMON} defaultProps={{bg: 'transparent'}} />
    {/* Green screen. Render to .mp4 — chroma-key this one in CapCut on the phone. */}
    <Composition id="ArtisanBeats-Green" {...COMMON} defaultProps={{bg: '#00B140'}} />

    {/* Speaker 2, 0:52 onward. Full frame, cut over the voice-over. */}
    <Composition id="Speaker2" component={Speaker2} durationInFrames={SPEAKER2_FRAMES} {...FULL} />

    {/* The same scenes standalone, so one beat can be re-placed without a full re-render. */}
    <Composition id="S2-01-Five" component={SceneFive} durationInFrames={DUR.five} {...FULL} />
    <Composition id="S2-02-Clean" component={SceneClean} durationInFrames={DUR.clean} {...FULL} />
    <Composition id="S2-03-Catalog" component={SceneCatalog} durationInFrames={DUR.catalog} {...FULL} />
    <Composition id="S2-04-Price" component={ScenePrice} durationInFrames={DUR.price} {...FULL} />
    <Composition id="S2-05-Channels" component={SceneChannels} durationInFrames={DUR.channels} {...FULL} />
    <Composition id="S2-06-Manager" component={SceneManager} durationInFrames={DUR.manager} {...FULL} />
    <Composition id="S2-07-Bhashini" component={SceneBhashini} durationInFrames={DUR.bhashini} {...FULL} />

    {/* Speaker 3, 1:30 onward — the flowchart walked as a timeline beside the live app. */}
    <Composition id="Speaker3" component={Speaker3} durationInFrames={S3_SECONDS * 30} {...FULL} />
  </>
);
