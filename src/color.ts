// Color model for the backgroundColor / textColor builtin labels.
//
// Colors are stored internally as OKLCH — the cylindrical form of the OKLab
// perceptual color space (L = lightness 0..1, C = chroma 0+, H = hue degrees).
// They reach this module two ways: parsed from a small compositional word
// vocabulary (parseColorWords), or supplied directly as L/C/H numbers. Either
// way the result is rendered by converting to sRGB (oklchToCss), gamut-mapping
// any out-of-range result by reducing chroma while preserving L and H.

export interface Oklch { L: number; C: number; H: number }

// ---- OKLCH/OKLab <-> sRGB conversions (Björn Ottosson's matrices) ----

interface LinearRgb { r: number; g: number; b: number }

function oklchToLinearSrgb({ L, C, H }: Oklch): LinearRgb {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}

function inGamut({ r, g, b }: LinearRgb): boolean {
  const eps = 1e-4;
  return (
    r >= -eps && r <= 1 + eps &&
    g >= -eps && g <= 1 + eps &&
    b >= -eps && b <= 1 + eps
  );
}

function gammaEncode(c: number): number {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

// Largest in-gamut chroma at a given L/H, by binary search.
function maxChroma(L: number, H: number): number {
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinearSrgb({ L, C: mid, H }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Reduce chroma (preserving L and H) until the color fits in sRGB, then encode
// to a #rrggbb string.
export function oklchToCss(color: Oklch): string {
  let c = { ...color };
  c.L = Math.min(1, Math.max(0, c.L));
  c.C = Math.max(0, c.C);
  if (!inGamut(oklchToLinearSrgb(c))) {
    c = { ...c, C: maxChroma(c.L, c.H) };
  }
  const lin = oklchToLinearSrgb(c);
  const to255 = (v: number) => Math.round(gammaEncode(v) * 255);
  const hex = (v: number) => to255(v).toString(16).padStart(2, "0");
  return `#${hex(lin.r)}${hex(lin.g)}${hex(lin.b)}`;
}

// ---- Compositional word vocabulary ----

// The six chromatic Berlin & Kay basic terms share one lightness and one
// chroma, differing only in hue, so they read as a consistent family. The
// shared chroma is the largest that keeps every hue inside sRGB at this L.
const BASE_L = 0.65;
const HUES: Record<string, number> = {
  red: 29,
  orange: 70,
  yellow: 100,
  green: 145,
  blue: 260,
  purple: 320,
};
const SHARED_C = Math.min(...Object.values(HUES).map(h => maxChroma(BASE_L, h)));
console.log("[consender] color.ts loaded, SHARED_C=", SHARED_C);

type Modifier = (c: Oklch) => Oklch;

const MODIFIERS: Record<string, Modifier> = {
  light:   c => ({ ...c, L: c.L + 0.12 }),
  dark:    c => ({ ...c, L: c.L - 0.12 }),
  pale:    c => ({ ...c, L: c.L + 0.08, C: c.C * 0.5 }),
  deep:    c => ({ ...c, L: c.L - 0.08, C: c.C * 1.4 }),
  vivid:   c => ({ ...c, C: c.C * 1.4 }),
  bright:  c => ({ ...c, C: c.C * 1.4 }),
  dull:    c => ({ ...c, C: c.C * 0.55 }),
  muted:   c => ({ ...c, C: c.C * 0.55 }),
  grayish: c => ({ ...c, C: c.C * 0.55 }),
};

function chromatic(hue: number): Oklch {
  return { L: BASE_L, C: SHARED_C, H: hue };
}

// Base terms. pink and brown are DERIVED (pink = light red, brown = dark muted
// orange), not independent anchors.
function baseAnchor(name: string): Oklch | null {
  if (name in HUES) return chromatic(HUES[name]);
  switch (name) {
    case "black": return { L: 0, C: 0, H: 0 };
    case "gray":  return { L: 0.6, C: 0, H: 0 };
    case "white": return { L: 1, C: 0, H: 0 };
    case "pink":  return MODIFIERS.light(chromatic(HUES.red));
    case "brown": return MODIFIERS.dull(MODIFIERS.dark(chromatic(HUES.orange)));
    default:      return null;
  }
}

// "bluish", "reddish", "greenish" … name a base for blending. grayish/greyish
// are modifiers, handled separately, not blend hints.
function ishBase(token: string): string | null {
  if (!token.endsWith("ish")) return null;
  const stem = token.slice(0, -3);
  // "greenish" -> "green"; "bluish" -> "blu" + "e"; "reddish" -> "redd" - "d".
  const candidates = [stem, stem + "e"];
  if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
    candidates.push(stem.slice(0, -1));
  }
  return candidates.find(s => baseAnchor(s)) ?? null;
}

// Average several OKLCH colors with equal weight, in OKLab (rectangular a/b) so
// hue interpolates along the shortest path and complementary colors gray out
// rather than swinging through an arbitrary intermediate hue. Returns null for
// an empty set. Used to compose multiple like-named color config boxes (e.g.
// several `textColor` children) into a single color, independent of their
// order.
export function blendColors(colors: Oklch[]): Oklch | null {
  if (colors.length === 0) return null;
  if (colors.length === 1) return colors[0];
  return blend(colors.map(c => ({ c, w: 1 })));
}

// Average a set of OKLCH anchors in OKLab (rectangular a/b), which interpolates
// hue along the shortest path, then return to cylindrical form.
function blend(parts: Array<{ c: Oklch; w: number }>): Oklch {
  let L = 0, a = 0, b = 0, wsum = 0;
  for (const { c, w } of parts) {
    const hr = (c.H * Math.PI) / 180;
    L += c.L * w;
    a += c.C * Math.cos(hr) * w;
    b += c.C * Math.sin(hr) * w;
    wsum += w;
  }
  L /= wsum; a /= wsum; b /= wsum;
  return { L, C: Math.hypot(a, b), H: (Math.atan2(b, a) * 180) / Math.PI };
}

// Parse a color phrase like "deep blue", "bluish green", "pale pink",
// "blue-green". Returns null if no base color term is found.
export function parseColorWords(text: string): Oklch | null {
  const tokens = text
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(t => (t === "grey" ? "gray" : t));
  if (tokens.length === 0) return null;

  const mods: Modifier[] = [];
  const bases: Array<{ c: Oklch; w: number }> = [];

  for (const tok of tokens) {
    if (tok === "grayish" || tok === "greyish") { mods.push(MODIFIERS.grayish); continue; }
    if (tok in MODIFIERS) { mods.push(MODIFIERS[tok]); continue; }

    const ish = ishBase(tok);
    if (ish) { bases.push({ c: baseAnchor(ish)!, w: 0.5 }); continue; }

    const anchor = baseAnchor(tok);
    if (anchor) { bases.push({ c: anchor, w: 1 }); continue; }
    // Unknown token: ignore so partial phrases still resolve.
  }

  if (bases.length === 0) return null;
  let color = bases.length === 1 ? bases[0].c : blend(bases);
  for (const m of mods) color = m(color);
  return color;
}
