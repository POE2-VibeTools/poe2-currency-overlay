// i18n-check-translation.mjs - structural QA for a translated catalog.
//
//   node scripts/i18n-check-translation.mjs ru
//   node scripts/i18n-check-translation.mjs            (checks every shipped language)
//
// It does NOT judge the prose - it catches the mistakes that break the app rather than
// merely reading badly:
//   - a placeholder renamed or dropped ({hotkey} -> {горячая}) prints a literal brace
//     to the user and loses the value
//   - HTML tags mangled inside a string that gets assigned with innerHTML
//   - a game term translated when the catalog says it must not be (Exalted, Waystone,
//     Aldur, stash tab names) - those must match what the trade site and every guide say
//   - keys invented that English doesn't have, which nothing will ever look up
// Missing keys are reported but are NOT an error: i18n.js falls back to English per key,
// which is the whole point of the fallback chain.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const I18N = path.join(HERE, "..", "renderer", "i18n");
const META = JSON.parse(fs.readFileSync(path.join(HERE, "..", "dev-docs", "i18n", "_meta.json"), "utf8"));

function load(code) {
  const src = fs.readFileSync(path.join(I18N, `${code}.js`), "utf8");
  const w = {};
  new Function("window", src)(w);
  return w.I18N_CATALOGS[code];
}

const en = load("en");
const langs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(I18N).filter((f) => /^[a-z]{2}\.js$/.test(f)).map((f) => f.slice(0, 2)).filter((c) => c !== "en" && c !== "qa");

const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
const tags = (s) => (String(s).match(/<\/?[a-z][^>]*>/gi) || []).map((x) => x.toLowerCase().replace(/\s+/g, " ")).sort();
// terms the notes say to leave alone; if English has it, the translation must too
const KEEP = /\b(Exalted|Divine|Chaos|Annul|Mirror|Waystone|Precursor|Tablet|Aldur|Aldurs|Uncharted Waters|Grand Expedition|Omen|Cranium|Instant Buyout|Corrupted|Fractured|Desecrated|Sanctified|Mirrored|Abyss|Ritual|Essence|Breach|Delirium|Expedition|Kalguuran|Soul Cores|Idols|Ancient Augments)\b/g;

let bad = 0;
for (const code of langs) {
  let cat;
  try { cat = load(code); } catch (err) { console.error(`${code}: cannot load - ${err.message}`); bad++; continue; }
  const problems = [];
  const missing = [];
  for (const key of Object.keys(en)) {
    if (cat[key] === undefined) { missing.push(key); continue; }
    const a = en[key], b = cat[key];
    if (String(ph(a)) !== String(ph(b))) problems.push(`${key}: placeholders ${ph(a).join(",") || "-"} -> ${ph(b).join(",") || "-"}`);
    if (String(tags(a)) !== String(tags(b))) problems.push(`${key}: markup ${tags(a).join("") || "-"} -> ${tags(b).join("") || "-"}`);
    const note = code === "qa" ? "" : (META[key] && META[key].note) || ""; // the QA locale mangles everything on purpose
    if (/do not translate|game term|proper noun|untranslated/i.test(note)) {
      const want = a.match(KEEP) || [];
      const missTerm = want.filter((w) => !b.includes(w));
      if (missTerm.length) problems.push(`${key}: game term(s) translated away: ${[...new Set(missTerm)].join(", ")}`);
    }
  }
  // Strings identical to English. Often correct (game terms, "Regex", currency codes),
  // but it's also exactly how an untranslated string hides - a translator leaving the
  // English in place looks like a deliberate decision until someone reads the UI. Report,
  // never fail: judging which are intentional needs a human.
  const identical = Object.keys(en).filter((k) => cat[k] !== undefined && cat[k] === en[k]
    && /[a-z]{4}/i.test(en[k]) && !/do not translate|game term|proper noun|GROUNDED/i.test((META[k] && META[k].note) || ""));

  const extra = Object.keys(cat).filter((k) => en[k] === undefined && !/\.(one|two|few|many|zero|other)$/.test(k));
  const pct = (((Object.keys(en).length - missing.length) / Object.keys(en).length) * 100).toFixed(1);
  console.log(`\n${code}: ${Object.keys(en).length - missing.length}/${Object.keys(en).length} keys (${pct}%)`);
  if (extra.length) problems.push(`${extra.length} key(s) not in English: ${extra.slice(0, 5).join(", ")}`);
  if (missing.length) console.log(`  missing ${missing.length} (falls back to English, not an error)`);
  if (identical.length) console.log(`  identical to English: ${identical.length} (check these are deliberate: ${identical.slice(0, 6).join(", ")}${identical.length > 6 ? ", ..." : ""})`);
  if (problems.length) {
    bad++;
    console.error(`  PROBLEMS (${problems.length}):`);
    problems.slice(0, 25).forEach((p) => console.error(`    ${p}`));
    if (problems.length > 25) console.error(`    ...and ${problems.length - 25} more`);
  } else {
    console.log("  structure OK");
  }
}
process.exit(bad ? 1 : 0);
