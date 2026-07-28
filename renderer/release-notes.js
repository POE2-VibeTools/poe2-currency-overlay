// release-notes.js - the app's patch-note history, newest first.
// - The newest entry drives the one-time "What's new" popup shown on first launch
//   after an update (see renderer.js maybeShowPatchNotes / config.lastSeenVersion).
// - The full list backs the "Release notes" viewer in Settings > Help & About.
// Keep entries in Drew's voice, short, no em-dashes. Add the new version on top
// each cut; the popup and the history viewer both read from here automatically.
window.RELEASE_NOTES = [
  {
    version: '2.5.4',
    date: '2026-07-28',
    title: 'Linux fixes, take two',
    notes: [
      'Linux only. Nothing changes on Windows - every fix in this build sits behind a platform check.',
      'The X11 backend flag is now baked into the packaged launcher itself, so you no longer need to pass --ozone-platform=x11 by hand. 2.5.3 claimed this and was wrong: the flag has to be on the real command line, and neither of the two ways the app tried to do that reached it.',
      'The price-check hotkey falls back to your clipboard. If the app can\'t drive the game\'s copy (it can\'t on a GNOME Wayland session), press Ctrl+C in game yourself and then the hotkey, and it prices what you copied.',
      'Command hotkeys like /hideout fire again. They were checking "is the game focused", which has no answer outside Windows, and treating no-answer as no.',
    ],
  },
  {
    version: '2.5.3',
    date: '2026-07-28',
    title: 'Linux fixes',
    notes: [
      'Linux only. Nothing changes on Windows - every fix in this build sits behind a platform check.',
      'Tried to force the X11 backend flag at launch, since without it the GPU process crashes and no hotkey can register. This attempt did NOT work - keep passing --ozone-platform=x11 yourself on 2.5.3.',
      'The hide button actually hides the overlay. It was only turning it transparent, which does nothing without a compositor honouring it.',
      'The overlay no longer shows up at launch before you press the toggle.',
      'Stash capture (F7) fails with an error after 8 seconds instead of sitting on "Scanning" forever. Capture on GNOME still needs the desktop portal - separate work.',
      'Update errors are logged instead of blocking the app behind an error dialog.',
    ],
  },
  {
    version: '2.5.2',
    date: '2026-07-28',
    title: 'Your feedback, shipped',
    notes: [
      'Skill gems price check properly now. Gem level and quality drive the search, and a gem copied while socketed discounts your gear\'s +levels, so a level 20 gem searches as 20 instead of 32.',
      'Suggested floor shows the other currencies too. 0.7 div now also reads in exalted and chaos, so you don\'t need the exchange rate memorized.',
      'Currency buckets collapse with the chevron in their header, and you can drag whole cards into the order you want. A collapsed bucket still shows its cheapest payment.',
      'Fixed: clicking Search, or another filter box, straight out of a filter field took two clicks.',
      'Fixed: long prices overlapped the item name in the results list.',
    ],
  },
  {
    version: '2.5.1',
    date: '2026-07-27',
    title: 'Tutorial covers the new tabs',
    notes: [
      'The tutorial now spotlights Net Worth, Regex and Grand Expedition, offered right after the Price Check + Desecrate run',
      'Each of them has its own Replay chip in Settings → Help & About, so you can revisit one tab instead of the whole tour',
      'Regex and Grand Expedition spotlight a demo build and a demo roster, so you see a real pattern and a real verdict instead of empty boxes. Your own picks come back when the tour ends',
      'Command Hotkeys got a mention in the tutorial\'s Settings step',
    ],
  },
  {
    version: '2.5.0',
    date: '2026-07-27',
    title: 'Regex, Grand Expedition, Command Hotkeys + tab management',
    notes: [
      'Regex tab - waystone/tablet builder (real roll ranges, thresholds, exclusions), tablet subtype filter, seed-from-copied-item, saved regex buckets with 1-click copy, custom hand-written regexes',
      'Command Hotkeys (Settings → Hotkeys) - safe chat commands on a keypress, 17-command list + custom /command with args, only fires with the game focused',
      'Grand Expedition tab - rumor picker (type-to-pick + click), Aldur SPEND/SAVE verdict with normalized community scores (3-expedition minimum), logbook summary, copy-paste map-note tag that rebuilds the roster, prep guide with in-game tablet/waystone windows + trade links, rune chain tracker, run history',
      'Tab management - drag-to-reorder, ✕ to hide (Desecrate/Net Worth/Regex/Grand Expedition; Currency + Price Check permanent), visibility toggles in Settings incl. new Net Worth toggle',
      'Small stuff: Net Worth TOTAL icons sized up with icon mode; wording fixes ("currency tabs")',
    ],
  },
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
      "Net Worth tab - 1920 x or larger recommended. Use the Calibration button in Net Worth settings. Select any currency window frame, calibrate the window (auto snap works well) and you're done.",
      "F7 by default caps the current open tab in-game and adds it to the Net Worth tab.",
      "Supports: Currency Tab, Abyss, Ritual, Essence, All 5 Rune Subtabs, Delirium, Breach, and Expedition.",
      "Shows your total net worth in Div, with a Mirror conversion for richies.",
      'Can toggle "Duplicates allowed" in settings - allows people to register multiple duplicate tabs, for those of you who separate things into multiple instances of the same tabs.',
      "Toggle on or off any tab, and any row within the tab",
      "Edit the value if the parser got it worng.",
      "It's not perfect but it works pretty well. Some icons in particular are brutal and obfuscate the number. I'm done wasting time grinding parser values. It's relatively high accuracy and you can enable the toggle to show you the rating. Anything above 80% is usually good but it can sometimes make mistakes. You can edit in-line any value it gets wrong.",
      "I also updated support for various currency items like Raven's Reflection in pricing and currency tab(s).",
      "Enjoy!",
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
