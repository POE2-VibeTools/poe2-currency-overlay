// release-notes.js - the app's patch-note history, newest first.
// - The newest entry drives the one-time "What's new" popup shown on first launch
//   after an update (see renderer.js maybeShowPatchNotes / config.lastSeenVersion).
// - The full list backs the "Release notes" viewer in Settings > Help & About.
// Keep entries in Drew's voice, short, no em-dashes. Add the new version on top
// each cut; the popup and the history viewer both read from here automatically.
window.RELEASE_NOTES = [
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
