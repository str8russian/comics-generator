import React from 'react';
import {AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import type {Asset, DialogueScene, Line, Panel, Scene, Storyboard, TextCardScene, TemplateScene, Theme} from './types';
import {TEMPLATES} from './templates';

// Data-driven renderer. Every duration comes from the storyboard; nothing here
// computes timing. Swapping this for the Swift/AVFoundation renderer means
// reimplementing this file against the same JSON, with this output as the oracle.

const RENDERER_VERSION = 1;

const SUPPORTED_FEATURES = new Set([
  'layout.single', 'layout.split2', 'layout.split3',
  'panel.insert', 'panel.flip', 'shot.close', 'shot.extreme',
  'asset.placeholder', 'scene.textCard', 'scene.template',
  'transition.crossfade', 'transition.fadeFromBlack',
  'text.typewriter', 'camera.kenBurns',
]);

const DEFAULT_THEME: Required<Omit<Theme, 'fontFile'>> = {
  backgroundColor: '#02090b',
  panelGutterPx: 8,
  dialogueBarHeightPx: 300,
  dialogueBarColor: '#030607',
  dialogueBarBorderColor: '#536064',
  textColor: '#f6f4ed',
  fontFamily: 'Arial, Helvetica, sans-serif',
};

const SINGLE_SHOT_SIZE: Record<string, number> = {wide: 950, medium: 1100, close: 1500, extreme: 1920};

// --- unsupported-feature reporting ---------------------------------------

const unsupported = (sb: Storyboard): string[] => {
  const missing = (sb.requiredFeatures ?? []).filter((f) => !SUPPORTED_FEATURES.has(f));
  if ((sb.minimumRendererVersion ?? 1) > RENDERER_VERSION) {
    missing.push(`minimumRendererVersion ${sb.minimumRendererVersion} > ${RENDERER_VERSION}`);
  }
  return missing;
};

const RefusalScreen: React.FC<{reasons: string[]}> = ({reasons}) => (
  <AbsoluteFill style={{background: '#2a0b0b', color: '#ffd9d9', padding: 90, fontFamily: 'monospace', fontSize: 32, gap: 18}}>
    <div style={{fontSize: 46, fontWeight: 700}}>Project cannot be rendered</div>
    {reasons.map((r) => <div key={r}>• {r}</div>)}
  </AbsoluteFill>
);

// --- asset drawing --------------------------------------------------------

const PlaceholderCard: React.FC<{text: string; theme: Theme}> = ({text, theme}) => (
  <AbsoluteFill
    style={{
      background: 'repeating-linear-gradient(135deg, #123038 0 28px, #0d262c 28px 56px)',
      border: '4px dashed #3f6a74',
      color: '#dbe9ec',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 56,
      textAlign: 'center',
      fontFamily: theme.fontFamily,
      fontSize: 40,
      lineHeight: 1.25,
      boxSizing: 'border-box',
    }}
  >
    {text}
  </AbsoluteFill>
);

const AssetLayer: React.FC<{
  asset: Asset;
  isSingle: boolean;
  shot: string;
  flip?: boolean;
  scale: number;
  theme: Theme;
}> = ({asset, isSingle, shot, flip, scale, theme}) => {
  if (asset.kind === 'placeholder') {
    return <PlaceholderCard text={asset.visibleDescription} theme={theme} />;
  }
  const size = SINGLE_SHOT_SIZE[shot] ?? SINGLE_SHOT_SIZE.medium;
  // Emit only the transforms that actually do something. An identity scaleX(1)/scale(1)
  // changes how the browser rasterises the image and breaks pixel parity with a
  // composition that omits it — which matters because parity is the oracle for the
  // Swift renderer later.
  const ops = [flip ? 'scaleX(-1)' : null, scale !== 1 ? `scale(${scale})` : null].filter(Boolean);
  const style: React.CSSProperties = isSingle
    ? {
        position: 'absolute',
        width: size,
        height: size,
        maxWidth: 'none',
        left: '50%',
        top: '50%',
        transform: ['translate(-50%, -50%)', ...ops].join(' '),
        transformOrigin: 'center',
        objectFit: 'cover',
      }
    : {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: ops.length ? ops.join(' ') : undefined,
        transformOrigin: 'center',
      };
  return <Img src={staticFile(asset.path)} style={style} />;
};

// --- dialogue -------------------------------------------------------------

const assetForPanel = (sb: Storyboard, panel: Panel): Asset | null => {
  if (panel.kind === 'insert') return panel.asset;
  const sheet = sb.expressionSheets.find((s) => s.characterId === panel.characterId);
  return sheet?.entries.find((e) => e.id === panel.expressionId)?.asset ?? null;
};

const PanelLayer: React.FC<{
  sb: Storyboard; panel: Panel; index: number; count: number; scale: number; theme: Theme;
}> = ({sb, panel, index, count, scale, theme}) => {
  const asset = assetForPanel(sb, panel);
  return (
    <div
      style={{
        position: 'relative',
        width: `${100 / count}%`,
        height: '100%',
        overflow: 'hidden',
        borderLeft: index > 0 ? `${theme.panelGutterPx ?? 8}px solid ${theme.backgroundColor}` : undefined,
        boxSizing: 'border-box',
        backgroundColor: '#082b31',
      }}
    >
      {asset ? (
        <AssetLayer
          asset={asset}
          isSingle={count === 1}
          shot={panel.shot}
          flip={panel.flipHorizontal}
          scale={scale}
          theme={theme}
        />
      ) : (
        <PlaceholderCard text={`missing asset: ${panel.kind === 'character' ? panel.expressionId : 'insert'}`} theme={theme} />
      )}
    </div>
  );
};

const activeLineAt = (scene: DialogueScene, frame: number): {line: Line; local: number} => {
  let elapsed = 0;
  for (const line of scene.lines) {
    const dur = line.preRollFrames + line.revealFrames + line.holdFrames;
    if (frame < elapsed + dur) return {line, local: frame - elapsed};
    elapsed += dur;
  }
  const last = scene.lines[scene.lines.length - 1];
  return {line: last, local: last.preRollFrames + last.revealFrames + last.holdFrames};
};

const fontSizeFor = (text: string, split: boolean) => {
  if (split) {
    if (text.length > 120) return 31;
    if (text.length > 80) return 34;
    if (text.length > 45) return 38;
    return 44;
  }
  if (text.length > 125) return 42;
  if (text.length > 90) return 46;
  if (text.length > 60) return 51;
  return 58;
};

const PanelStrip: React.FC<{sb: Storyboard; scene: DialogueScene; theme: Theme; scale: number}> = ({sb, scene, theme, scale}) => (
  <div style={{position: 'absolute', inset: `0 0 ${theme.dialogueBarHeightPx ?? 300}px 0`, display: 'flex'}}>
    {scene.panels.map((panel, i) => (
      <PanelLayer
        key={`${scene.id}-p${i}`}
        sb={sb}
        panel={panel}
        index={i}
        count={scene.panels.length}
        scale={scale}
        theme={theme}
      />
    ))}
  </div>
);

const DialogueSceneView: React.FC<{sb: Storyboard; scene: DialogueScene; previous?: Scene; theme: Theme}> = ({
  sb, scene, previous, theme,
}) => {
  const frame = useCurrentFrame();
  const {line, local} = activeLineAt(scene, frame);

  const cps = sb.project.timing.charactersPerSecond;
  const visibleCount = Math.max(0, Math.floor(((local - line.preRollFrames) / sb.project.fps) * cps));
  const chars = Array.from(line.text);
  const visibleText = chars.slice(0, visibleCount).join('');
  const isSplit = scene.panels.length > 1;

  // Style-level slow push-in. Applied uniformly to single-panel shots, never per scene.
  const kb = sb.style.kenBurnsScale ?? 1;
  const scale = kb > 1 && !isSplit
    ? interpolate(frame, [0, scene.durationFrames], [kb, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 1;

  // Crossfade: the previous panel strip stays underneath while this one fades in.
  // Legal only when the panels are otherwise identical, so this reads as the face
  // changing rather than the whole image popping.
  const xf = scene.transitionIn?.kind === 'crossfade' ? (scene.transitionIn.durationFrames ?? 6) : 0;
  const panelOpacity = xf > 0
    ? interpolate(frame, [0, xf], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    : 1;

  return (
    <AbsoluteFill style={{backgroundColor: theme.backgroundColor, fontFamily: theme.fontFamily}}>
      {xf > 0 && previous?.kind === 'dialogue' ? (
        <PanelStrip sb={sb} scene={previous} theme={theme} scale={scale} />
      ) : null}
      <div style={{opacity: panelOpacity}}>
        <PanelStrip sb={sb} scene={scene} theme={theme} scale={scale} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: theme.dialogueBarHeightPx ?? 300,
          background: theme.dialogueBarColor,
          borderTop: `2px solid ${theme.dialogueBarBorderColor}`,
          display: 'flex',
          boxSizing: 'border-box',
          color: theme.textColor,
        }}
      >
        {scene.panels.map((panel, i) => {
          const isSpeaking = panel.kind === 'character' && panel.characterId === line.speakerId;
          return (
            <div
              key={`${scene.id}-t${i}`}
              style={{
                width: `${100 / scene.panels.length}%`,
                height: '100%',
                padding: isSplit ? '34px 44px 24px' : '38px 70px 26px',
                boxSizing: 'border-box',
                borderLeft: i > 0 ? `${theme.panelGutterPx ?? 8}px solid ${theme.backgroundColor}` : undefined,
                display: 'flex',
                alignItems: 'flex-start',
              }}
            >
              {isSpeaking && line.text !== '' ? (
                <div style={{fontSize: fontSizeFor(line.text, isSplit), lineHeight: 1.18, fontWeight: 500, letterSpacing: 0.1, whiteSpace: 'pre-wrap'}}>
                  {visibleText}
                  {visibleCount < chars.length ? <span>▍</span> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// --- text card ------------------------------------------------------------

const TextCardSceneView: React.FC<{scene: TextCardScene; theme: Theme}> = ({scene, theme}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const isOutro = scene.variant === 'outro';
  return (
    <AbsoluteFill
      style={{
        background: theme.backgroundColor,
        color: theme.textColor,
        fontFamily: theme.fontFamily,
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 140,
        gap: 26,
        opacity,
      }}
    >
      {scene.lines.map((l, i) => (
        <div key={i} style={{fontSize: isOutro ? 44 : i === 0 ? 62 : 40, fontWeight: i === 0 ? 800 : 500, letterSpacing: isOutro ? 1 : 3}}>
          {l}
        </div>
      ))}
    </AbsoluteFill>
  );
};

// --- template -------------------------------------------------------------

const TemplateSceneView: React.FC<{sb: Storyboard; scene: TemplateScene; theme: Theme}> = ({sb, scene, theme}) => {
  const Template = TEMPLATES[scene.templateId];
  if (!Template) {
    return <RefusalScreen reasons={[`unknown templateId "${scene.templateId}"`]} />;
  }
  return <Template sb={sb} scene={scene} theme={theme} />;
};

// --- root -----------------------------------------------------------------

export const StoryboardVideo: React.FC<{storyboard: Storyboard}> = ({storyboard}) => {
  const missing = unsupported(storyboard);
  if (missing.length > 0) return <RefusalScreen reasons={missing} />;

  const theme = {...DEFAULT_THEME, ...(storyboard.theme ?? {})};

  let cursor = 0;
  const placed = storyboard.scenes.map((scene, i) => {
    const from = cursor;
    cursor += scene.durationFrames;
    return {scene, from, previous: storyboard.scenes[i - 1]};
  });

  return (
    <AbsoluteFill style={{backgroundColor: theme.backgroundColor}}>
      {placed.map(({scene, from, previous}) => (
        <Sequence key={scene.id} from={from} durationInFrames={scene.durationFrames} premountFor={storyboard.project.fps}>
          {scene.kind === 'dialogue' ? (
            <DialogueSceneView sb={storyboard} scene={scene} previous={previous} theme={theme} />
          ) : scene.kind === 'textCard' ? (
            <TextCardSceneView scene={scene} theme={theme} />
          ) : (
            <TemplateSceneView sb={storyboard} scene={scene} theme={theme} />
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
