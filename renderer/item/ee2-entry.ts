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
