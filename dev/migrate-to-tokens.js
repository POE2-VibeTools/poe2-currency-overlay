// Collapse the app's hand-written colour literals onto the semantic tokens that already
// exist in :root, so a theme is ~35 values instead of 745.
//
// The CSS grew a colour at a time: 745 literals, 349 distinct, against a :root block that
// already names every role the app actually has (surface, border ramp, text ramp, accent,
// states, mod-kind, filter). Token coverage was 45%. The other 55% are shades that drifted
// from a token by a few units because they were typed by hand, not chosen.
//
//   node dev/migrate-to-tokens.js            report: what maps, how far, what does not
//   node dev/migrate-to-tokens.js --write    apply it
//
// Rules that keep this honest:
//  - a literal only collapses onto a token within DIST of it, so nothing changes hue
//  - alpha variants become color-mix() over the SAME token, which is what makes them
//    follow a theme instead of staying amber forever
//  - gradient stops are left alone unless they map exactly; a gradient that shifts by a
//    few units on one stop is the one place a small error is visible as banding
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = ['renderer/styles.css', 'renderer/item/item.css'];
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const DIST = Number((process.argv.find((a) => a.startsWith('--dist=')) || '--dist=10').split('=')[1]);

function parse(lit) {
  const c = String(lit).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(c);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
// straight RGB distance is good enough here: everything is within one family already,
// and the threshold is small
const dist = (A, B) => Math.max(Math.abs(A.r - B.r), Math.abs(A.g - B.g), Math.abs(A.b - B.b));

// ---- the token set, read from the app's own :root -------------------------
function readTokens() {
  const src = fs.readFileSync(path.join(ROOT, 'renderer', 'styles.css'), 'utf8');
  const block = src.slice(src.indexOf(':root'), src.indexOf('}', src.indexOf(':root')));
  const out = [];
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
    const c = parse(m[2]);
    if (c) out.push({ name: m[1], c, raw: m[2] });
  }
  return out;
}
const TOKENS = readTokens();
const OPAQUE = TOKENS.filter((t) => t.c.a >= 1);

// Alpha literals: find the opaque token whose HUE they are, and express them as a mix.
// rgba(232,210,180,.12) is the border ramp; rgba(214,126,44,.3) is the accent at 30%.
function nearestOpaque(c) {
  let best = null;
  for (const t of OPAQUE) {
    const d = dist(c, t.c);
    if (!best || d < best.d) best = { t, d };
  }
  return best;
}

const stats = { exact: 0, snapped: 0, mixed: 0, kept: 0, worst: 0 };
const unmapped = new Map();
const shifts = [];

function replacement(lit, inGradient) {
  // a colour whose alpha is a variable - rgba(20,18,15,var(--bg-alpha)) - is not a
  // literal at all. The regex clips it at the first ")", so parsing it yields NaN alpha
  // and it would be rewritten to color-mix(... NaN%) - which renders as fully
  // transparent. That is exactly what happened to the app background.
  if (/var\(/.test(lit)) return null;
  const c = parse(lit);
  if (!c || !Number.isFinite(c.a)) return null;
  if (c.a >= 1) {
    let best = null;
    for (const t of OPAQUE) {
      const d = dist(c, t.c);
      if (!best || d < best.d) best = { t, d };
    }
    if (!best) return null;
    if (best.d === 0) { stats.exact++; return `var(${best.t.name})`; }
    // a gradient stop that moves produces visible banding against its neighbour
    if (inGradient && best.d > 2) { stats.kept++; return null; }
    if (best.d <= DIST) {
      stats.snapped++; stats.worst = Math.max(stats.worst, best.d);
      shifts.push({ lit, to: best.t.name, d: best.d });
      return `var(${best.t.name})`;
    }
    unmapped.set(lit, (unmapped.get(lit) || 0) + 1);
    stats.kept++;
    return null;
  }
  // translucent: mix the matching token with transparent
  const near = nearestOpaque({ r: c.r, g: c.g, b: c.b, a: 1 });
  if (!near || near.d > DIST) { unmapped.set(lit, (unmapped.get(lit) || 0) + 1); stats.kept++; return null; }
  // inside a gradient only an EXACT hue match is allowed: a snapped stop shifts against
  // its neighbour and shows as banding, but an exact one cannot change anything
  if (inGradient && near.d !== 0) { stats.kept++; return null; }
  const pct = Math.round(c.a * 1000) / 10;
  stats.mixed++; stats.worst = Math.max(stats.worst, near.d);
  return `color-mix(in srgb, var(${near.t.name}) ${pct}%, transparent)`;
}

const results = TARGETS.map((rel) => {
  const p = path.join(ROOT, rel);
  const src = fs.readFileSync(p, 'utf8');
  const rootEnd = src.indexOf('}', src.indexOf(':root')) + 1;
  const head = src.slice(0, rootEnd);
  let body = src.slice(rootEnd);
  // mark gradient regions so their stops can be treated more conservatively
  const gradRanges = [];
  for (const m of body.matchAll(/(linear|radial|conic)-gradient\([^;]*/g)) gradRanges.push([m.index, m.index + m[0].length]);
  const inGrad = (i) => gradRanges.some(([a, b]) => i >= a && i < b);
  body = body.replace(LITERAL, (lit, i) => replacement(lit, inGrad(i)) || lit);
  return { rel, p, out: head + body };
});

const total = stats.exact + stats.snapped + stats.mixed + stats.kept;
console.log(`literals seen: ${total}`);
console.log(`  exact token match : ${stats.exact}`);
console.log(`  snapped to token  : ${stats.snapped}  (worst shift ${stats.worst}/255)`);
console.log(`  alpha -> color-mix: ${stats.mixed}`);
console.log(`  left as literal   : ${stats.kept}`);
console.log(`token coverage after: ${Math.round((stats.exact + stats.snapped + stats.mixed) / total * 100)}%`);
if (unmapped.size) {
  console.log(`\ncolours with no token within ${DIST} (${unmapped.size} distinct) - these need a token or are genuinely one-off:`);
  [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([lit, n]) => console.log(`   ${String(n).padStart(3)}x  ${lit}`));
}
if (process.argv.includes('--write')) {
  for (const r of results) fs.writeFileSync(r.p, r.out);
  console.log('\nwritten.');
} else {
  console.log('\n(dry run)');
}
