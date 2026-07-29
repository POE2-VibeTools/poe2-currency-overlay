// gen-ee2-index.mjs - regenerates the four *.index.bin lookup files that the vendored
// EE2 parser (renderer/vendor/ee2/src/assets/data/index.ts) binary-searches at runtime.
//
// EE2's repo ships only the .ndjson data; the .bin indexes are a build artifact of their
// pipeline. We regenerate them here so a league refresh is just:
//   1. re-download data/en/{stats,items}.ndjson (+ client_strings.js, item-drop.json,
//      patrons.json) from Kvan7/Exiled-Exchange-2 master
//   2. node scripts/gen-ee2-index.mjs
//
// Format (derived from the reader in assets/data/index.ts):
//   - little-endian Uint32Array of [fnv1a32(key), offset] rows, sorted ascending by hash
//   - offset is a **JS-string index** (UTF-16 code units of the UTF-8-decoded file), NOT a
//     byte offset: the runtime does `ndjson.indexOf("\n", offset)` on the decoded text.
//   - duplicate keys keep the FIRST line's offset (the reader walks contiguous lines
//     forward for items with the same name).
// Key spaces:
//   items-name.index.bin    fnv1a32(`${namespace}::${name}`)
//   items-ref.index.bin     fnv1a32(`${namespace}::${refName}`)
//   stats-ref.index.bin     fnv1a32(stat.ref)
//   stats-matcher.index.bin fnv1a32(matcher.string) and fnv1a32(matcher.advanced)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fnv1a from "@sindresorhus/fnv1a";

// which vendored language to (re)index: `node scripts/gen-ee2-index.mjs ru`
const LANG = process.argv[2] || "en";
const DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "renderer", "vendor", "ee2", "data", LANG,
);

const h32 = (s) => Number(fnv1a(s, { size: 32 }));

/** Yield { line, offset } for every line, offset in decoded-string space. */
function* lines(text) {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    if (end > start) yield { line: text.slice(start, end), offset: start };
    start = end + 1;
  }
}

/** entries: Map<key, offset> -> sorted LE Uint32Array file */
function writeIndex(file, entries) {
  const rows = [...entries].map(([key, offset]) => [h32(key), offset]);
  rows.sort((a, b) => a[0] - b[0]);
  const arr = new Uint32Array(rows.length * 2);
  rows.forEach(([hash, offset], i) => { arr[i * 2] = hash; arr[i * 2 + 1] = offset; });
  fs.writeFileSync(path.join(DATA_DIR, file), Buffer.from(arr.buffer));
  return rows.length;
}

/** Insert only the first occurrence of a key; count exact-key duplicates. */
function firstOnly(map, key, offset, stats) {
  if (map.has(key)) { stats.dups++; return; }
  map.set(key, offset);
}

// ---- items ----
{
  const text = fs.readFileSync(path.join(DATA_DIR, "items.ndjson"), "utf8");
  const byName = new Map();
  const byRef = new Map();
  const st = { dups: 0 };
  for (const { line, offset } of lines(text)) {
    const rec = JSON.parse(line);
    firstOnly(byName, `${rec.namespace}::${rec.name}`, offset, st);
    firstOnly(byRef, `${rec.namespace}::${rec.refName}`, offset, st);
  }
  console.log(`items-name.index.bin  ${writeIndex("items-name.index.bin", byName)} keys`);
  console.log(`items-ref.index.bin   ${writeIndex("items-ref.index.bin", byRef)} keys  (${st.dups} contiguous dups folded)`);
}

// ---- stats ----
{
  const text = fs.readFileSync(path.join(DATA_DIR, "stats.ndjson"), "utf8");
  const byRef = new Map();
  const byMatcher = new Map();
  const st = { dups: 0 };
  for (const { line, offset } of lines(text)) {
    const rec = JSON.parse(line);
    firstOnly(byRef, rec.ref, offset, st);
    for (const m of rec.matchers ?? []) {
      if (m.string) firstOnly(byMatcher, m.string, offset, st);
      if (m.advanced) firstOnly(byMatcher, m.advanced, offset, st);
    }
  }
  console.log(`stats-ref.index.bin     ${writeIndex("stats-ref.index.bin", byRef)} keys`);
  console.log(`stats-matcher.index.bin ${writeIndex("stats-matcher.index.bin", byMatcher)} keys  (${st.dups} dup keys, first kept)`);
}
