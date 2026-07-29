'use strict';
// i18n.js - the app's string catalog, loaded before every other renderer script.
//
// Design constraints that shaped this:
//   - The renderer is a set of CLASSIC scripts sharing one window (no modules, no
//     bundler for anything but the vendored parser), so this is a global: window.t().
//   - CSP is `style-src 'self'` and `default-src 'self'`: catalogs are plain .js
//     files listed in index.html, never fetched.
//   - A missing key must NEVER blank the UI. Lookup falls back to English, then to
//     the key itself, so a half-translated catalog degrades to English instead of
//     rendering empty boxes. That fallback is what lets a new feature ship its
//     strings in English and get translated on the NEXT pass without blocking a
//     release, and without anyone seeing a hole.
//   - Game terms (Exalted, Waystone, Aldur, stash tab names...) are deliberately NOT
//     in the catalogs. They stay English everywhere, because that is what the trade
//     site, the wiki and every guide call them.
//
// Usage:  t('item.floor.label')                      -> "Suggested floor"
//         t('networth.empty.instructions', {hotkey}) -> placeholders filled
// Strings flagged html:true in the catalog carry markup and are assigned with
// innerHTML by their call site; t() itself does no escaping - the call site decides,
// exactly as it did when the string was a literal.
(function () {
  const CATALOGS = window.I18N_CATALOGS || (window.I18N_CATALOGS = {});
  let active = 'en';

  // "{name}" -> vars.name. A placeholder with no matching var is left as-is, which
  // shows up loudly in testing instead of silently printing "undefined".
  function fill(str, vars) {
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, (whole, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole
    ));
  }

  function t(key, vars) {
    const cur = CATALOGS[active];
    const en = CATALOGS.en;
    let s = cur && Object.prototype.hasOwnProperty.call(cur, key) ? cur[key] : undefined;
    if (s === undefined && en && Object.prototype.hasOwnProperty.call(en, key)) s = en[key];
    if (s === undefined) s = key; // never render empty; the key is a visible symptom
    return fill(s, vars);
  }

  // Plurals. English gets away with "{n} payment{s}", Russian does not: it has one/few/
  // many forms and the rule depends on the last digits (1 payment, 2 payments, 5 payments
  // are three different words). Chromium ships the CLDR rules, so ask it rather than
  // inventing them: the catalog holds "<key>.one" / ".few" / ".many" / ".other" and this
  // picks the right one, falling back to ".other" then to the bare key. {n} is filled in
  // for free so call sites read tn('currency.bucket.payment_count', n).
  const pluralRules = {};
  function tn(key, count, vars) {
    let cat = 'other';
    try {
      const l = CATALOGS[active] ? active : 'en';
      pluralRules[l] = pluralRules[l] || new Intl.PluralRules(l);
      cat = pluralRules[l].select(count);
    } catch { /* no Intl data: 'other' is the safe form */ }
    const merged = Object.assign({ n: count }, vars || {});
    const cur = CATALOGS[active] || {};
    const en = CATALOGS.en || {};
    for (const k of [`${key}.${cat}`, `${key}.other`, key]) {
      if (cur[k] !== undefined) return fill(cur[k], merged);
      if (en[k] !== undefined) return fill(en[k], merged);
    }
    return key;
  }

  // Which languages the app can display. The PARSER's language list is separate and
  // larger - see the item tab. Adding one here means: ship renderer/i18n/<code>.js,
  // add it to index.html, add it here.
  const LANGS = [
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'pt', label: 'Português (Brasil)' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
  ];

  // QA pseudo-locale: only offered when the app runs with POE2_OVERLAY_DEBUG set, so
  // users never see it. Everything it renders is bracketed and padded - any plain
  // English still on screen in this mode is a string the extraction missed.
  try { if (window.api && window.api.debug && CATALOGS.qa) LANGS.push({ code: 'qa', label: 'QA pseudo-locale' }); } catch {}

  function setLang(code) {
    active = CATALOGS[code] ? code : 'en';
    return active;
  }
  function lang() { return active; }
  // how complete a catalog is, for the settings screen and for our own testing
  function coverage(code) {
    const en = CATALOGS.en || {};
    const c = CATALOGS[code] || {};
    const total = Object.keys(en).length;
    if (!total) return { done: 0, total: 0, pct: 100 };
    const done = Object.keys(en).filter((k) => c[k] !== undefined).length;
    return { done, total, pct: Math.round((done / total) * 100) };
  }

  // Currency names. The price feed only speaks English, but the player's stash and
  // trade site are in their language, so "Exalted Orb" would make them translate in
  // their head. game-names.js maps the English name to GGG's own name in that language
  // (derived from the parser data, not translated by us), so it matches the game
  // exactly. Anything without an entry - and every name in English - passes straight
  // through unchanged.
  function gameName(englishName) {
    if (!englishName || active === 'en') return englishName;
    const names = (window.I18N_NAMES || {})[active];
    return (names && names[englishName]) || englishName;
  }

  // Rumour and island names for the Grand Expedition tab. The player reads these off
  // their own screen in Uncharted Waters, so they have to match the client, not a guide.
  // DISPLAY ONLY: the English name stays the identity everywhere - the picked set, the
  // map-note tag's letter codes, and every data lookup key off it. Translating identity
  // would break tags between players on different languages.
  function rumorName(englishName) {
    if (!englishName || active === 'en') return englishName;
    const names = (window.I18N_RUMORS || {})[active];
    return (names && names[englishName]) || englishName;
  }

  // Static markup (index.html) keeps its English text inline and carries the key in a
  // data attribute, e.g. <button data-i18n="ui.titlebar.refresh_tooltip">. This pass
  // rewrites those nodes for the active language. Two reasons for the attribute style
  // over generating the markup from JS: the English text stays readable in the HTML and
  // survives if this script ever fails, and translating never has to reproduce markup.
  //   data-i18n       -> textContent
  //   data-i18n-html  -> innerHTML (only for strings the catalog flags as markup)
  //   data-i18n-title / -ph / -aria -> title, placeholder, aria-label
  function applyStatic(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    scope.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  }

  // Adopt the language main resolved for us, before any other renderer script runs.
  try { if (window.api && window.api.uiLang) setLang(window.api.uiLang); } catch {}
  // The markup carries its English inline and its key in data-i18n; swap it once the
  // DOM is parsed. In English this is a no-op that rewrites identical text.
  if (typeof document !== 'undefined') {
    // Reveal only after the static strings are swapped, so a language change (which
    // applies via a window reload) never flashes the untranslated, unstyled document.
    // The timer is a safety net: if anything above throws, the UI still appears.
    const reveal = () => { try { document.getElementById('root').classList.add('ui-ready'); } catch {} };
    document.addEventListener('DOMContentLoaded', () => {
      try { applyStatic(); } catch {}
      reveal();
    });
    window.addEventListener('load', reveal);
    setTimeout(reveal, 1500);
  }

  window.t = t;
  window.tn = tn;
  window.gameName = gameName;
  window.rumorName = rumorName;
  window.I18N = { t, tn, gameName, rumorName, setLang, lang, coverage, applyStatic, LANGS };
})();
