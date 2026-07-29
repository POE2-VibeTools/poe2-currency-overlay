// i18n-verify.mjs - guard rail for the replacement pass.
//
//   node scripts/i18n-verify.mjs
//
// A t('key') whose key is not in the catalog renders the KEY ITSELF on screen (i18n.js
// never blanks a label). That fails loudly in the app but silently in a diff, so this
// checks every key used in the renderer against renderer/i18n/en.js and exits non-zero
// on a miss. Also reports catalog keys nothing uses yet, which is how we track how much
// of the replacement pass is actually done.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const RENDERER = path.join(ROOT, "renderer");

// load the generated catalog without a browser
const catalogSrc = fs.readFileSync(path.join(RENDERER, "i18n", "en.js"), "utf8");
const sandbox = { window: {} };
new Function("window", catalogSrc)(sandbox.window);
const en = sandbox.window.I18N_CATALOGS.en;
const known = new Set(Object.keys(en));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "vendor" || e.name === "i18n") continue; // vendored parser + the catalogs themselves
      walk(p, out);
    } else if (/\.(js|html)$/.test(e.name) && e.name !== "item-tab.bundle.js") {
      out.push(p);
    }
  }
  return out;
}

const used = new Map(); // key -> [file...]
// t('x') / tn('x', n) / window.t("x") / data-i18n="x" and its attribute variants
const CALL = /\b(?:window\.)?tn?\(\s*['"]([\w.]+)['"]/g;
const ATTR = /data-i18n(?:-html|-title|-ph|-aria)?\s*=\s*["']([\w.]+)["']/g;

for (const file of walk(RENDERER)) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  for (const re of [CALL, ATTR]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      used.set(m[1], (used.get(m[1]) || []).concat(rel));
    }
  }
}

// plural call sites use a base key whose real entries are "<key>.one" etc.
const isPluralBase = (k) => [...known].some((x) => x.startsWith(k + "."));
const unknown = [...used.keys()].filter((k) => !known.has(k) && !isPluralBase(k));
const unused = [...known].filter((k) => !used.has(k) && !used.has(k.replace(/\.(one|few|many|two|zero|other)$/, "")));

console.log(`catalog keys: ${known.size}`);
console.log(`keys referenced in code: ${used.size}`);
console.log(`replacement progress: ${(((known.size - unused.length) / known.size) * 100).toFixed(1)}%`);
if (unknown.length) {
  console.error(`\nUNKNOWN KEYS (${unknown.length}) - these would render as raw keys on screen:`);
  for (const k of unknown.slice(0, 40)) console.error(`  ${k}   <- ${[...new Set(used.get(k))].join(", ")}`);
  if (unknown.length > 40) console.error(`  ...and ${unknown.length - 40} more`);
  process.exit(1);
}
console.log("\nno unknown keys.");
if (unused.length) console.log(`not yet wired up: ${unused.length} keys`);
