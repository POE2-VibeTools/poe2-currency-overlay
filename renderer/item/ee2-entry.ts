// ee2-entry.ts - esbuild entry that bundles the vendored EE2 parser subtree
// (renderer/vendor/ee2, MIT (c) 2020 Alexander Drozdov) and exposes a small,
// stable surface on window.EE2 for the item tab.
//
// Build: npm run build:item  ->  renderer/item-tab.bundle.js
// Data:  fetched at runtime from the ee2:// protocol (registered in main.js),
//        which serves renderer/vendor/ee2/data/. BASE_URL is defined by esbuild.
//
// NOTE: the data module's lookup exports (STAT_BY_MATCH_STR etc.) are live `let`
// bindings that init() reassigns - they MUST be wrapped in closures here, not
// captured by value at module-evaluation time.
import {
  init,
  STAT_BY_MATCH_STR,
  STAT_BY_REF,
  STATS_ITERATOR,
  ITEMS_ITERATOR,
  ITEM_BY_REF,
  AUGMENT_DATA_BY_AUGMENT,
  setLocalAugmentFilter,
  type Stat,
} from "@/assets/data";
import {
  propAt20Quality,
  calcPropBounds,
  calcPropBase,
  QUALITY_STATS,
} from "@/parser/calc-q20";
import { itemIsModifiable } from "@/parser/ParsedItem";
import {
  parseClipboard,
  ItemRarity,
  ItemCategory,
  type ParsedItem,
} from "@/parser";
import { CATEGORY_TO_TRADE_ID } from "@/web/price-check/trade/pathofexile-trade";
import { setAppConfig } from "@/web/Config";
import type { VendorAppConfig } from "@/web/Config";
type VendorLanguage = VendorAppConfig["language"];
import { setTradeData } from "@/web/background/TradeData";

let ready = false;
let readyLang: string | null = null;

const EE2 = {
  /**
   * Load parser data (idempotent PER LANGUAGE). Must resolve before parse/lookup calls.
   * The language can change after the first load: it is detected from the item text
   * (the client's language), which the app only learns once an item actually arrives,
   * and the warm-up call has to guess before then.
   */
  async init(lang = "en"): Promise<void> {
    if (ready && readyLang === lang) return;
    // the data module's default augment filter rejects EVERY rune (upstream's app
    // installs a real one before init); keep them all so augment lookups work
    setLocalAugmentFilter(() => true);
    // Parser.ts checks the item's detected language against AppConfig().language, NOT
    // against the data that was loaded. Without this, loading the Russian data still
    // left the config on "en", so every non-English item was rejected with
    // "item.wrong_language" - i.e. the app could only ever parse English items.
    setAppConfig({ language: lang as VendorLanguage });
    await init(lang);
    ready = true;
    readyLang = lang;
  },
  get ready() {
    return ready;
  },

  /** Clipboard text -> ParsedItem | error string. Plain-object result. */
  parse(clipboard: string): { ok: true; item: ParsedItem } | { ok: false; error: string } {
    const res = parseClipboard(clipboard);
    if (res.isOk()) return { ok: true, item: res.value };
    return { ok: false, error: res.error };
  },

  // live-binding wrappers (see NOTE above)
  statByMatchStr: (s: string) => STAT_BY_MATCH_STR(s),
  statByRef: (ref: string) => STAT_BY_REF(ref),
  itemByRef: (ns: "ITEM" | "GEM" | "UNIQUE", name: string) => ITEM_BY_REF(ns, name),
  /**
   * Substring scan over item NAMES, for price checking something you cannot put on the
   * clipboard: runestones and Verisium gems inside the rune-combination dialogue, and
   * Ritual remnant reward choices, neither of which Ctrl+C will copy.
   *
   * Matches the player's own language (`name`) but returns `refName` alongside, because
   * trade indexes in English - searching the localised name finds nothing on a
   * translated client. Prefix matches sort first so typing "vo" reaches Voices before
   * every item merely containing those letters.
   */
  itemsSearch(
    includes: string,
    limit = 30,
  ): Array<{ name: string; refName: string; namespace: string; icon?: string; category?: string }> {
    const q = String(includes || "").trim().toLowerCase();
    if (q.length < 2) return [];
    type Hit = {
      name: string;
      refName: string;
      namespace: string;
      icon?: string;
      category?: string;
    };
    const seen = new Set<string>();
    const exact: Hit[] = [];
    const prefix: Hit[] = [];
    const out: Hit[] = [];
    // The ndjson is written with a SPACE after each colon ('"namespace": "GEM"'), so the
    // line filter must include it - '"namespace":"GEM"' matches zero lines and the whole
    // search silently returns nothing. Same form the data module uses for its name lists.
    for (const ns of ["UNIQUE", "GEM", "ITEM"]) {
      for (const item of ITEMS_ITERATOR(`": "${ns}"`)) {
        const nm = item.name || item.refName;
        if (!nm) continue;
        const low = nm.toLowerCase();
        const at = low.indexOf(q);
        if (at < 0) continue;
        const key = `${ns}:${item.refName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const row = {
          name: nm,
          refName: item.refName || nm,
          namespace: ns,
          icon: item.icon,
          // craftable.category separates gear that ROLLS mods (Ring, Bow, Body Armour)
          // from things whose contents are fixed (Currency, Omen, SoulCore)
          category: (item as { craftable?: { category?: string } }).craftable?.category,
        };
        if (low === q) exact.push(row);
        else if (at === 0) prefix.push(row);
        else out.push(row);
        if (exact.length + prefix.length + out.length >= limit * 4) break;
      }
    }
    return [...exact, ...prefix, ...out].slice(0, limit);
  },

  /**
   * Every unique printed on a given base ("Sapphire" -> Grand Spectrum, Voices).
   *
   * An unidentified unique's clipboard text carries the BASE only, never the unique's
   * name, so this is the only way to tell what it might be. 91% of bases carry exactly
   * one unique and resolve outright; the rest are genuinely ambiguous from text alone
   * (Diamond has 7) and the app says so rather than guessing.
   */
  uniquesOnBase(base: string): Array<{ name: string; refName: string; icon?: string }> {
    const want = String(base || "").trim().toLowerCase();
    if (!want) return [];
    const seen = new Set<string>();
    const out: Array<{ name: string; refName: string; icon?: string }> = [];
    for (const item of ITEMS_ITERATOR('": "UNIQUE"')) {
      const b = (item as { unique?: { base?: string } }).unique?.base;
      if (!b || b.toLowerCase() !== want) continue;
      const ref = item.refName || item.name;
      if (!ref || seen.has(ref)) continue; // the db repeats a unique per variant
      seen.add(ref);
      out.push({ name: item.name || ref, refName: ref, icon: item.icon });
    }
    return out;
  },

  /** Substring scan over all stats (feeds the add-mod / make-fungible pickers). */
  statsSearch(includes: string, limit = 50): Stat[] {
    const out: Stat[] = [];
    for (const stat of STATS_ITERATOR(includes)) {
      out.push(stat);
      if (out.length >= limit) break;
    }
    return out;
  },

  /** ItemCategory -> trade2 type_filters category option (e.g. "accessory.ring"). */
  tradeCategory(category: string | undefined): string | undefined {
    return category ? CATEGORY_TO_TRADE_ID.get(category as ItemCategory) : undefined;
  },

  ItemRarity,
  ItemCategory,
  setAppConfig,
  setTradeData,

  // property math (EE2's own q20 machinery)
  propAt20Quality,
  calcPropBounds,
  calcPropBase,
  QUALITY_STATS,
  itemIsModifiable,
  /** rune/augment effect table, e.g. augmentData("Greater Iron Rune") */
  augmentData(name: string) {
    return (AUGMENT_DATA_BY_AUGMENT && AUGMENT_DATA_BY_AUGMENT[name]) || [];
  },
};

declare global {
  interface Window {
    EE2: typeof EE2;
  }
}
window.EE2 = EE2;
