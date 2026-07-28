// Grand Expedition data: canon islands (merged from the gnejs planner +
// Dracorath + community sheets, conflicts ruled by Drew 2026-07-27), verdict
// doctrine, prep guide (fubgun 0.5 strat, Drew-verified mechanics), rune
// tiers. Facts are game data; ratings are the ruled canon. Wording is law.
window.GrandExData = {
  islands: [
    {"rumor": "A Good Fellow", "type": "unique", "map": "Moment of Zen", "payoff": "Seer", "rating": "C", "notes": "Nameless seer is hiding a mageblood on that boat!", "hotkeyIndex": "$-0"},
    {"rumor": "All That Glitters", "type": "unique", "map": "Castaway", "payoff": "Gold", "rating": "A", "notes": "All of the Gold", "hotkeyIndex": 9},
    {"rumor": "Almost Paradise", "type": "unique", "map": "Untainted Paradise", "payoff": "Exp", "rating": "C", "notes": "Less XP than a City map", "hotkeyIndex": 7},
    {"rumor": "Fallen Stars", "type": "unique", "map": "Moor of Fallen Skies", "payoff": "Runestones (8-10)", "rating": "S+", "notes": "Unique Expedition Map with 9-10 Runes to unlock. Guarantees an Aldur saga - the ONE good unique map. Visions of Paradise runs it twice.", "hotkeyIndex": 0},
    {"rumor": "Reflective Waters", "type": "unique", "map": "The Fractured Lake", "payoff": "Ring Bases", "rating": "A", "notes": "The best PoE 1 league", "hotkeyIndex": 0},
    {"rumor": "Bleak And Awful", "type": "rumour", "map": "Bleached Shoals", "payoff": "Strongbox", "rating": "D", "notes": "Can Spawn untargetable enemies | Immortal and invisible enemies bug is supposed to be fixed in 0.5.4b", "hotkeyIndex": 0},
    {"rumor": "Cold As Ice", "type": "rumour", "map": "Frigid Bluffs", "payoff": "Old Expedition", "rating": "A+", "notes": "Juice the map HARD as its old style expedition mobs", "hotkeyIndex": 0},
    {"rumor": "Endless Cliffs", "type": "rumour", "map": "Craggy Peninsula", "payoff": "Rarity/Rogue Exiles", "rating": "A", "notes": "Good map should run - focus on juicing the rogue exiles", "hotkeyIndex": 0},
    {"rumor": "It's Dry At Least", "type": "rumour", "map": "Sloughed Gully", "payoff": "Monster effectivenss", "rating": "D", "notes": "Can Spawn untargetable enemies | Can spawn monsters from remnants on the cliffs where you can't target them and brick your map.(may have been fixed this patch still need to test)", "hotkeyIndex": 0},
    {"rumor": "Nothing To Drink", "type": "rumour", "map": "Stagnant Basin", "payoff": "Oil", "rating": "A", "notes": "Check Runes otherwise go for currency tiles", "hotkeyIndex": 0},
    {"rumor": "Something Fishy", "type": "rumour", "map": "Barren Atoll", "payoff": "Amulets", "rating": "B", "notes": "Source of All Res Pearl Ammys", "hotkeyIndex": 14},
    {"rumor": "Sulphite!", "type": "rumour", "map": "Scorched Cay", "payoff": "Increased Rarity", "rating": "A", "notes": "Good map - focus on juicing the remnants for the boss / good Runes", "hotkeyIndex": 4},
    {"rumor": "Unknown Ruins", "type": "rumour", "map": "Exhumed Ruins", "payoff": "Precursor Leylines", "rating": "B", "notes": "Can sometimes spawn in a bad location so only run if adjacent logbook zone is empty | Can spawn in bad spots where you can't spawn another logbook which seems to be why leylines aren't appearing sometimes", "hotkeyIndex": 0},
    {"rumor": "Warm But Risky", "type": "rumour", "map": "Grazed Prairie", "payoff": "Exp/Beyond/Hoards", "rating": "B", "notes": "Juice the map HARD as its old style expedition mobs | Less explosives has fucked both gully and praire would avoid for now", "hotkeyIndex": 3},
    {"rumor": "Wild, Roaming Free", "type": "rumour", "map": "Lush Isle", "payoff": "Azmeri Spirits", "rating": "B", "notes": "Can juice up a strong boss with wisps"},
    {"rumor": "Crazed Chieftain", "type": "boss", "map": "The Jade Isles", "payoff": "Powerful Map Boss", "rating": "S+", "notes": "Go get a Rakiatas Flow!", "hotkeyIndex": -1},
    {"rumor": "End Of The Circle", "type": "boss", "map": "Sprawling Jungle", "payoff": "Medved", "rating": "B", "hotkeyIndex": 2},
    {"rumor": "Origin Of The Fall", "type": "boss", "map": "Obscure Island", "payoff": "Olroth", "rating": "A", "notes": "Drops Triskellion / Flask", "hotkeyIndex": 0},
    {"rumor": "Stardrinker", "type": "boss", "map": "Secluded Temple", "payoff": "Uhtred", "rating": "A", "notes": "Drops the Drained Mana Rune!? | Can drop Depleted mana rune needed for Runeseeker's Call //Gnejs", "hotkeyIndex": 0},
    {"rumor": "The Last To Fall", "type": "boss", "map": "Mournful Cliffside", "payoff": "Vorana", "rating": "B"},
    {"rumor": "Aldurs", "type": "saga", "map": "NA", "payoff": "Buffs expeditions", "rating": "S+", "notes": "Can be a bit of a gamble on the seed"},
    {"rumor": "Medved", "type": "saga", "map": "Sprawling Jungle", "payoff": "Boss Node", "rating": "B+", "notes": "Guarantees the boss encounter"},
    {"rumor": "Olroth", "type": "saga", "map": "Obscure Island", "payoff": "Boss Node", "rating": "A", "notes": "Guarantees the boss encounter"},
    {"rumor": "Uhtred", "type": "saga", "map": "Secluded Temple", "payoff": "Boss Node", "rating": "B+", "notes": "Guarantees the boss encounter"},
    {"rumor": "Vorana", "type": "saga", "map": "Mournful Cliffside", "payoff": "Boss Node", "rating": "B+", "notes": "Guarantees the boss encounter"},
  ],
  // rating -> weight for the Aldur verdict engine (Drew: weighted sum, 3 = hard minimum)
  ratingWeight: { "S+": 6, "A+": 5, "A": 4, "B+": 3.5, "B": 3, "C": 2.5, "D": 2 },
  // Aldur's Saga buffs EXPEDITIONS: the call rides on the number and quality of
  // EXPEDITION slots. Unique maps / bosses occupy slots without adding Aldur
  // value, but they do NOT disqualify a logbook (6 rumors with 2 uniques still
  // gives 4 expeditions - Drew, 2026-07-27). Fallen Stars is an auto-take.
  doctrine: {
    minRumors: 3,        // fewer than 3 EXPEDITIONS: not enough content for an Aldur
    idealRumors: 4,      // fubgun: prime target
    spendScore: 12,      // expedition-only weighted sum >= this -> SPEND
    callScore: 9,        // between this and spendScore -> "your call"; below -> save the saga
    notes: [
      "Unique maps and bosses fill slots that aren't expeditions - they add no Aldur value, but they don't ruin the logbook.",
      "Bosses and unique maps are still worth running on their own merits; just don't count them toward the Aldur decision."
    ],
    fallenStarsAuto: "Fallen Stars guarantees an Aldur saga - always take it.",
    runeSlots: "5+ rune slots on the island = jackpot either way (can show 'contains A (8 rune slot)' - RNG)."
  },
  rotation: "The roster shows 3 rumors at a time. Rotate the window by picking any inventory item up and putting it down, or toggling a Saga. Rotate until repeats to see the island's full set.",
  runes: {
    tiers: { SS: ["Opulent"], S: ["Power", "Death", "Bond", "Oath"], A: ["Time", "Rebirth"] },
    notes: [
      "Runes do NOT stack - you want one of each.",
      "Opulent is THE rune - rush it; loot is substantially worse without it.",
      "Rebirth is the only blue rune above B tier. Other purples are B; other blues are C.",
      "Early expedition: collect good runes, 4-6 slots fine. End: prolif into 7+ rune combos for max loot.",
      "On all-5/6/7 maps reroll aggressively - the base can never be bad. Keep 7+ near the end; reroll 5s at the start without good purples.",
      "With an 8-9 rune end + Opulent you can end there without prolif.",
      "Keep rewards of 3+ Divines; 1-2 div only if the map is otherwise weak."
    ]
  },
  prep: {
    master: { name: "Jado", nodes: ["Unexpected Missions", "Eastern Knowledge", "Partial Translations", "Keen Appraisal"], alt: "Doryani viable; fubgun had more success with Jado." },
    tablets: {
      main: "3x Irradiated tablets: 'Map has 2 additional random map modifiers' + Monster effect OR increased number of Rares (Item Rarity ok but worse).",
      budget: "Cheaper alt: 2 of [increased Rares / Monster effect / Monster Rarity] - for non-Aldur saga maps.",
      links: [
        { label: "Cheap tablets x3", url: "https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur" },
        { label: "Mid tablets x3", url: "https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur/MdmaMKJMFJ" },
        { label: "Big tablets x3", url: "https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur/9zW9VLzyCK" }
      ]
    },
    waystones: "8-mod waystones, highest Monster effect (Monster Rarity good, Rarity ok, Pack Size bad). T15 is enough - area 81 still drops ilvl 82 exceptional bases. Budget: craft 70% effect 6-mod waystones and corrupt.",
    reminders: [
      "Swap to your Expedition atlas loadout BEFORE unveiling a logbook - its passives apply to the expedition's generation.",
      "Swap back to your mapping loadout when you're just opening regular maps.",
      "Item Rarity matters here - get as close to the cap as your gear allows."
    ]
  },
};
