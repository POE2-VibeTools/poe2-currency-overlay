// i18n-ground-labels.mjs - replace translated property labels with GGG's own wording.
//
//   node scripts/i18n-ground-labels.mjs          (report only)
//   node scripts/i18n-ground-labels.mjs --write  (apply)
//
// The vendored parser data ships client_strings.js per language: 100+ strings lifted from
// the game client itself (ARMOUR, EVASION, WAYSTONE_PACK_SIZE...). Our property labels are
// the same vocabulary, so there is no reason to trust five independent AI translations of
// words GGG has already translated - the player is reading their own client right next to
// our panel, and any difference is friction.
//
// Only labels with an unambiguous client-string counterpart are grounded. Everything else
// stays as translated.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "renderer", "vendor", "ee2", "data");
const I18N = path.join(HERE, "..", "renderer", "i18n");
const WRITE = process.argv.includes("--write");
const LANGS = ["ru", "pt", "de", "fr", "es"];

// our catalog key -> the client string that says the same thing
const MAP = {
  "itemtab.property.armour": "ARMOUR",
  "itemtab.property.evasion": "EVASION",
  "itemtab.property.energy_shield": "ENERGY_SHIELD",
  "itemtab.property.runic_ward": "RUNIC_WARD",
  "itemtab.property.block": "BLOCK_CHANCE",
  "itemtab.property.critical_chance": "CRIT_CHANCE",
  "itemtab.property.attacks_per_second": "ATTACK_SPEED",
  "itemtab.property.spirit": "BASE_SPIRIT",
  "itemtab.property.waystone_tier": "WAYSTONE_TIER",
  "itemtab.property.revives_available": "WAYSTONE_REVIVES",
  "itemtab.property.pack_size": "WAYSTONE_PACK_SIZE",
  "itemtab.property.monster_rarity": "WAYSTONE_MONSTER_RARITY",
  "itemtab.property.monster_effectiveness": "WAYSTONE_EFFECTIVENESS",
  "itemtab.property.waystone_drop_chance": "WAYSTONE_DROP_CHANCE",
  "itemtab.property.item_rarity": "WAYSTONE_RARITY",
  "itemtab.property.status_corrupted": "CORRUPTED",
  "itemtab.property.status_mirrored": "MIRRORED",
  "itemtab.property.status_sanctified": "SANCTIFIED",
  "itemtab.property.status_unmodifiable": "UNMODIFIABLE",
  "itemtab.property.status_fractured": "FRACTURED_ITEM",
};

function clientStrings(lang) {
  const file = path.join(DATA, lang, "client_strings.js");
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  const out = {};
  // KEY: 'value with \' escapes',
  for (const m of src.matchAll(/^\s*([A-Z_0-9]+):\s*'((?:[^'\\]|\\.)*)'/gm)) {
    out[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return out;
}

// client strings carry their punctuation ("Gegenstandsstufe: "); our labels don't
const clean = (s) => s.replace(/\s*:\s*$/, "").trim();

for (const lang of LANGS) {
  const cs = clientStrings(lang);
  const catFile = path.join(I18N, `${lang}.js`);
  if (!cs || !fs.existsSync(catFile)) { console.log(`${lang}: skipped (no data)`); continue; }
  let src = fs.readFileSync(catFile, "utf8");
  const w = {};
  new Function("window", src)(w);
  const cat = w.I18N_CATALOGS[lang];
  const changes = [];
  for (const [key, csKey] of Object.entries(MAP)) {
    const official = cs[csKey] && clean(cs[csKey]);
    if (!official || cat[key] === undefined || cat[key] === official) continue;
    changes.push({ key, was: cat[key], now: official });
    if (WRITE) {
      // rewrite just this key's value, leaving the rest of the file untouched
      const re = new RegExp(`("${key.replace(/\./g, "\\.")}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
      if (!re.test(src)) { console.error(`  ${lang}: could not locate ${key} in the file`); continue; }
      src = src.replace(re, `$1${JSON.stringify(official)}`);
    }
  }
  if (WRITE && changes.length) fs.writeFileSync(catFile, src);
  console.log(`\n${lang}: ${changes.length} label(s) ${WRITE ? "grounded" : "would change"}`);
  for (const c of changes.slice(0, 8)) console.log(`  ${c.key.replace("itemtab.property.", "")}: ${JSON.stringify(c.was)} -> ${JSON.stringify(c.now)}`);
  if (changes.length > 8) console.log(`  ...and ${changes.length - 8} more`);
}
if (!WRITE) console.log("\n(report only - re-run with --write to apply)");
