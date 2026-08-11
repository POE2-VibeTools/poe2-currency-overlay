// Plan the collapse of appearance-named tokens onto the role ladders.
//
// The migration that created --x-amber-7 and its 74 siblings named colours by what they
// LOOK like. A design system names them by what they DO. This works out which of them are
// the same colour as a role that already exists, so the collapse can be done in batches
// ordered by how much it can possibly change on screen - instead of one sweep that moves
// 106 values at once and needs the whole app eyeballed.
//
//   node dev/collapse-plan.js           summary by risk band
//   node dev/collapse-plan.js --band A  the exact list for one band
//
// Distance is CIE76 dE on Lab. The bands are the standard perceptual ones:
//   A  dE < 1.0   below the just-noticeable difference. Invisible on screen, full stop.
//   B  dE < 2.3   the JND. Not distinguishable side by side by most viewers.
//   C  dE < 5.0   noticeable if you compare directly, not if you don't.
//   D  dE >= 5.0  a genuinely different colour. Do NOT collapse; give it its own role.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

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
// sRGB -> Lab. Needed because hex distance is not perceptual: two hexes 20 apart can be
// indistinguishable in one part of the space and obviously different in another.
function lab({ r, g, b }) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const [R, G, B] = [f(r), f(g), f(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [k(X), k(Y), k(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
};

// Alpha tokens only compare meaningfully against the same alpha - a 6% border and a solid
// fill are not the same colour even when the underlying hue matches.
const sameAlpha = (a, b) => Math.abs(a.a - b.a) < 0.02;

const src = fs.readFileSync(path.join(ROOT, 'renderer', 'tokens.css'), 'utf8');
const tokens = [];
for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
  const c = parse(m[2]);
  if (c) tokens.push({ name: m[1], raw: m[2], c });
}

const { ROLES } = (() => {
  // design-system.js is a script, not a module; pull the index out of its source so the
  // two files cannot disagree about what is indexed.
  const ds = fs.readFileSync(path.join(__dirname, 'design-system.js'), 'utf8');
  const body = ds.slice(ds.indexOf('const ROLES = {'), ds.indexOf('\n};', ds.indexOf('const ROLES = {')));
  const names = [...body.matchAll(/'(--[a-z0-9-]+)':/g)].map((m) => m[1]);
  return { ROLES: new Set(names) };
})();

// Where is each token actually used? A collapse target has to make sense for the RULES the
// token is used in, not just for its hex.
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) walk(f); }
    else if (/\.(css|html|js)$/.test(e.name) && !/tokens\.css|themes\.css|bundle/.test(e.name)) files.push(f);
  }
})(path.join(ROOT, 'renderer'));
const bodies = files.map((f) => ({ rel: path.relative(ROOT, f), text: fs.readFileSync(f, 'utf8') }));
const usage = (name) => {
  const re = new RegExp('var\\(' + name + '\\b', 'g');
  const hits = [];
  for (const b of bodies) { const n = (b.text.match(re) || []).length; if (n) hits.push(`${b.rel}:${n}`); }
  return hits;
};

const indexed = tokens.filter((t) => ROLES.has(t.name));
const loose = tokens.filter((t) => !ROLES.has(t.name));

const band = (d) => (d < 1.0 ? 'A' : d < 2.3 ? 'B' : d < 5.0 ? 'C' : 'D');
const plan = loose.map((t) => {
  // Nearest role, and nearest ANY token - collapsing onto another loose token is still a
  // reduction, it just does not add a role.
  let best = null;
  for (const cand of tokens) {
    if (cand.name === t.name || !sameAlpha(cand.c, t.c)) continue;
    const d = dE(t.c, cand.c);
    const isRole = ROLES.has(cand.name);
    // prefer a real role at equal distance: that is the whole point of the exercise
    if (!best || d < best.d - 0.001 || (Math.abs(d - best.d) < 0.001 && isRole && !best.isRole)) {
      best = { onto: cand.name, d, isRole };
    }
  }
  const u = usage(t.name);
  return { name: t.name, raw: t.raw, ...(best || { onto: null, d: Infinity, isRole: false }),
    band: best ? band(best.d) : 'D', sites: u.reduce((n, s) => n + +s.split(':').pop(), 0), where: u };
});

const wanted = (process.argv.includes('--band') ? process.argv[process.argv.indexOf('--band') + 1] : null);
if (wanted) {
  const list = plan.filter((p) => p.band === wanted.toUpperCase()).sort((a, b) => a.d - b.d);
  for (const p of list) {
    console.log(`${p.name.padEnd(16)} ${p.raw.padEnd(24)} -> ${String(p.onto).padEnd(16)} dE ${p.d.toFixed(2).padStart(5)}  ${p.isRole ? 'ROLE ' : '     '} ${p.sites} site(s)  ${p.where.join(' ')}`);
  }
  console.log(`\n${list.length} token(s) in band ${wanted.toUpperCase()}, ${list.reduce((n, p) => n + p.sites, 0)} site(s).`);
  process.exit(0);
}

console.log(`${tokens.length} tokens: ${indexed.length} indexed, ${loose.length} loose\n`);
const LABEL = {
  A: 'dE < 1.0   invisible - below the just-noticeable difference',
  B: 'dE < 2.3   at the JND - not distinguishable side by side',
  C: 'dE < 5.0   visible on direct comparison only',
  D: 'dE >= 5.0  a real colour of its own - do NOT collapse, give it a role',
};
for (const b of ['A', 'B', 'C', 'D']) {
  const list = plan.filter((p) => p.band === b);
  const roles = list.filter((p) => p.isRole).length;
  console.log(`band ${b}  ${String(list.length).padStart(3)} tokens, ${String(list.reduce((n, p) => n + p.sites, 0)).padStart(4)} sites   ${LABEL[b]}`);
  if (list.length) console.log(`         ${roles} collapse onto a named role, ${list.length - roles} onto another loose token`);
}
const dead = plan.filter((p) => p.sites === 0);
console.log(`\n${dead.length} loose token(s) referenced nowhere: ${dead.map((p) => p.name).join(', ') || 'none'}`);
