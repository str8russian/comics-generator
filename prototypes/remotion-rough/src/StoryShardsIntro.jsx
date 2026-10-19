import React from 'react';
import {AbsoluteFill, Img, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {
  DISPLAY_FONT_FAMILY,
  DISPLAY_FONT_FILE,
  DISPLAY_FONT_WEIGHT_RANGE,
  EYEBROW_FONT_WEIGHT,
  NAME_FONT_WEIGHT,
  TITLE_FONT_WEIGHT,
  nameSize,
  titleLines,
  titleSize,
} from './story-shards-display.mjs';
import {shardFrame} from './story-shards-motion.mjs';

const SX = 1920 / 1280;
const SY = 1080 / 720;
const INK = '#02090b';
const PAPER = '#f2ede0';
const GOLD = '#f0d699';
const EYEBROW = '#949494';
const RULE = '#c2c2c2';

const NAME_PLACEMENTS = {
  2: [
    {x: 68, y: 286, width: 460, align: 'left', ruleX: 68, ruleY: 352, ruleWidth: 228},
    {x: 752, y: 290, width: 460, align: 'right', ruleX: 984, ruleY: 356, ruleWidth: 228},
  ],
  3: [
    {x: 48, y: 292, width: 370, align: 'left', ruleX: 48, ruleY: 358, ruleWidth: 180},
    {x: 455, y: 292, width: 370, align: 'center', ruleX: 550, ruleY: 358, ruleWidth: 180},
    {x: 862, y: 292, width: 370, align: 'right', ruleX: 1052, ruleY: 358, ruleWidth: 180},
  ],
};

const TITLE_POLYGON = [[406, 230], [866, 218], [918, 506], [356, 520]];
const TITLE_CENTER = [637, 368];

function installDisplayFont() {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  const handle = delayRender('story-shards display font');
  const face = new FontFace(
    DISPLAY_FONT_FAMILY,
    `url(${staticFile(DISPLAY_FONT_FILE)}) format('truetype')`,
    {weight: DISPLAY_FONT_WEIGHT_RANGE, style: 'normal', display: 'block'},
  );
  face.load()
    .then((loaded) => {
      document.fonts.add(loaded);
      return Promise.all([
        document.fonts.load(`${EYEBROW_FONT_WEIGHT} 32px "${DISPLAY_FONT_FAMILY}"`),
        document.fonts.load(`${NAME_FONT_WEIGHT} 64px "${DISPLAY_FONT_FAMILY}"`),
      ]);
    })
    .then((loaded) => {
      if (loaded.some((faces) => faces.length === 0)) {
        throw new Error('story-shards display font did not become ready');
      }
      return document.fonts.ready;
    })
    .then(() => continueRender(handle))
    .catch((error) => cancelRender(error));
}

installDisplayFont();

function clamp(value, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, value));
}

function easeOut(value) {
  const x = clamp(value);
  return 1 - (1 - x) ** 3;
}

function easeInOut(value) {
  const x = clamp(value);
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
}

function progress(time, start, duration) {
  if (duration <= 0) return time >= start ? 1 : 0;
  return clamp((time - start) / duration);
}

function scalePoint([x, y]) {
  return [x * SX, y * SY];
}

function imageSource(asset) {
  if (!asset) return null;
  if (asset.startsWith('http://') || asset.startsWith('https://') || asset.startsWith('data:')) return asset;
  return asset;
}

const Shard = ({shard, frame, fps}) => {
  const state = shardFrame({
    slot: shard.slot,
    frame,
    fps,
    enterStartFrame: shard.enterStartFrame,
    enterDurationFrames: shard.enterDurationFrames,
  });
  if (state.enter <= 0) return null;
  const src = imageSource(shard.asset);
  return (
    <div
      style={{
        position: 'absolute',
        left: state.box.left,
        top: state.box.top,
        width: state.box.width,
        height: state.box.height,
        overflow: 'hidden',
        clipPath: state.clipPath,
        backgroundColor: '#061016',
      }}
    >
      {src ? (
        <Img
          src={src}
          style={{
            position: 'absolute',
            left: state.image.left,
            top: state.image.top,
            width: state.image.width,
            height: state.image.height,
            objectFit: 'cover',
          }}
        />
      ) : null}
      {state.dots ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(rgba(242,237,224,0.05) 1px, transparent 1.4px)',
            backgroundSize: '48px 48px',
          }}
        />
      ) : null}
      <svg width={state.box.width} height={state.box.height} style={{position: 'absolute', inset: 0}}>
        <polygon
          points={state.points.map(([x, y]) => `${x - state.box.left},${y - state.box.top}`).join(' ')}
          fill="none"
          stroke={INK}
          strokeWidth={16}
        />
      </svg>
    </div>
  );
};

export const StoryShardsIntro = ({intro}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const time = frame / fps;
  const sequence = intro?.sequence || {};
  const characters = Array.isArray(intro?.characters) ? intro.characters : [];
  const placements = NAME_PLACEMENTS[characters.length] || NAME_PLACEMENTS[2];
  const titleIn = easeOut(progress(
    time,
    (sequence.titleStartFrame || 0) / fps,
    (sequence.titleEnterFrames || 1) / fps,
  ));
  const close = easeInOut(progress(
    time,
    (sequence.closeStartFrame || 0) / fps,
    (sequence.closeFrames || 1) / fps,
  ));
  const titleScale = 0.84 + (1 - 0.84) * titleIn;
  const titlePoints = TITLE_POLYGON.map(([x, y]) => scalePoint([
    TITLE_CENTER[0] + (x - TITLE_CENTER[0]) * titleScale,
    TITLE_CENTER[1] + (y - TITLE_CENTER[1]) * titleScale,
  ]));
  const lines = titleLines(intro?.text?.title);
  const margin = 650 + (-80 - 650) * close;
  const closePoints = [
    [margin, margin * 0.55],
    [1280 - margin, margin * 0.40],
    [1280 - margin * 0.85, 720 - margin * 0.40],
    [margin * 0.82, 720 - margin * 0.55],
  ].map(scalePoint);

  return (
    <AbsoluteFill style={{backgroundColor: INK, color: PAPER, fontFamily: `"${DISPLAY_FONT_FAMILY}"`, overflow: 'hidden'}}>
      {(intro?.shards || []).map((shard) => (
        <Shard key={shard.slot} shard={shard} frame={frame} fps={fps} />
      ))}
      {characters.map((character, index) => {
        const place = placements[index];
        if (!place) return null;
        const start = (character.nameStartFrame ?? sequence.namesStartFrame ?? 0) / fps;
        const appear = easeOut(progress(time, start, (sequence.nameEnterFrames || 11) / fps));
        const fade = 1 - easeOut(progress(time, (sequence.namesFadeFrame || 0) / fps, (sequence.nameFadeFrames || 9) / fps));
        const alpha = appear * fade;
        if (alpha <= 0) return null;
        const ruleWidth = place.ruleWidth * alpha * SX;
        const ruleLeft = place.align === 'right'
          ? (place.ruleX + place.ruleWidth) * SX - ruleWidth
          : place.align === 'center'
            ? (place.ruleX + place.ruleWidth / 2) * SX - ruleWidth / 2
            : place.ruleX * SX;
        return (
          <div key={character.name} style={{position: 'absolute', left: place.x * SX, top: place.y * SY, width: place.width * SX, opacity: alpha}}>
            <div style={{
              fontSize: nameSize(character.name),
              fontWeight: NAME_FONT_WEIGHT,
              fontVariationSettings: `"wght" ${NAME_FONT_WEIGHT}`,
              letterSpacing: 1.8,
              lineHeight: 1,
              textAlign: place.align,
              color: PAPER,
              whiteSpace: 'nowrap',
            }}>
              {character.name}
            </div>
            <div style={{
              position: 'absolute',
              left: ruleLeft - place.x * SX,
              top: (place.ruleY - place.y) * SY,
              width: ruleWidth,
              height: 8,
              background: RULE,
            }} />
          </div>
        );
      })}
      {titleIn > 0 ? (
        <svg width="1920" height="1080" style={{position: 'absolute', inset: 0}}>
          <polygon points={titlePoints.map((point) => point.join(',')).join(' ')} fill={INK} fillOpacity={0.975} stroke={PAPER} strokeOpacity={0.24 * titleIn} strokeWidth={6} />
        </svg>
      ) : null}
      {titleIn > 0 ? (
        <div style={{
          position: 'absolute',
          left: 360 * SX,
          top: 248 * SY,
          width: 560 * SX,
          textAlign: 'center',
          opacity: titleIn,
        }}>
          <div style={{
            fontSize: 30,
            fontWeight: EYEBROW_FONT_WEIGHT,
            fontVariationSettings: `"wght" ${EYEBROW_FONT_WEIGHT}`,
            letterSpacing: 7.5,
            color: EYEBROW,
          }}>
            {intro?.text?.eyebrow}
          </div>
          {lines.map((line, index) => (
            <div key={`${index}-${line}`} style={{
              fontSize: titleSize(line, index, lines.length),
              fontWeight: TITLE_FONT_WEIGHT,
              fontVariationSettings: `"wght" ${TITLE_FONT_WEIGHT}`,
              letterSpacing: index === lines.length - 1 ? 1.5 : 4.8,
              lineHeight: 0.95,
              color: GOLD,
            }}>
              {line}
            </div>
          ))}
          <div style={{width: 280 * SX, height: 8, margin: '18px auto 0', background: RULE}} />
        </div>
      ) : null}
      {close > 0 ? (
        <svg width="1920" height="1080" style={{position: 'absolute', inset: 0}}>
          <polygon points={closePoints.map((point) => point.join(',')).join(' ')} fill={INK} />
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};
