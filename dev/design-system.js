// THE INDEX. Every colour role the app draws, and the design rule that decides its value.
//
// A theme is not a list of colours. A theme is a base hue plus a few parameters; the
// rules below turn that into every value the app needs. This file is the reference the
// generator and the audit both read, so "what should this colour be" has exactly one
// answer and it is written down.
//
//   node dev/design-system.js          audit the current tokens against the rules
//   node dev/design-system.js --map    show which tokens claim each role
//
// Rules are the industry-converged ones, not invented here:
//   ELEVATION   surfaces separate by LIGHTNESS on one hue. Closer to the viewer = lighter
//               (on a dark UI). Equal steps, so the ladder reads as depth and not as
//               unrelated greys. Material, Radix and Tailwind all land here.
//   HIERARCHY   text tiers are defined by CONTRAST RATIO against their surface, not by
//               picking a lighter grey. 7:1 primary, 4.5:1 secondary, 3:1 tertiary.
//               A tier is a ratio; its hex is whatever satisfies the ratio.
//   EMPHASIS    state and selection separate by LIGHTNESS AND CHROMA, never by importing
//               a hue the palette does not contain. A brighter, more saturated version of
//               the palette reads as "marked" on a monochrome and on a twelve-hue theme.
//   SEMANTIC    meaning outranks palette. Warn is amber and danger is red in every theme,
//               because a desaturated warning is not a warning.
//   CATEGORICAL identity colours (tab accents, mod kinds) are DATA, not UI. Distinct hue,
//               equal lightness, so no category looks more important than another.
//   PAIRING     any fill that carries text also defines its ink, and the pair clears 4.5:1.
//               A fill without an ink is how you get pale-on-pale.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- colour maths

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
const lum = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
// Composite a translucent colour over its backdrop first. Contrast is a property of what
// lands on the screen, and half these tokens are alphas.
const over = (fg, bg) => (fg.a >= 1 ? fg
  : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
function ratio(fg, bg) {
  const a = lum(over(fg, bg)), b = lum(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------- the index

// Each role names a rule and the constraint that rule imposes. `on` is the surface the
// role is measured against, because a contrast tier is meaningless without one.
const ROLES = {
  // ELEVATION - the surface ladder. Step size is checked, not the hex.
  '--s-root':      { rule: 'ELEVATION', step: 0, note: 'window base' },
  '--s-strip':     { rule: 'ELEVATION', step: 1, note: 'inset strips, wells' },
  '--s-card':      { rule: 'ELEVATION', step: 2, note: 'panels, cards' },
  '--s-band-peek': { rule: 'ELEVATION', step: 3, note: 'peek band' },
  '--s-band':      { rule: 'ELEVATION', step: 4, note: 'raised band, headers' },

  // HIERARCHY - text tiers, defined by ratio against the card surface.
  '--tx-hi':    { rule: 'HIERARCHY', on: '--s-card', min: 7,   tier: 'primary' },
  '--tx-body2': { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'secondary' },
  '--tx-body':  { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'secondary' },
  '--tx-mid':   { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'tertiary' },
  '--tx-dim':   { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'tertiary' },
  '--tx-faint': { rule: 'HIERARCHY', on: '--s-card', min: 1.8, tier: 'quaternary, decorative only' },

  // PAIRING - a fill and the ink that sits on it.
  '--am':    { rule: 'PAIRING', ink: '--am-on', min: 4.5, note: 'accent fill' },
  '--am-hi': { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'accent text' },

  // SEMANTIC - hue is fixed across every theme; must still be readable as text.
  '--warn':   { rule: 'SEMANTIC', hue: [20, 50], on: '--s-card', min: 3 },
  '--danger': { rule: 'SEMANTIC', hue: [345, 25], on: '--s-card', min: 3 },
  '--green':  { rule: 'SEMANTIC', hue: [95, 165], on: '--s-card', min: 3, note: 'gain' },
  '--red':    { rule: 'SEMANTIC', hue: [345, 25], on: '--s-card', min: 3, note: 'loss' },

  // EMPHASIS - the marked-row colour. Lifted above the accent, same palette.
  '--info': { rule: 'EMPHASIS', above: '--am', on: '--s-card', min: 3, note: 'user-edited state' },

  // CATEGORICAL - identity, not importance. Equal lightness, distinct hue.
  // mod-kind is written out next to every mod (item-ui.js KIND_LABEL), so colour is a
  // second signal here, not the only one. A mono theme is allowed to collapse it.
  '--k-prop':  { rule: 'CATEGORICAL', set: 'mod-kind', labelled: true, owner: /item[\/\\]/ },
  '--k-rune':  { rule: 'CATEGORICAL', set: 'mod-kind', labelled: true, owner: /item[\/\\]/ },
  '--k-impl':  { rule: 'CATEGORICAL', set: 'mod-kind', labelled: true, owner: /item[\/\\]/ },
  '--k-expl':  { rule: 'CATEGORICAL', set: 'mod-kind', labelled: true, owner: /item[\/\\]/ },
  '--k-craft': { rule: 'CATEGORICAL', set: 'mod-kind', labelled: true, owner: /item[\/\\]/ },
  '--f-corr':  { rule: 'CATEGORICAL', set: 'item-flag', labelled: true, owner: /item[\/\\]/ },
  '--f-desec': { rule: 'CATEGORICAL', set: 'item-flag', labelled: true, owner: /item[\/\\]/ },
  '--f-frac':  { rule: 'CATEGORICAL', set: 'item-flag', labelled: true, owner: /item[\/\\]/ },


  // --- roles recovered from the appearance-named tokens (dev/collapse-plan.js) ---

  // HIERARCHY: every one of these paints TEXT, so each one owes a contrast ratio.
  '--tx-attn':        { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'attention text' },
  '--notice-tx':      { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'notice body' },
  '--notice-tx-hi':   { rule: 'HIERARCHY', on: '--s-card', min: 7,   tier: 'notice emphasis' },
  '--banner-tx':      { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'update banner' },
  '--item-meta-tx':   { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'item meta' },
  '--picker-tx':      { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'picker row' },
  '--tx-hint':        { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'hint' },
  '--tx-placeholder': { rule: 'HIERARCHY', on: '--field-bg', min: 3, tier: 'placeholder' },
  // Decoration only now (the tutorial dot, the em-dash placeholder). It used to paint
  // the arb column too, at 1.81:1, which is why that rule was moved to --tx-dim.
  '--tx-ghost':       { rule: 'HIERARCHY', on: '--s-card', min: 1.5, tier: 'decorative mark, never text' },
  '--stale-tx':       { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'stale value' },
  '--stale-tx2':      { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'stale value, secondary' },
  '--price-cur':      { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'currency unit' },
  '--rx-bad':         { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'excluded regex term' },

  // PAIRING: a fill and the ink that has to survive on top of it.
  '--pool-on-bg':  { rule: 'PAIRING', ink: '--pool-on-tx', min: 4.5, note: 'scope chip, selected' },
  '--danger-btn':  { rule: 'HIERARCHY', on: '--s-card', min: 3, tier: 'destructive action' },
  '--field-bg':    { rule: 'ELEVATION', step: -1, note: 'input well - below the root surface' },

  // SEMANTIC: affirmative state. Green in every theme, same as gain.
  '--ok': { rule: 'SEMANTIC', hue: [95, 165], on: '--s-card', min: 3, note: 'calibrated / saved' },

  // CATEGORICAL: the listing flags. One hue each, equal lightness, and each one also has
  // its word next to it in the listing, so a mono theme may collapse them.
  '--li-sanctified':   { rule: 'CATEGORICAL', set: 'listing-flag', labelled: true, owner: /item[\/\\]/ },
  '--li-unidentified': { rule: 'CATEGORICAL', set: 'listing-flag', labelled: true, owner: /item[\/\\]/ },
  '--li-unrevealed':   { rule: 'CATEGORICAL', set: 'listing-flag', labelled: true, owner: /item[\/\\]/ },
  '--li-twice':        { rule: 'CATEGORICAL', set: 'listing-flag', labelled: true, owner: /item[\/\\]/ },


  // === the rest of the palette, indexed ===============================================
  // Derived from how each token is actually USED (which CSS property it feeds), not from
  // its name. Text owes a ratio against the surface it lands on; a fill that carries text
  // owes that text a ratio; edges and decoration owe neither.

  // TEXT on the card surface. Tier follows the job: something a user reads owes 4.5:1,
  // a label or unit beside it owes 3:1.
  '--tx-gold':    { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'gold heading' },
  '--tx-gold2':   { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'gold body' },
  '--tx-cream':   { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'cream emphasis' },
  '--tx-ash':     { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'ash body' },
  '--tx-sand':    { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'sand label' },
  '--tx-dim2':    { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'dim label' },
  '--tx-faint2':  { rule: 'HIERARCHY', on: '--s-card', min: 1.8, tier: 'faint, decorative' },
  '--gold-dim':   { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'gold label' },
  '--gold-mid':   { rule: 'HIERARCHY', on: '--s-card', min: 1.8, tier: 'gold rule/divider' },
  '--btn-hover-tx': { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'button hover ink' },

  // Gain, loss and status text. SEMANTIC fixes their hue; here they owe legibility.
  '--green-hi':   { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'gain, emphasis' },
  '--green-mid':  { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'gain, secondary' },
  '--red-hi':     { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'loss, emphasis' },
  '--red2':       { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'loss, secondary' },
  '--red-warn':   { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'warning text' },
  '--red-pen':    { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'penalty' },
  '--ok-tx':      { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'affirmative text' },
  '--ok-tx2':     { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'affirmative, secondary' },
  '--danger-tx-hi': { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'destructive hover ink' },
  '--del':        { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'delete affordance' },
  '--bug':        { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'report-a-bug' },
  '--bug-hover':  { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'report-a-bug, hover' },

  // Blues: links, chips, the crafted/desecrated kind tags.
  '--blue':       { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'blue body' },
  '--blue-link':  { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'link' },
  '--link-hover': { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'link, hover' },
  '--pool-tx':    { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'scope chip' },
  '--pool-tx-hi': { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'scope chip, hover' },
  '--k-craft-tag':  { rule: 'HIERARCHY', on: '--s-card', min: 3, tier: 'crafted kind tag' },
  '--k-desec-tag':  { rule: 'HIERARCHY', on: '--s-card', min: 3, tier: 'desecrated kind tag' },

  // Price check readouts.
  '--spark-src':   { rule: 'HIERARCHY', on: '--s-card', min: 3, tier: 'sparkline source' },
  '--spark-down':  { rule: 'HIERARCHY', on: '--s-card', min: 3, tier: 'sparkline, falling' },
  '--floor-unit':  { rule: 'HIERARCHY', on: '--s-card', min: 3, tier: 'floor unit' },

  // Desecrate: its own green identity, on the card surface.
  '--des-tx':       { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'desecrate body' },
  '--des-tx-hi':    { rule: 'HIERARCHY', on: '--s-card', min: 7,   tier: 'desecrate emphasis' },
  '--des-prompt':   { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'desecrate prompt' },
  '--des-aux':      { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'desecrate aux' },
  '--des-dim-tx':   { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'desecrate subhead' },
  '--des-other':    { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'desecrate, other lich' },
  '--des-down':     { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'desecrate verdict, worse' },
  '--des-lead-tx':  { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'desecrate empty-state lead' },
  '--des-lead-em':  { rule: 'HIERARCHY', on: '--s-card', min: 3,   tier: 'desecrate lead emphasis' },
  '--desec':        { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'desecrate accent' },
  '--desec-lab':    { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'desecrate label' },
  '--desec-tab-tx': { rule: 'HIERARCHY', on: '--s-card', min: 4.5, tier: 'desecrate tab, active' },
  '--des-opt-bg':   { rule: 'PAIRING', ink: '--des-opt-tx', min: 4.5, note: 'desecrate tier option' },

  // Grand Expedition tooltip. Measured against ITS OWN surface, not the app card -
  // measuring against the wrong backdrop is how a tooltip passes an audit and is still
  // unreadable. --gx-bg-a is the lighter end of its gradient, so it is the worst case.
  '--gx-prop':   { rule: 'HIERARCHY', on: '--gx-bg-a', min: 4.5, tier: 'gx property' },
  '--gx-line':   { rule: 'HIERARCHY', on: '--gx-bg-a', min: 4.5, tier: 'gx line' },
  '--gx-head':   { rule: 'HIERARCHY', on: '--gx-bg-a', min: 4.5, tier: 'gx heading' },
  '--gx-base':   { rule: 'HIERARCHY', on: '--gx-bg-a', min: 4.5, tier: 'gx base name' },
  '--gx-want':   { rule: 'HIERARCHY', on: '--gx-bg-a', min: 4.5, tier: 'gx wanted' },
  '--gx-rare':   { rule: 'HIERARCHY', on: '--gx-bg-a', min: 4.5, tier: 'gx rare' },
  '--gx-unique': { rule: 'HIERARCHY', on: '--gx-bg-a', min: 4.5, tier: 'gx unique' },
  '--gx-low':    { rule: 'HIERARCHY', on: '--gx-bg-a', min: 3,   tier: 'gx low tier' },
  '--gx-fill':   { rule: 'HIERARCHY', on: '--gx-bg-a', min: 3,   tier: 'gx filler' },

  // FILLS that carry text, and the ink that has to survive on them.
  '--am-grad-a':    { rule: 'PAIRING', ink: '--am-on', min: 4.5, note: 'accent button, top stop' },
  '--am-grad-b':    { rule: 'PAIRING', ink: '--am-on', min: 4.5, note: 'accent button, bottom stop' },
  '--update-btn-a': { rule: 'PAIRING', ink: '--am-on', min: 4.5, note: 'update button, top stop' },
  '--update-btn-b': { rule: 'PAIRING', ink: '--am-on', min: 4.5, note: 'update button, bottom stop' },
  '--pool-on-bg-a': { rule: 'PAIRING', ink: '--pool-on-tx', min: 4.5, note: 'scope chip, top stop' },
  '--tag-hi-b':     { rule: 'PAIRING', ink: '--am-on', min: 4.5, note: 'highly-rated tag' },

  // DECOR - carries no text, so it owes no ratio. Listed anyway: a token with no entry is
  // a token nobody decided about, and that is how the pile came back last time.
  '--slider-thumb': { rule: 'DECOR', note: 'slider knob' },
  '--track-bg':     { rule: 'DECOR', note: 'slider track' },
  '--status-bg':    { rule: 'DECOR', note: 'status strip' },
  '--opt-sel-bg':   { rule: 'DECOR', note: 'selected option row' },
  '--in-bg':        { rule: 'DECOR', note: 'input well tint' },
  '--scrim':        { rule: 'DECOR', note: 'modal scrim, only ever through color-mix' },
  '--paper':        { rule: 'DECOR', note: 'white, only ever a tint source' },
  '--or-chip':      { rule: 'DECOR', note: 'OR chip fill' },
  '--gx-sep':       { rule: 'DECOR', note: 'gx separator' },
  '--gx-bg-a':      { rule: 'DECOR', note: 'gx tooltip surface, top' },
  '--gx-bg-b':      { rule: 'DECOR', note: 'gx tooltip surface, bottom' },
  '--desec-glow':   { rule: 'DECOR', note: 'desecrate tab glow' },
  '--desec-dim':    { rule: 'DECOR', note: 'desecrate unit, muted' },
  '--desec-tab':    { rule: 'DECOR', note: 'desecrate tab underline' },
  '--am-on':        { rule: 'DECOR', note: 'ink for accent fills - checked by PAIRING' },
  '--pool-on-tx':   { rule: 'DECOR', note: 'ink for the selected scope chip - checked by PAIRING' },
  '--des-opt-tx':   { rule: 'DECOR', note: 'ink for the desecrate option row - checked by PAIRING' },

  // EDGES. A border is the seam between two elevations; it carries no text.
  '--am-2':            { rule: 'DECOR', note: 'the accent stroke - 90 sites of borders and tints' },
  '--gold-deep':       { rule: 'DECOR', note: 'deep gold rule' },
  '--slider-thumb-bd': { rule: 'DECOR', note: 'slider knob edge' },
  '--pool-bd':         { rule: 'DECOR', note: 'scope chip edge' },
  '--gx-bd':           { rule: 'DECOR', note: 'gx tooltip edge' },
  '--gx-rare-bd':      { rule: 'DECOR', note: 'gx rare heading edge' },
  '--blue-hi':         { rule: 'DECOR', note: 'blue tint and glow source' },

  // ELEVATION (borders) - a border is an edge between two elevations, so it is an alpha
  // ladder, not five separate colours.
  '--bd-06': { rule: 'LADDER', set: 'border', at: 0.06 },
  '--bd-08': { rule: 'LADDER', set: 'border', at: 0.08 },
  '--bd-09': { rule: 'LADDER', set: 'border', at: 0.09 },
  '--bd-12': { rule: 'LADDER', set: 'border', at: 0.12 },
  '--bd-14': { rule: 'LADDER', set: 'border', at: 0.14 },
  '--bd-16': { rule: 'LADDER', set: 'border', at: 0.16 },
};

// ---------------------------------------------------------------- audit

function loadTokens(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Map();
  for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
    const c = parse(m[2]);
    if (c) out.set(m[1], { raw: m[2], c });
  }
  return out;
}

function audit(tokens, label) {
  const fail = [], warn = [];
  const get = (n) => (tokens.get(n) || {}).c;
  const card = get('--s-card');

  // ELEVATION: equal lightness steps
  const rungs = Object.entries(ROLES).filter(([, r]) => r.rule === 'ELEVATION' && r.step >= 0)
    .sort((a, b) => a[1].step - b[1].step)
    .map(([n]) => ({ n, l: toHSL(get(n)).l }));
  const deltas = rungs.slice(1).map((r, i) => +(r.l - rungs[i].l).toFixed(2));
  if (deltas.some((d) => d <= 0)) fail.push(`ELEVATION ladder is not monotonic: ${deltas.join(', ')}`);
  const spread = Math.max(...deltas) - Math.min(...deltas);
  if (spread > 2.0) warn.push(`ELEVATION steps are uneven (${deltas.join(', ')}); depth reads as unrelated greys`);

  for (const [name, r] of Object.entries(ROLES)) {
    const c = get(name);
    if (!c) { fail.push(`${name} is in the index but not in ${label}`); continue; }
    if (r.on && r.min) {
      const got = ratio(c, get(r.on));
      if (got < r.min) fail.push(`${name} is ${got.toFixed(2)}:1 on ${r.on}, rule wants ${r.min}:1 (${r.tier || r.rule})`);
    }
    if (r.ink) {
      const got = ratio(get(r.ink), c);
      if (got < r.min) fail.push(`PAIRING ${name} / ${r.ink} is ${got.toFixed(2)}:1, rule wants ${r.min}:1`);
    }
    if (r.hue) {
      const h = toHSL(c).h, [lo, hi] = r.hue;
      const ok = lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi;
      if (!ok) fail.push(`SEMANTIC ${name} drifted to hue ${h.toFixed(0)}, rule wants ${lo}-${hi}`);
    }
    // A marked row has to be tellable from the accent. There are two legitimate ways to
    // do that and a palette only ever has one of them available: if the palette has hue
    // headroom, use it; if it is monochrome, there is no headroom and the ONLY honest
    // separation left is lightness plus chroma. Rotating to a hue the palette does not
    // contain is not a third option.
    if (r.above) {
      const a = toHSL(c), b = toHSL(get(r.above));
      const d = Math.abs(a.h - b.h), hueGap = Math.min(d, 360 - d);
      if (hueGap < 45) {
        if (a.l <= b.l + 4 || a.s <= b.s + 4) {
          fail.push(`EMPHASIS ${name} shares the accent's hue (${hueGap.toFixed(0)} deg apart) and is only ${(a.l - b.l).toFixed(1)}L / ${(a.s - b.s).toFixed(1)}S above it; a marked row will not read as marked`);
        }
      }
    }
  }

  // CATEGORICAL: one set, equal lightness, distinct hue
  const sets = {};
  for (const [name, r] of Object.entries(ROLES)) {
    if (r.rule !== 'CATEGORICAL' || !get(name)) continue;
    (sets[r.set] = sets[r.set] || []).push({ name, labelled: r.labelled, ...toHSL(get(name)) });
  }
  for (const [set, list] of Object.entries(sets)) {
    if (list[0].labelled) continue; // colour is a second signal here, it may collapse
    const ls = list.map((x) => x.l);
    if (Math.max(...ls) - Math.min(...ls) > 18) {
      warn.push(`CATEGORICAL "${set}" spans ${(Math.max(...ls) - Math.min(...ls)).toFixed(0)}L; some categories read as more important than others`);
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = Math.abs(list[i].h - list[j].h);
      if (Math.min(d, 360 - d) < 25) warn.push(`CATEGORICAL "${set}": ${list[i].name} and ${list[j].name} are ${Math.min(d, 360 - d).toFixed(0)} deg apart, too close to tell apart`);
    }
  }

  // Coverage: what is NOT in the index at all
  const unindexed = [...tokens.keys()].filter((n) => !ROLES[n]);
  return { fail, warn, unindexed, deltas };
}

// A token is only a system if its roles are respected. The way a design system rots is
// one rule at a time borrowing a colour from a set it does not belong to, because the hex
// happened to match. Catch that here rather than three themes from now.
function borrowScan() {
  const glob = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) glob(f, acc); }
      else if (/\.(css|html|js)$/.test(e.name) && !/tokens\.css|themes\.css|bundle/.test(e.name)) acc.push(f);
    }
    return acc;
  };
  const out = [];
  for (const file of glob(path.join(__dirname, '..', 'renderer'))) {
    const body = fs.readFileSync(file, 'utf8');
    const rel = path.relative(path.join(__dirname, '..'), file);
    for (const [name, r] of Object.entries(ROLES)) {
      if (!r.owner || r.owner.test(rel)) continue;
      const hits = (body.match(new RegExp('var\\(' + name + '\\b', 'g')) || []).length;
      if (hits) out.push(`${rel} uses ${name} (${r.rule} "${r.set}") ${hits}x - that set belongs to the item tab, this is a borrowed role`);
    }
  }
  return out;
}

const TARGETS = [
  ['default (tokens.css)', path.join(__dirname, '..', 'renderer', 'tokens.css')],
  ['industry (themes.css)', path.join(__dirname, '..', 'renderer', 'themes.css')],
];

if (process.argv.includes('--map')) {
  const byRule = {};
  for (const [n, r] of Object.entries(ROLES)) (byRule[r.rule] = byRule[r.rule] || []).push(`${n}${r.tier ? ` (${r.tier})` : r.note ? ` (${r.note})` : ''}`);
  for (const [rule, list] of Object.entries(byRule)) console.log(`${rule}\n  ${list.join('\n  ')}\n`);
  process.exit(0);
}

let bad = 0;
for (const [label, file] of TARGETS) {
  const tokens = loadTokens(file);
  const { fail, warn, unindexed, deltas } = audit(tokens, label);
  console.log(`\n=== ${label} - ${tokens.size} tokens, ${Object.keys(ROLES).length} indexed, ${unindexed.length} unindexed`);
  console.log(`    elevation steps: ${deltas.join(' -> ')}`);
  for (const f of fail) console.log(`  FAIL  ${f}`);
  for (const w of warn) console.log(`  warn  ${w}`);
  if (!fail.length && !warn.length) console.log('  clean');
  bad += fail.length;
}
const borrowed = borrowScan();
console.log('\n=== role borrowing');
if (!borrowed.length) console.log("  clean - no rule paints itself with another set's colour");
for (const b of borrowed) { console.log(`  FAIL  ${b}`); bad++; }

console.log(`\n${bad} rule violation(s).`);
process.exit(bad ? 1 : 0);
