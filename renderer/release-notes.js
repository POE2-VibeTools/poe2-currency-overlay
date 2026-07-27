// release-notes.js - the app's patch-note history, newest first.
// - The newest entry drives the one-time "What's new" popup shown on first launch
//   after an update (see renderer.js maybeShowPatchNotes / config.lastSeenVersion).
// - The full list backs the "Release notes" viewer in Settings > Help & About.
// Keep entries in Drew's voice, short, no em-dashes. Add the new version on top
// each cut; the popup and the history viewer both read from here automatically.
window.RELEASE_NOTES = [
  {
    version: '2.4.1',
    date: '2026-07-27',
    title: 'Hotfix - 2.4.0 launch crash',
    notes: [
      "Fixed a packaging bug that left a data file out of the 2.4.0 build, so it failed to launch with a 'Cannot find module' error. Sorry about that - if you grabbed 2.4.0, this update gets you running.",
    ],
  },
  {
    version: '2.4.0',
    date: '2026-07-27',
    title: 'Stash Tab Auto-Calculator (Net Worth Tab)',
    notes: [
      "New Net Worth tab. Open a special stash tab in game, press F7, and it reads the counts and adds the tab to a running total. 1920x1080 or larger recommended.",
      "Not at 1920x1080? Hit Calibrate in Net Worth settings, frame any currency tab's coloured border and calibrate (auto-snap works well). Done.",
      "Supports: Currency, Abyss, Ritual, Essence, all 5 Rune subtabs (Runes, Kalguuran, Soul Cores, Idols, Ancient Augments), Delirium, Breach and Expedition.",
      "Shows your total in Div, with a Mirror conversion for the richies.",
      "Toggle any whole tab on or off, and any single row within a tab, to shape the total.",
      "'Duplicates allowed' toggle in settings lets you register multiple copies of the same tab type, for those of you who split loot across duplicate tabs.",
      "Parser got a number wrong? Edit it inline. It's not perfect (some icons obfuscate the number) but it's high accuracy, and I'm done grinding parser values. Flip on the confidence rating to spot the shaky ones: above 80% is usually good, but it can slip, and you can fix any value in one click.",
      "Also improved pricing for currency items poe2scout doesn't list, like Raven's Reflection, on both the Net Worth and Currency tabs.",
    ],
  },
  {
    version: '2.3.5',
    date: '2026-07-26',
    title: 'OpenDyslexic support, Linux (EXPERIMENTAL), Patch Notes Modal changes',
    notes: [
      "Added OpenDyslexic, a dyslexia-friendly font. Toggle it on in Settings under the App section. Applies to the whole app.",
      "Experimental Linux support (AppImage). It forces XWayland automatically, so the overlay, hotkey and item-copy work without you adding any command line flags. It's experimental - report anything that misbehaves.",
      "The patch-notes popup now scrolls through the full history, with a version sidebar on the left. Click any version to jump to it.",
    ],
  },
  {
    version: '2.3.4',
    date: '2026-07-25',
    title: 'API Rates & Small QoL Fixes',
    notes: [
      "Fixed API problems, which in some cases was causing artificial (local only) timeouts. Removed entirely. Any timeout you get is now real. Don't spam!",
      "Listings now paginate at 10 and you can load more. This further improves API usage rates.",
      "Currency API rate handling - 2 new settings inside the Currency settings let you control the rate the app pings GGG for currency pairs. At HIGH it refreshes all primary pairs every 2.5m, and scales down from there. Slider 1 is how it polls while you're viewing the Currency tab; Slider 2 is how it polls while the app is backgrounded or the tab isn't selected. These calls use the same bucket as your item searches, so if you hit rate limits often while ctrl+F'ing gear, tune down Slider 2.",
      "Exceptional bases were searching with runes turned on, which threw off the results. Cleaned that up so they search like the game does (quality 20, no runes, uncorrupted). Should match what you'd expect now.",
      "Added patch notes that pop up after an update so you can see what I'm up to.",
      "Added a way to re-read the patch notes any time from the App Settings.",
      "Fixed small dyslexic toggle bug, now (should) accurately swap all instances of currency names on the price check tab.",
      "Drag-to-reorder on Currency Tab, as well as drag out of bucket and drop to delete.",
      "Add more than one currency to a bucket at a time.",
      "Added support for some missed Verisium stuff.",
      "Pagination applied to Desecration tab + PC tab.",
      "App now remembers what tab you closed it on and opens to that tab.",
      "Tutorial updated.",
    ],
  },
];
