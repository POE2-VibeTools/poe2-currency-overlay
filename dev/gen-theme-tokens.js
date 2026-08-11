// Turn the app's hardcoded colour literals into themeable tokens, and generate a token
// block per theme.
//
// The CSS grew with colours written inline - 745 literals across 375 distinct values -
// so there was no way to reskin the app without editing every rule. They are not 375
// colours though: 60% are one warm/amber family at different lightnesses, and the rest
// are six small families (steel, red, grey, green, lime, violet). A theme is therefore a
// mapping of SEVEN hue families, which is what this script consumes.
//
//   node dev/gen-theme-tokens.js --check    report only, touch nothing
//   node dev/gen-theme-tokens.js --write    rewrite the CSS and emit theme-tokens.css
//
// The default theme's generated values are the ORIGINAL literals, so --check verifies a
// rewrite is a no-op visually before anything ships.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = ['renderer/styles.css', 'renderer/item/item.css'];
const OUT = 'renderer/theme-tokens.css';
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

// ---- colour maths ---------------------------------------------------------
function parse(lit) {
  const c = lit.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3) : 1,
    };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(c);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
function toHSL({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s: s * 100, l: l * 100 };
}
function fromHSL(h, s, l, a) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const R = Math.round((r + m) * 255), G = Math.round((g + m) * 255), B = Math.round((b + m) * 255);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return a >= 1 ? `#${hex(R)}${hex(G)}${hex(B)}` : `rgba(${R}, ${G}, ${B}, ${+a.toFixed(3)})`;
}
// the literal exactly as it should be re-emitted for the DEFAULT theme
const canonical = (c) => (c.a >= 1
  ? `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  : `rgba(${c.r}, ${c.g}, ${c.b}, ${+c.a.toFixed(3)})`);

// ---- hue families ---------------------------------------------------------
// Named for what they DO in this app, since that is what a theme has to preserve.
function family({ h, s }) {
  if (s < 8) return 'grey';        // pure neutrals
  if (h >= 20 && h < 50) return 'warm';   // the amber/brown body of the UI
  if (h >= 50 && h < 95) return 'gold';   // gold numerals, desecrate lime
  if (h >= 95 && h < 165) return 'green'; // gains, confirmations
  if (h >= 165 && h < 260) return 'steel';// implicit-mod blue, info
  if (h >= 260 && h < 320) return 'violet';// otherworldly / desecrated accents
  return 'red';                    // losses, corrupted, errors
}

function tokenName(c) {
  const { h, s, l } = toHSL(c);
  const fam = family({ h, s });
  const parts = [fam, Math.round(l)];
  if (s < 8 && fam === 'grey') parts.push('n');
  if (c.a < 1) parts.push('a' + Math.round(c.a * 100));
  // saturation bucket keeps two same-lightness colours of one family apart
  parts.push('s' + Math.round(s / 12));
  return '--c-' + parts.join('-');
}

// ---- theme definitions ----------------------------------------------------
// A theme maps each family to a hue/saturation/lightness transform. Lightness is
// preserved by default so contrast relationships - which the layout depends on - survive
// the reskin. Adding a theme means adding an entry here.
const THEMES = {
  // "Industry": steel on neutral. Drops the warm cast that reads as generated, and
  // collapses the saturated per-tab accents into one. Hues from the design system's
  // ramps (accent #94bce3 h=207, neutrals are hueless).
  industry: {
    label: 'industry',
    map: {
      warm: { h: 207, s: (s) => Math.min(s * 0.30, 22) },   // the whole warm UI -> steel
      gold: { h: 207, s: (s) => Math.min(s * 0.26, 18) },   // gold/lime accents -> steel
      grey: { h: 210, s: () => 3 },                          // neutrals stay neutral
      steel: { h: 207, s: (s) => Math.min(s * 0.85, 40) },   // already steel, keep it
      green: { h: 207, s: (s) => Math.min(s * 0.30, 20) },   // mono system: gains read by glyph
      red: { h: 207, s: (s) => Math.min(s * 0.34, 24) },     // losses likewise
      violet: { h: 207, s: (s) => Math.min(s * 0.30, 20) },
    },
  },
};

function themedValue(c, theme) {
  const { h, s, l } = toHSL(c);
  const fam = family({ h, s });
  const rule = theme.map[fam];
  if (!rule) return canonical(c);
  const nh = typeof rule.h === 'function' ? rule.h(h) : rule.h;
  const ns = typeof rule.s === 'function' ? rule.s(s) : (rule.s != null ? rule.s : s);
  const nl = rule.l ? rule.l(l) : l;
  return fromHSL(nh, ns, nl, c.a);
}

// ---- run ------------------------------------------------------------------
const write = process.argv.includes('--write');
const tokens = new Map();   // token -> canonical default value
const collisions = [];
let occurrences = 0;

const rewritten = TARGETS.map((rel) => {
  const p = path.join(ROOT, rel);
  const src = fs.readFileSync(p, 'utf8');
  // never touch the :root block itself - those ARE the definitions
  const rootEnd = src.indexOf('}', src.indexOf(':root')) + 1;
  const head = src.slice(0, rootEnd);
  const body = src.slice(rootEnd).replace(LITERAL, (lit) => {
    const c = parse(lit);
    if (!c) return lit;
    occurrences++;
    const val = lit.trim();   // verbatim, so the default theme is textually identical
    // Two shades can land in the same lightness/saturation bucket (#9a927f and
    // #9a927e). Suffix rather than fall back to a literal: an un-tokenised colour is a
    // colour no theme can reach, which is the whole problem being fixed.
    const base = tokenName(c);
    let name = base, n = 1;
    while (tokens.has(name) && tokens.get(name) !== val) { name = `${base}-${String.fromCharCode(97 + n)}`; n++; }
    if (n > 1) collisions.push({ name, base, val });
    tokens.set(name, val);
    return `var(${name})`;
  });
  return { rel, p, out: head + body };
});

console.log(`literals rewritten: ${occurrences}   tokens: ${tokens.size}   collisions: ${collisions.length}`);
if (collisions.length) {
  console.log('bucket clashes given a unique suffix (still fully themeable):');
  for (const c of collisions.slice(0, 6)) console.log(`   ${c.base} -> ${c.name} = ${c.val}`);
}

const names = [...tokens.keys()].sort();
const lines = [];
lines.push('/* GENERATED by dev/gen-theme-tokens.js - do not edit by hand.');
lines.push('   Every colour the app draws, as a token. The :root block is the ORIGINAL');
lines.push('   palette value-for-value, so the default theme is unchanged. A theme is a');
lines.push('   hue-family mapping in the generator, not a hand-written palette. */');
lines.push(':root {');
for (const n of names) lines.push(`  ${n}: ${tokens.get(n)};`);
lines.push('}');
for (const key of Object.keys(THEMES)) {
  const th = THEMES[key];
  lines.push('');
  lines.push(`html[data-theme="${key}"] {`);
  for (const n of names) lines.push(`  ${n}: ${themedValue(parse(tokens.get(n)), th)};`);
  lines.push('}');
}
const css = lines.join('\n') + '\n';

// PROOF the rewrite is a visual no-op: put the default values back and the file must be
// byte-identical to what we started with.
let verifyFail = 0;
for (const r of rewritten) {
  const original = fs.readFileSync(r.p, 'utf8');
  const restored = r.out.replace(/var\((--c-[a-z0-9-]+)\)/g, (m, n) => (tokens.has(n) ? tokens.get(n) : m));
  if (restored !== original) {
    verifyFail++;
    let i = 0; while (i < Math.min(restored.length, original.length) && restored[i] === original[i]) i++;
    console.log(`VERIFY FAILED ${r.rel} at offset ${i}`);
    console.log('  original:', JSON.stringify(original.slice(i - 40, i + 40)));
    console.log('  restored:', JSON.stringify(restored.slice(i - 40, i + 40)));
  }
}
console.log(verifyFail ? `VERIFY: ${verifyFail} file(s) differ` : 'VERIFY: default theme is byte-identical to the current CSS');
if (verifyFail && write) { console.log('refusing to write'); process.exit(1); }

if (write) {
  for (const r of rewritten) fs.writeFileSync(r.p, r.out);
  fs.writeFileSync(path.join(ROOT, OUT), css);
  console.log(`wrote ${OUT} and rewrote ${TARGETS.join(', ')}`);
} else {
  console.log(`(dry run) ${OUT} would be ${css.length} bytes`);
}
