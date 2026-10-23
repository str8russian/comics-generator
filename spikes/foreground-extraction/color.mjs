const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const s = i / 255;
  LINEAR[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

const LAB_F_EPS = 0.008856;
const LAB_F_K = 7.787;
const LAB_F_C = 16 / 116;

function labF(t) {
  return t > LAB_F_EPS ? Math.cbrt(t) : LAB_F_K * t + LAB_F_C;
}

export function rgbToLab(r, g, b) {
  const R = LINEAR[r];
  const G = LINEAR[g];
  const B = LINEAR[b];
  let x = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  x /= 0.95047;
  z /= 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function imageToLab(data, width, height, channels) {
  const n = width * height;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const step = channels;
  for (let p = 0, i = 0; p < n; p += 1, i += step) {
    const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
    L[p] = lab[0];
    A[p] = lab[1];
    B[p] = lab[2];
  }
  return { L, A, B };
}

export function deltaE(L, A, B, p, lab) {
  const dL = L[p] - lab[0];
  const dA = A[p] - lab[1];
  const dB = B[p] - lab[2];
  return Math.hypot(dL, dA, dB);
}

export function deltaELab(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function median(values) {
  const n = values.length;
  if (n === 0) return 0;
  const copy = values.slice().sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 === 1 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

export function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index];
}
