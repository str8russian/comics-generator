import React from 'react';
import {Composition} from 'remotion';
import {TelegramUnblockVideo} from './Video.jsx';
import spec from './video-spec.generated.js';

export const Root = () => (
  <Composition
    id="TelegramUnblockRough"
    component={TelegramUnblockVideo}
    durationInFrames={spec.project.totalDurationFrames}
    fps={spec.project.fps}
    width={spec.project.width}
    height={spec.project.height}
    defaultProps={{spec}}
  />
);
