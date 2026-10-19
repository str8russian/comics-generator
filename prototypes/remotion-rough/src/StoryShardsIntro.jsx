import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';

const SX = 1920 / 1280;
const SY = 1080 / 720;
const INK = '#02090b';
const PAPER = '#f2ede0';
const GOLD = '#f0d699';
const EYEBROW = '#949494';
const RULE = '#c2c2c2';

const SHARD_GEOMETRY = {
  'left-top': {
    points: [[30, 78], [510, 24], [438, 282], [4, 338]],
    entry: [-360, -80],
    zoom: 1.08,
    pan: [-12, 6],
    dots: true,
  },
  'left-bottom': {
    points: [[85, 382], [470, 318], [550, 704], [0, 652]],
    entry: [-420, 120],
    zoom: 1.04,
    pan: [18, -4],
    dots: true,
  },
  'right-top': {
    points: [[780, 18], [1220, 70], [1278, 340], [846, 280]],
    entry: [390, -90],
    zoom: 1.12,
    pan: [22, 8],
    dots: true,
  },
  'right-bottom': {
    points: [[748, 365], [1276, 390], [1188, 706], [690, 652]],
    entry: [430, 100],
    zoom: 1.05,
    pan: [-12, -6],
    dots: true,
  },
  'center-top': {
    points: [[486, 0], [642, 0], [552, 250], [430, 282]],
    entry: [-120, -260],
    zoom: 1.28,
    pan: [4, 8],
    dots: false,
  },
  'center-bottom': {
    points: [[544, 468], [710, 430], [770, 720], [598, 720]],
    entry: [30, 260],
    zoom: 1.24,
    pan: [-6, -4],
    dots: false,
  },
};

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

function bounds(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left,
    top,
    width: Math.max(1, Math.max(...xs) - left),
    height: Math.max(1, Math.max(...ys) - top),
  };
}

function clipPath(points, box) {
  return `polygon(${points.map(([x, y]) => {
    const px = ((x - box.left) / box.width) * 100;
    const py = ((y - box.top) / box.height) * 100;
    return `${px}% ${py}%`;
  }).join(', ')})`;
}

function imageSource(asset) {
  if (!asset) return null;
  if (asset.startsWith('http://') || asset.startsWith('https://') || asset.startsWith('data:')) return asset;
  return asset;
}

function titleLines(title) {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

function titleSize(line, index, count) {
  const length = Array.from(line).length;
  const base = count === 1 ? 96 : (index === count - 1 ? 112 : 78);
  if (length > 18) return Math.round(base * 0.55);
  if (length > 12) return Math.round(base * 0.72);
  return base;
}

function nameSize(name) {
  const length = Array.from(name).length;
  if (length > 18) return 36;
  if (length > 12) return 44;
  return 54;
}

const Shard = ({shard, index, time, lock}) => {
  const geometry = SHARD_GEOMETRY[shard.slot];
  if (!geometry) throw new Error('unsupported intro shard');
  const enter = easeOut(progress(time, shard.enterStartFrame / 30, shard.enterDurationFrames / 30));
  if (enter <= 0) return null;
  const drift = Math.sin((time + index * 0.31) * 0.58) * 4;
  const dx = (geometry.entry[0] * (1 - enter) + drift * (1 - lock * 0.72)) * SX;
  const dy = (geometry.entry[1] * (1 - enter) - drift * 0.35) * SY;
  const slow = progress(time, shard.enterStartFrame / 30, 4.9);
  const points = geometry.points.map(([x, y]) => [x * SX + dx, y * SY + dy]);
  const box = bounds(points);
  const zoom = geometry.zoom - 0.035 * slow;
  const panX = (geometry.pan[0] + slow * (index % 2 === 0 ? 12 : -12)) * SX;
  const panY = (geometry.pan[1] - slow * 7) * SY;
  const src = imageSource(shard.asset);
  return (
    <div
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        overflow: 'hidden',
        clipPath: clipPath(points, box),
        backgroundColor: '#061016',
      }}
    >
      {src ? (
        <Img
          src={src}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          }}
        />
      ) : null}
      {geometry.dots ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(rgba(242,237,224,0.05) 1px, transparent 1.4px)',
            backgroundSize: '48px 48px',
          }}
        />
      ) : null}
      <svg width={box.width} height={box.height} style={{position: 'absolute', inset: 0}}>
        <polygon
          points={points.map(([x, y]) => `${x - box.left},${y - box.top}`).join(' ')}
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
  const lock = easeInOut(progress(time, 2.46, 0.66));
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
    <AbsoluteFill style={{backgroundColor: INK, color: PAPER, fontFamily: 'Arial, Helvetica, sans-serif', overflow: 'hidden'}}>
      {(intro?.shards || []).map((shard, index) => (
        <Shard key={shard.slot || index} shard={shard} index={index} time={time} lock={lock} />
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
              fontWeight: 700,
              letterSpacing: 1.6,
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
          <div style={{fontSize: 30, fontWeight: 700, letterSpacing: 8, color: EYEBROW}}>
            {intro?.text?.eyebrow}
          </div>
          {lines.map((line, index) => (
            <div key={`${index}-${line}`} style={{
              fontSize: titleSize(line, index, lines.length),
              fontWeight: 700,
              letterSpacing: index === lines.length - 1 ? 1.5 : 4,
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
