/** Bundled SIL OFL Roboto Condensed. The variable file is loaded locally; it is not fetched at render time. */
export const DISPLAY_FONT_FAMILY = "Roboto Condensed";
export const DISPLAY_FONT_FILE = "fonts/RobotoCondensed-variable.ttf";
export const DISPLAY_FONT_WEIGHT_RANGE = "100 900";
export const NAME_FONT_WEIGHT = 800;
export const TITLE_FONT_WEIGHT = 800;
export const EYEBROW_FONT_WEIGHT = 700;

export function presentTitle(title) {
  return String(title ?? "").toLocaleUpperCase("ru");
}

export function titleLines(title) {
  const words = presentTitle(title).trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

export function titleSize(line, index, count) {
  const length = Array.from(String(line)).length;
  const base = count === 1 ? 104 : (index === count - 1 ? 123 : 87);
  if (length > 18) return Math.round(base * 0.62);
  if (length > 12) return Math.round(base * 0.78);
  return base;
}

export function nameSize(name) {
  const length = Array.from(String(name)).length;
  if (length > 22) return 40;
  if (length > 16) return 48;
  return 54;
}
