import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import type {Asset, Storyboard, TemplateScene, Theme} from './types';

// Pre-authored compositions. The AI picks a templateId and fills named slots; it never
// designs a layout. That keeps the most heavily art-directed part of the video off the
// creative critical path, and keeps text out of generated images entirely — image models
// still render Cyrillic unreliably, so any baked-in text is a liability.
//
// Every template declares requiredSlots so an asset planner can budget for it. Note that
// a title-card portrait is a DIFFERENT framing from a dialogue portrait: it is an extra
// generated asset per character, not free reuse of the expression sheet.

type TemplateProps = {sb: Storyboard; scene: TemplateScene; theme: Theme};
type Template = React.FC<TemplateProps> & {requiredSlots?: string[]};

const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// A slot may hold either an inline asset or an expression-sheet entry id.
const resolveAsset = (sb: Storyboard, v: unknown): Asset | null => {
  if (v && typeof v === 'object' && 'kind' in (v as Asset)) return v as Asset;
  if (typeof v === 'string') {
    for (const sheet of sb.expressionSheets) {
      const hit = sheet.entries.find((e) => e.id === v);
      if (hit) return hit.asset;
    }
  }
  return null;
};

const SlotImage: React.FC<{asset: Asset | null; style: React.CSSProperties; label?: string}> = ({asset, style, label}) => {
  if (asset?.kind === 'file') return <Img src={staticFile(asset.path)} style={style} />;
  const text = asset?.kind === 'placeholder' ? asset.visibleDescription : (label ?? 'missing asset');
  return (
    <div
      style={{
        ...style,
        background: 'repeating-linear-gradient(135deg, #123038 0 24px, #0d262c 24px 48px)',
        border: '3px dashed #3f6a74',
        color: '#dbe9ec',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 34,
        fontSize: 30,
        lineHeight: 1.25,
        boxSizing: 'border-box',
      }}
    >
      {text}
    </div>
  );
};

// --- opening-card ---------------------------------------------------------

const OpeningCard: Template = ({scene, theme}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], clamp);
  const lineWidth = interpolate(frame, [16, 44], [0, 790], clamp);
  const subtitleOpacity = interpolate(frame, [30, 46], [0, 1], clamp);
  const lift = interpolate(frame, [0, 20], [28, 0], clamp);

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(circle at 50% 42%, #15414a 0%, #092b31 52%, #031317 100%)',
        color: '#f3ead8',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: theme.fontFamily,
      }}
    >
      <div style={{opacity, transform: `translateY(${lift}px)`, textAlign: 'center'}}>
        <div style={{fontSize: 34, fontWeight: 700, letterSpacing: 12}}>{str(scene.slots.supertitle)}</div>
        <div style={{fontSize: 68, fontWeight: 900, letterSpacing: 3, marginTop: 22}}>{str(scene.slots.title)}</div>
      </div>
      <div style={{width: lineWidth, height: 4, background: '#c9a367', margin: '44px 0 34px'}} />
      <div style={{opacity: subtitleOpacity, fontSize: 32, letterSpacing: 6, color: '#b9c8ca'}}>
        {str(scene.slots.subtitle)}
      </div>
    </AbsoluteFill>
  );
};
OpeningCard.requiredSlots = ['supertitle', 'title', 'subtitle'];

// --- cast-title-card (one character per card) ----------------------------

const CastTitleCard: Template = ({sb, scene, theme}) => {
  const frame = useCurrentFrame();
  const accent = str(scene.slots.accent, '#c9a367');
  const portraitX = interpolate(frame, [0, 18], [260, 0], clamp);
  const portraitScale = interpolate(frame, [0, scene.durationFrames], [1.08, 1], clamp);
  const textX = interpolate(frame, [7, 24], [-90, 0], clamp);
  const textOpacity = interpolate(frame, [7, 20], [0, 1], clamp);
  const lineWidth = interpolate(frame, [20, 42], [0, 530], clamp);
  const roleOpacity = interpolate(frame, [30, 46], [0, 1], clamp);
  const accentSweep = interpolate(frame, [0, 18], [-180, 0], clamp);

  return (
    <AbsoluteFill style={{background: '#061e23', color: '#f4ecdf', fontFamily: theme.fontFamily, overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translateX(${portraitX}px)`,
          clipPath: 'polygon(45% 0, 100% 0, 100% 100%, 31% 100%)',
          background: '#0a343b',
        }}
      >
        <SlotImage
          asset={resolveAsset(sb, scene.slots.portrait)}
          label={str(scene.slots.name)}
          style={{position: 'absolute', right: -25, top: -120, width: 1260, height: 1260, objectFit: 'cover', transform: `scale(${portraitScale})`}}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0, width: 990,
          background: 'linear-gradient(90deg, #02090b 0%, #051417 82%, transparent 100%)',
          clipPath: 'polygon(0 0, 88% 0, 100% 100%, 0 100%)',
        }}
      />

      <div style={{position: 'absolute', left: 96, top: 72, fontSize: 30, fontWeight: 800, letterSpacing: 6, color: accent, opacity: textOpacity}}>
        {str(scene.slots.kicker)} {str(scene.slots.number) ? `· ${str(scene.slots.number)}` : ''}
      </div>

      <div style={{position: 'absolute', left: 94, top: 365, transform: `translateX(${textX}px)`, opacity: textOpacity}}>
        <div style={{fontSize: 142, lineHeight: 0.9, fontWeight: 950, letterSpacing: 2}}>{str(scene.slots.name)}</div>
        <div style={{width: lineWidth, height: 6, background: accent, margin: '38px 0 30px'}} />
        <div style={{opacity: roleOpacity, fontSize: 31, fontWeight: 700, letterSpacing: 4, color: '#c7d0d0', maxWidth: 660, lineHeight: 1.35}}>
          {str(scene.slots.role)}
        </div>
      </div>

      <div style={{position: 'absolute', left: accentSweep, bottom: 0, width: 180, height: 18, background: accent}} />
    </AbsoluteFill>
  );
};
CastTitleCard.requiredSlots = ['name', 'role', 'portrait'];

// --- cast-panel-strip (whole cast at once, angled panels) ----------------
// Layout taken from the reference key art: 2–4 vertical panels with a slight shear,
// black gutters between them, and a wordmark block overlaid. Cheap in any renderer
// (a clip path plus a translate) and it introduces the whole cast in one scene
// instead of one scene per character, which matters at 60 seconds.

const CastPanelStrip: Template = ({sb, scene, theme}) => {
  const frame = useCurrentFrame();
  const portraits = arr(scene.slots.portraits);
  const names = arr(scene.slots.names);
  const count = Math.max(portraits.length, 1);
  const titleOpacity = interpolate(frame, [18, 34], [0, 1], clamp);

  return (
    <AbsoluteFill style={{background: '#05100f', fontFamily: theme.fontFamily, color: '#f4ecdf', overflow: 'hidden'}}>
      <div style={{position: 'absolute', inset: '90px 120px 150px 120px', display: 'flex', gap: 18}}>
        {portraits.map((ref, i) => {
          const enter = interpolate(frame, [i * 6, i * 6 + 16], [90, 0], clamp);
          const op = interpolate(frame, [i * 6, i * 6 + 16], [0, 1], clamp);
          const shear = i % 2 === 0 ? 1.8 : -1.8;
          return (
            <div
              key={`${ref}-${i}`}
              style={{
                position: 'relative',
                flex: 1,
                overflow: 'hidden',
                transform: `translateY(${enter}px) rotate(${shear}deg) scale(1.04)`,
                opacity: op,
                background: '#0a343b',
              }}
            >
              <SlotImage
                asset={resolveAsset(sb, ref)}
                label={names[i] ?? ''}
                style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}}
              />
            </div>
          );
        })}
      </div>

      <div style={{position: 'absolute', left: 0, right: 0, bottom: 44, textAlign: 'center', opacity: titleOpacity}}>
        <div style={{fontSize: 26, letterSpacing: 10, color: '#c9a367', fontWeight: 800}}>{str(scene.slots.supertitle)}</div>
        <div style={{fontSize: 58, fontWeight: 950, letterSpacing: 2, marginTop: 10}}>{str(scene.slots.title)}</div>
      </div>

      <div style={{position: 'absolute', left: 0, right: 0, top: 34, textAlign: 'center', fontSize: 24, letterSpacing: 8, color: '#7f9698', opacity: titleOpacity}}>
        {names.filter(Boolean).join('   ·   ').toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};
CastPanelStrip.requiredSlots = ['portraits', 'names', 'title'];

// --- context-document ----------------------------------------------------

const ContextDocument: Template = ({sb, scene, theme}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, scene.durationFrames], [1.045, 1], clamp);
  const body = arr(scene.slots.body);

  const Reveal: React.FC<{from: number; style?: React.CSSProperties; children: React.ReactNode}> = ({from, style, children}) => {
    const opacity = interpolate(frame, [from, from + 14], [0, 1], clamp);
    const y = interpolate(frame, [from, from + 18], [18, 0], clamp);
    return <div style={{...style, opacity, transform: `translateY(${y}px)`}}>{children}</div>;
  };

  return (
    <AbsoluteFill style={{background: '#071c20', fontFamily: theme.fontFamily}}>
      <SlotImage
        asset={resolveAsset(sb, scene.slots.background)}
        label="context background"
        style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}}
      />
      <div style={{position: 'absolute', left: 405, top: 105, width: 1110, height: 840, textAlign: 'center', color: '#14171a'}}>
        <Reveal from={14} style={{fontSize: 27, fontWeight: 800, letterSpacing: 4}}>{str(scene.slots.supertitle)}</Reveal>
        <Reveal from={34} style={{fontSize: 64, lineHeight: 1.05, fontWeight: 950, marginTop: 50}}>{str(scene.slots.title)}</Reveal>
        <Reveal from={54} style={{fontSize: 35, fontWeight: 700, marginTop: 18}}>{str(scene.slots.subtitle)}</Reveal>
        <Reveal from={78} style={{width: 720, height: 3, background: '#8d7958', margin: '54px auto 44px'}}>{' '}</Reveal>
        {body.map((l, i) => {
          const isConnector = Array.from(l).length <= 2; // a bare arrow or dash between claims
          const from = [94, 116, 132][i] ?? 132 + (i - 2) * 18;
          const style: React.CSSProperties = isConnector
            ? {fontSize: 56, fontWeight: 500, marginTop: 18}
            : {fontSize: i === 0 ? 31 : 34, fontWeight: i === 0 ? 700 : 800, lineHeight: 1.3, marginTop: i === 0 ? 0 : 18};
          return <Reveal key={i} from={from} style={style}>{l}</Reveal>;
        })}
      </div>
    </AbsoluteFill>
  );
};
ContextDocument.requiredSlots = ['title', 'background'];

export const TEMPLATES: Record<string, Template> = {
  'opening-card': OpeningCard,
  'cast-title-card': CastTitleCard,
  'cast-panel-strip': CastPanelStrip,
  'context-document': ContextDocument,
};
