export const OUTPUT_SCALE_X = 1920 / 1280;
export const OUTPUT_SCALE_Y = 1080 / 720;
export const PAN_WINDOW_SECONDS = 4.9;
export const PAN_SAFETY_PX = 8;

const PAN_X_TRAVEL = 12;
const PAN_Y_TRAVEL = -7;

export const STORY_SHARD_SLOTS = [
  "left-top",
  "left-bottom",
  "right-top",
  "right-bottom",
  "center-top",
  "center-bottom",
];

const SHARD_GEOMETRY = {
  "left-top": {
    points: [[30, 78], [510, 24], [438, 282], [4, 338]],
    entry: [-360, -80],
    zoom: 1.08,
    pan: [-12, 6],
    dots: true,
  },
  "left-bottom": {
    points: [[85, 382], [470, 318], [550, 704], [0, 652]],
    entry: [-420, 120],
    zoom: 1.04,
    pan: [18, -4],
    dots: true,
  },
  "right-top": {
    points: [[780, 18], [1220, 70], [1278, 340], [846, 280]],
    entry: [390, -90],
    zoom: 1.12,
    pan: [22, 8],
    dots: true,
  },
  "right-bottom": {
    points: [[748, 365], [1276, 390], [1188, 706], [690, 652]],
    entry: [430, 100],
    zoom: 1.05,
    pan: [-12, -6],
    dots: true,
  },
  "center-top": {
    points: [[486, 0], [642, 0], [552, 250], [430, 282]],
    entry: [-120, -260],
    zoom: 1.28,
    pan: [4, 8],
    dots: false,
  },
  "center-bottom": {
    points: [[544, 468], [710, 430], [770, 720], [598, 720]],
    entry: [30, 260],
    zoom: 1.24,
    pan: [-6, -4],
    dots: false,
  },
};

function clamp(value, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, value));
}

function easeOut(value) {
  const x = clamp(value);
  return 1 - (1 - x) ** 3;
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

function polygonClip(points, box) {
  return `polygon(${points.map(([x, y]) => {
    const px = ((x - box.left) / box.width) * 100;
    const py = ((y - box.top) / box.height) * 100;
    return `${px}% ${py}%`;
  }).join(", ")})`;
}

/** One frame of shard geometry. The polygon is still after entry. The image uses a fixed overscan and a linear pan, with no animated zoom. */
export function shardFrame({
  slot,
  frame,
  fps = 30,
  enterStartFrame,
  enterDurationFrames,
}) {
  const geometry = SHARD_GEOMETRY[slot];
  if (!geometry) throw new Error("unsupported intro shard");
  const time = frame / fps;
  const enterStart = enterStartFrame / fps;
  const enterDuration = enterDurationFrames / fps;
  const enter = easeOut(enterDuration <= 0
    ? (time >= enterStart ? 1 : 0)
    : clamp((time - enterStart) / enterDuration));
  const settled = enter >= 1;
  const dx = settled ? 0 : geometry.entry[0] * (1 - enter) * OUTPUT_SCALE_X;
  const dy = settled ? 0 : geometry.entry[1] * (1 - enter) * OUTPUT_SCALE_Y;
  const settledPoints = geometry.points.map(([x, y]) => [x * OUTPUT_SCALE_X, y * OUTPUT_SCALE_Y]);
  const settledBox = bounds(settledPoints);
  const points = settledPoints.map(([x, y]) => [x + dx, y + dy]);
  const live = bounds(points);
  const panT = clamp((time - enterStart) / PAN_WINDOW_SECONDS);
  const direction = STORY_SHARD_SLOTS.indexOf(slot) % 2 === 0 ? 1 : -1;
  const panX = (geometry.pan[0] + panT * PAN_X_TRAVEL * direction) * OUTPUT_SCALE_X;
  const panY = (geometry.pan[1] + panT * PAN_Y_TRAVEL) * OUTPUT_SCALE_Y;
  const marginX = Math.max(
    (settledBox.width * (geometry.zoom - 1)) / 2,
    Math.abs(geometry.pan[0]) * OUTPUT_SCALE_X + PAN_X_TRAVEL * OUTPUT_SCALE_X + PAN_SAFETY_PX,
  );
  const marginY = Math.max(
    (settledBox.height * (geometry.zoom - 1)) / 2,
    Math.abs(geometry.pan[1]) * OUTPUT_SCALE_Y + Math.abs(PAN_Y_TRAVEL) * OUTPUT_SCALE_Y + PAN_SAFETY_PX,
  );
  const box = {
    left: live.left,
    top: live.top,
    width: settledBox.width,
    height: settledBox.height,
  };
  return {
    settled,
    enter,
    panT,
    panX,
    panY,
    zoom: geometry.zoom,
    points,
    box,
    clipPath: polygonClip(points, box),
    dots: geometry.dots,
    marginX,
    marginY,
    image: {
      left: -marginX + panX,
      top: -marginY + panY,
      width: box.width + marginX * 2,
      height: box.height + marginY * 2,
    },
  };
}
