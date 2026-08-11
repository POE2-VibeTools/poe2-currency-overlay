// [EE2-VENDOR PATCH] Replaces the upstream dynamic-import loader.
//
// Upstream:
//   await import(`${import.meta.env.BASE_URL}data/${lang}/client_strings.js`)
// A runtime-templated dynamic import cannot be statically bundled, and dynamic ESM
// import over a custom Electron scheme from a file:// page is unsupported, so every
// shipped dictionary is imported statically here (esbuild inlines them).
//
// This map held ONLY "en" until 2026-08-11. Multi-language shipped in 2.6.0, and the
// Settings copy says the language "reads your items in this language too" - but the
// parser fell back to the English dictionary for every language, so the class-line
// check failed and every non-English item was rejected with "item.wrong_language".
// The app could only ever read English items. If a language is added to the UI, its
// dictionary MUST be added here too.
import { TranslationDict } from "./data/interfaces";
import en from "../../data/en/client_strings.js";
import ru from "../../data/ru/client_strings.js";
import de from "../../data/de/client_strings.js";
import fr from "../../data/fr/client_strings.js";
import es from "../../data/es/client_strings.js";
import pt from "../../data/pt/client_strings.js";

const DICTS: Record<string, TranslationDict> = { en, ru, de, fr, es, pt };

export async function loadClientStrings(
  lang: string,
): Promise<TranslationDict> {
  const dict = DICTS[lang] ?? DICTS.en;
  return dict;
}
