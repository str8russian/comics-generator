import React from 'react';
import {AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame} from 'remotion';

const fontSizeFor = (text, split) => {
  const length = Array.from(text).length;
  if (split) {
    if (length > 120) return 31;
    if (length > 80) return 34;
    if (length > 45) return 38;
    return 44;
  }
  if (length > 125) return 42;
  if (length > 90) return 46;
  if (length > 60) return 51;
  return 58;
};

const FrameView = ({frame, spec}) => {
  const localFrame = useCurrentFrame();
  const {theme} = spec;
  const split = frame.panels.length > 1;
  const hasDialogue = frame.dialogue.trim().length > 0;
  const characters = Array.from(frame.dialogue);
  const typedFrames = Math.max(0, localFrame - frame.preRollFrames);
  const visibleCount = Math.min(
    characters.length,
    Math.floor((typedFrames / spec.project.fps) * spec.timing.charactersPerSecond),
  );
  const visibleText = characters.slice(0, visibleCount).join('');
  const typingHasStarted = localFrame >= frame.preRollFrames;
  const isTyping = typingHasStarted && visibleCount < characters.length;
  const visualBottom = hasDialogue ? theme.dialogueBarHeightPx : 0;

  return (
    <AbsoluteFill style={{backgroundColor: theme.backgroundColor, color: theme.textColor, fontFamily: theme.fontFamily}}>
      <div style={{position: 'absolute', inset: `0 0 ${visualBottom}px 0`, display: 'flex'}}>
        {frame.panels.map((panel, index) => (
          <div
            key={`${frame.id}-panel-${index}`}
            style={{
              position: 'relative',
              flex: '1 1 0',
              minWidth: 0,
              height: '100%',
              overflow: 'hidden',
              boxSizing: 'border-box',
              borderLeft: index > 0 ? `${theme.panelGutterPx}px solid ${theme.backgroundColor}` : undefined,
              backgroundColor: '#082b31',
            }}
          >
            <Img
              src={staticFile(panel.asset)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit: 'cover',
                objectPosition: panel.position,
                transformOrigin: panel.align,
                transform: `scale(${panel.zoom})`,
              }}
            />
          </div>
        ))}
      </div>

      {hasDialogue ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: theme.dialogueBarHeightPx,
            display: 'flex',
            boxSizing: 'border-box',
            borderTop: `2px solid ${theme.dialogueBarBorderColor}`,
            background: theme.dialogueBarColor,
          }}
        >
          {frame.panels.map((panel, index) => (
            <div
              key={`${frame.id}-dialogue-${index}`}
              style={{
                display: 'flex',
                flex: '1 1 0',
                minWidth: 0,
                height: '100%',
                alignItems: 'flex-start',
                overflow: 'hidden',
                boxSizing: 'border-box',
                padding: split ? '34px 44px 24px' : '38px 70px 26px',
                borderLeft: index > 0 ? `${theme.panelGutterPx}px solid ${theme.backgroundColor}` : undefined,
              }}
            >
              {index === frame.speakerPanel ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: fontSizeFor(frame.dialogue, split),
                    fontWeight: 500,
                    letterSpacing: 0.1,
                    lineHeight: 1.18,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {visibleText}
                  {isTyping ? <span>▍</span> : null}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const TelegramUnblockVideo = ({spec}) => (
  <AbsoluteFill style={{backgroundColor: spec.theme.backgroundColor}}>
    {spec.frames.map((frame) => (
      <Sequence key={frame.id} from={frame.startFrame} durationInFrames={frame.durationFrames} name={frame.id}>
        <FrameView frame={frame} spec={spec} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
