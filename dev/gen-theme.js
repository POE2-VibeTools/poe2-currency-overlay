// Generate renderer/themes.css from the app's own :root token block.
//
// Now that every colour is a token, a theme is a mapping of hue families - not 1300 rules
// and not 400 hand-picked values. Add an entry to THEMES and re-run.
//
//   node dev/gen-theme.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'renderer', 'tokens.css');
const OUT = path.join(ROOT, 'renderer', 'themes.css');

function parse(lit) {
  const c = String(lit).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(c);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
function toHSL({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  const l = (mx + mn) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s: s * 100, l: l * 100 };
}
function fromHSL(h, s, l, a) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  const R = Math.round((r + m) * 255), G = Math.round((g + m) * 255), B = Math.round((b + m) * 255);
  const hx = (n) => n.toString(16).padStart(2, '0');
  return a >= 1 ? `#${hx(R)}${hx(G)}${hx(B)}` : `rgba(${R},${G},${B},${+a.toFixed(3)})`;
}
// Contrast, so the generator can check its own output instead of leaving it to the audit.
const _lum = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const x = _lum(a), y = _lum(b), hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
};

// A theme changes the accent, and the ink that sits on the accent has to follow it. When
// Industry desaturates the amber to steel the fill loses luminance, and a fixed ink that
// cleared 4.5:1 on amber no longer clears it on steel. So the ink is not a themed value -
// it is SOLVED, against the darkest fill it is ever asked to sit on. Any future theme gets
// a readable button for free, whatever it does to the accent.
const INK_ON_ACCENT = ['--am', '--am-2', '--am-grad-a', '--am-grad-b', '--update-btn-a', '--update-btn-b', '--tag-hi-b'];

// The other half of the same rule. A fill can be too dark for ANY ink: the best a fill of
// luminance L can do is (L + 0.05) / 0.05, so below L = 0.175 nothing - not even pure
// black - reaches 4.5:1. Industry's steel mapping pushed two gradient stops under that
// line, which is unfixable by choosing a better ink. So a fill that carries text gets a
// luminance floor, and loses a little gradient depth instead of its legibility.
const floorFor = (need) => need * 0.05 - 0.05;
function raiseToFloor(c, floor) {
  const { h, s, l } = toHSL(c);
  for (let cand = l; cand <= 100; cand += 0.5) {
    const t = parse(fromHSL(h, s, cand, 1));
    if (_lum(t) >= floor) return { hex: fromHSL(h, s, cand, c.a), moved: cand - l };
  }
  return null;
}
function solveInk(inkC, fills, need) {
  const { h, s, l } = toHSL(inkC);
  for (let step = 0; step <= 40; step += 0.5) {
    for (const cand of [l - step, l + step]) {
      const c = parse(fromHSL(h, s, cand, 1));
      if (fills.every((f) => contrast(c, f) >= need)) return { hex: fromHSL(h, s, cand, inkC.a), moved: cand - l };
    }
  }
  return null;
}
const toHSLArr = (c) => { const { h, s, l } = toHSL(c); return [h, s, l]; };
function family(c) {
  const { h, s } = toHSL(c);
  if (s < 10) return 'neutral';
  if (h >= 20 && h < 50) return 'amber';
  if (h >= 50 && h < 95) return 'lime';
  if (h >= 95 && h < 165) return 'green';
  if (h >= 165 && h < 260) return 'blue';
  if (h >= 260 && h < 330) return 'violet';
  return 'red';
}

// "Industry": steel on neutral, per the design doc. The warm cast, the saturated per-tab
// accents and the gold all collapse to one steel accent; identity is carried by the tab
// name and section numbering instead of by colour. Lightness is preserved everywhere, so
// every contrast relationship the layout depends on survives the reskin.
const STEEL = 207;
const EXEMPT = new Set(['--warn', '--danger']);

// A highlight has to be visibly a highlight WITHOUT importing a colour the palette does
// not contain - a violet row in a steel monochrome is separation bought at the cost of
// the whole design. So --info maps through the theme like any other colour, and then
// gets lifted: more chroma and more lightness than anything around it. That is how mono
// systems mark state, and it works on a palette of one hue or twelve.
function lift(c, spec) {
  const { h, s, l } = toHSL(c);
  return [h, Math.min(100, s + (spec.infoChroma || 0)), Math.min(92, l + (spec.infoLift || 0))];
}

const THEMES = {
  industry: {
    amber: (c) => { const { l } = toHSL(c); return [STEEL, l > 55 ? 26 : 14, l]; },
    lime: (c) => { const { l } = toHSL(c); return [STEEL, l > 55 ? 22 : 12, l]; },
    // Gains and losses keep their hue in EVERY theme. The design system is mono and
    // suggests reading them by arrow instead, but the app has no arrows - colour is the
    // only signal, and +20 and -65 rendering identically is worse than an off-palette
    // green. Muted to sit with the steel, not collapsed into it.
    green: (c) => { const { l } = toHSL(c); return [140, 18, l]; },
    red: (c) => { const { l } = toHSL(c); return [10, 22, l]; },
    violet: (c) => { const { l } = toHSL(c); return [STEEL, 18, l]; },
    blue: (c) => { const { l, s } = toHSL(c); return [STEEL, Math.min(s, 34), l]; },
    neutral: (c) => { const { l } = toHSL(c); return [STEEL, 4, l]; },
    // What a highlighted row looks like in this theme. Industry is a flat wireframe with
    // no gradients or glow, so it leans on a harder edge and a stronger ink shift than
    // the default palette, where the tint alone carries it.
    highlight: { fill: '16%', edge: '90%', ink: '62%' },
    // Steel-on-steel: the edited row is the same hue as the rest of the theme, carried by
    // being brighter and more saturated than any surface near it. Nothing foreign added.
    infoChroma: 22, infoLift: 10,
  },
};

const src = fs.readFileSync(SRC, 'utf8');
const block = src.slice(src.indexOf(':root'), src.indexOf('}', src.indexOf(':root')));
const tokens = [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)]
  .map((m) => ({ name: m[1], raw: m[2], c: parse(m[2]) })).filter((t) => t.c);

const out = [];
out.push('/* GENERATED by dev/gen-theme.js - do not edit by hand.');
out.push('   Alternate palettes. Every colour in the app resolves through the tokens in');
out.push("   styles.css's :root, so a theme is this file and nothing else. */");
for (const [key, map] of Object.entries(THEMES)) {
  out.push('');
  out.push(`html[data-theme="${key}"] {`);
  const themed = {};
  let inkLine = -1;
  for (const t of tokens) {
    // status tokens carry meaning, not style: a warning that blends into the palette is
    // not a warning, and its legend key stops matching the rows it describes
    if (EXEMPT.has(t.name)) { out.push(`  ${t.name}: ${t.raw};`); continue; }
    // --info is re-themed like everything else, THEN lifted. Order matters: lift first
    // and the theme would flatten the lift straight back out.
    if (t.name === '--info') {
      const fn0 = map[family(t.c)];
      const themed = fn0 ? parse(fromHSL(...fn0(t.c), 1)) : t.c;
      out.push(`  --info: ${fromHSL(...lift(themed, map), t.c.a)};`);
      continue;
    }
    const fn = map[family(t.c)];
    if (!fn) { out.push(`  ${t.name}: ${t.raw};`); themed[t.name] = t.c; continue; }
    const [h, s, l] = fn(t.c);
    const hex = fromHSL(h, s, l, t.c.a);
    themed[t.name] = parse(hex);
    if (t.name === '--am-on') { inkLine = out.length; out.push(''); continue; }
    out.push(`  ${t.name}: ${hex};`);
  }
  // A fill that carries text is lifted to the floor FIRST - otherwise the ink solver is
  // asked for a colour that does not exist.
  // 5.0 rather than the required 4.5: at exactly the floor the only ink that passes is
  // pure black, which reads as a hole punched in the button. A little headroom lets the
  // ink land on a soft near-black and still clear the rule.
  const floor = floorFor(5.0);
  for (const n of INK_ON_ACCENT) {
    if (!themed[n] || _lum(themed[n]) >= floor) continue;
    const r = raiseToFloor(themed[n], floor);
    if (!r) continue;
    themed[n] = parse(r.hex);
    const at = out.findIndex((l) => l.startsWith(`  ${n}:`));
    if (at >= 0) out[at] = `  ${n}: ${r.hex};`;
    console.log(`  ${key}: ${n} lifted +${r.moved.toFixed(1)}L to ${r.hex} - below the floor no ink reaches 4.5:1`);
  }
  // now that every accent fill is known, solve the ink against all of them at once
  if (inkLine >= 0) {
    const fills = INK_ON_ACCENT.map((n) => themed[n]).filter(Boolean);
    const solved = solveInk(themed['--am-on'], fills, 4.5);
    out[inkLine] = `  --am-on: ${solved ? solved.hex : fromHSL(...toHSLArr(themed['--am-on']), themed['--am-on'].a)};`;
    if (solved && Math.abs(solved.moved) > 0.01) {
      console.log(`  ${key}: --am-on solved to ${solved.hex} (${solved.moved > 0 ? '+' : ''}${solved.moved.toFixed(1)}L) to clear 4.5:1 on every accent fill`);
    }
  }
  const hl = map.highlight || {};
  if (hl.fill) out.push(`  --hl-fill: ${hl.fill}; --hl-edge: ${hl.edge}; --hl-ink: ${hl.ink};`);
  out.push('}');
}

// Structural traits the design doc calls out as reading "generated": fully-rounded pills,
// the 8-10px radius on every surface, the gradient-and-glow primary button. Those are
// shape, not colour, so they need real rules rather than token swaps.
out.push('');
out.push('/* Industry is a wireframe system: square corners, hairline rules, flat fills. */');
out.push('html[data-theme="industry"] * { border-radius: 0 !important; }');
out.push('html[data-theme="industry"] [class*="chip"], html[data-theme="industry"] [class*="pill"],');
out.push('html[data-theme="industry"] [class*="badge"] { border-radius: 0 !important; }');
// :not(.nw-modal-off) matters - themes.css loads AFTER styles.css, so without it this
// rule out-ordered the disabled styling and repainted a disabled button as enabled.
out.push('html[data-theme="industry"] .btn-search:not(.nw-modal-off),');
out.push('html[data-theme="industry"] .nw-modal-new:not(.nw-modal-off),');
out.push('html[data-theme="industry"] .mini-btn.primary:not(.nw-modal-off) {');
out.push('  background-image: none !important;');
out.push('  background-color: var(--am) !important;');
out.push('  /* --am-on is the ink meant to sit ON the accent. Without it the button kept');
out.push('     its accent-coloured text and rendered pale-on-pale. */');
out.push('  color: var(--am-on) !important;');
out.push('  box-shadow: none !important;');
out.push('}');
out.push('html[data-theme="industry"] { text-shadow: none; }');
out.push('html[data-theme="industry"] *:not(.nw-spin) { text-shadow: none !important; }');

fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log(`themes.css written: ${tokens.length} tokens x ${Object.keys(THEMES).length} theme(s)`);
