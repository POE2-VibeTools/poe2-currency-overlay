// vendor-ee2-lang.mjs - pull one or more language data sets for the vendored EE2 parser.
//
//   node scripts/vendor-ee2-lang.mjs ru pt de fr es
//   node scripts/vendor-ee2-lang.mjs            (defaults to the five we ship)
//
// Why this exists: the parser reads items/stats for ONE language at a time and we only
// vendored `en`. A player running a Russian client copies Russian item text, which the
// English data cannot match at all - the price check simply fails. Each language is ~2.7MB
// against a ~97MB installer, so we ship them rather than downloading at runtime.
//
// Upstream ships the .ndjson + client_strings only; the four *.index.bin lookup files are a
// build artifact, so gen-ee2-index.mjs regenerates them per language afterwards.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.join(HERE, "..", "renderer", "vendor", "ee2", "data");
const RAW = "https://raw.githubusercontent.com/Kvan7/Exiled-Exchange-2/master/renderer/public/data";
// app_i18n.json is EE2's OWN interface translation - we have our own catalogs, skip it.
const FILES = ["items.ndjson", "stats.ndjson", "client_strings.js"];
const DEFAULT_LANGS = ["ru", "pt", "de", "fr", "es"];

const langs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_LANGS;

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

for (const lang of langs) {
  const dir = path.join(DATA_ROOT, lang);
  fs.mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (const file of FILES) {
    const buf = await get(`${RAW}/${lang}/${file}`);
    fs.writeFileSync(path.join(dir, file), buf);
    bytes += buf.length;
  }
  // the runtime binary-searches these; they must match the .ndjson byte-for-byte
  execFileSync(process.execPath, [path.join(HERE, "gen-ee2-index.mjs"), lang], { stdio: "inherit" });
  console.log(`  ${lang}: ${(bytes / 1048576).toFixed(1)}MB downloaded + indexes rebuilt`);
}
console.log(`done: ${langs.join(", ")}`);
