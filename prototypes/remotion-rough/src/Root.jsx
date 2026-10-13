import React from 'react';
import {Composition} from 'remotion';
import {TelegramUnblockVideo} from './Video.jsx';
import spec from './video-spec.generated.js';

const emptySpec = {
  schemaVersion: 'storyboard-video-spec-1',
  project: {width: 1920, height: 1080, fps: 30, totalDurationFrames: 36},
  timing: spec.timing,
  theme: {
    backgroundColor: '#02090b',
    panelGutterPx: 48,
    dialogueBarHeightPx: 300,
    dialogueBarColor: '#030607',
    textColor: '#f6f4ed',
    fontFamily: 'Arial, Helvetica, sans-serif',
  },
  frames: [],
};

export const Root = () => (
  <>
    <Composition
      id="TelegramUnblockRough"
      component={TelegramUnblockVideo}
      durationInFrames={spec.project.totalDurationFrames}
      fps={spec.project.fps}
      width={spec.project.width}
      height={spec.project.height}
      defaultProps={{spec}}
    />
    <Composition
      id="CurrentStoryboard"
      component={TelegramUnblockVideo}
      durationInFrames={emptySpec.project.totalDurationFrames}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{spec: emptySpec}}
      calculateMetadata={({props}) => ({
        durationInFrames: Math.max(1, props.spec?.project?.totalDurationFrames || 1),
        fps: props.spec?.project?.fps || 30,
        width: 1920,
        height: 1080,
      })}
    />
  </>
);
