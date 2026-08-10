const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, shell, Notification, protocol, desktopCapturer, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const focusNative = require('./focus-native'); // lazy inside - koffi binds on first use
const linuxFocus = require('./linux-focus'); // the Linux half: xdotool when present, else "can't tell"
// Stash net-worth reader runs in a worker (renderer/stash/reader-worker.js); main
// only does screen capture + pricing. See memory stash-networth-feature.

// ee2:// serves the vendored parser's data files (renderer/vendor/ee2/data) to the
// renderer, which fetch()es them at startup (file:// pages cannot fetch file:// URLs).
// Must be registered before app ready; the handler is installed in whenReady below.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ee2', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } }
]);

// Packaged builds get their own settings folder. Without this, Electron derives
// userData from package.json "name" and the installed app SHARES the dev copy's
// folder - dev test runs could clobber a real user's config.
if (app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'POE2 Currency Overlay'));
}

// EXPERIMENTAL Linux support: force the X11/XWayland Ozone backend. Native Wayland
// can't keep an always-on-top click-through overlay layered over a fullscreen game,
// and the uiohook input hook is X11-based - both work under XWayland. This bakes in
// the `--ozone-platform=x11` flag Linux users otherwise add by hand. Must run before
// app ready. Harmless on pure-X11 sessions (already x11).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
// appendSwitch above is NOT equivalent to the flag being on the real command line.
// Field evidence (GNOME 50 / Mutter, Wayland session): without the CLI flag the GPU
// process segfaults (exit_code=139) and EVERY globalShortcut registration fails with a
// bogus "taken by another app"; with it, all four register cleanly. A 2.5.3 attempt to
// re-exec from here (app.relaunch + app.exit) never fired - the app requests a single-
// instance lock further down, so the relaunched child races the dying parent for it.
// The flag now comes from build.linux.executableArgs instead, which electron-builder
// bakes into the AppImage's launcher, i.e. onto the real command line where it works.
// Electron pops an OS-modal error dialog for an unhandled rejection. On Linux the
// AppImage updater path throws asynchronously (field report: a GTK "JavaScript error"
// at launch on a build that then updated fine), leaving a stranger blocked behind a
// modal. Log it there instead. Windows keeps the dialog.
if (process.platform === 'linux') {
  process.on('unhandledRejection', (err) => {
    try {
      fs.appendFileSync(path.join(app.getPath('userData'), 'linux-errors.log'),
        `${new Date().toISOString()} unhandledRejection ${(err && err.stack) || err}
`);
    } catch {}
  });
}

const API_BASE = 'https://api.poe2scout.com';
const USER_AGENT = 'POE2-Price-Overlay/1.0 (https://github.com/POE2-VibeTools/poe2-currency-overlay)';
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'overlay-config.json');

// Item price-check: rate-limited PoE2 trade2 API client (main process).
const trade2 = require('./trade2');
// Currency pairs: GGG's public Currency Exchange CDN (executed trades, hourly).
const cxFeed = require('./cx-feed');
let cxState = { ok: false, at: 0, pairs: 0 };
// apiId -> { text, icon, category } for CX-market items (fragments, keys, etc.).
// Lets the item tab price CX-only items poe2scout doesn't index (Raven's
// Reflection and friends) and resolve their display name/icon by apiId.
const CX_CATALOG = require('./cx-catalog.json');

// ---------- live-service feed switchover ----------
// The repo's feed.json is the remote kill-switch: when its apiBase is set to a
// deployed Worker URL (and that Worker's /v1/health responds), every installed
// copy of the app silently switches its data source to the live feed.
const FEED_MANIFEST_URL =
  process.env.POE2_FEED_MANIFEST || // dev/test override
  'https://raw.githubusercontent.com/POE2-VibeTools/poe2-currency-overlay/master/feed.json';
const FEED_CHECK_MS = 15 * 60 * 1000; // on load + every 15 minutes
let liveFeed = null; // { base, upstream } when active

async function checkFeed() {
  const before = liveFeed ? liveFeed.base : null;
  try {
    const mRes = await fetch(`${FEED_MANIFEST_URL}?t=${Date.now()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000)
    });
    if (!mRes.ok) throw new Error(`manifest ${mRes.status}`);
    const manifest = await mRes.json();
    const okBase =
      manifest &&
      typeof manifest.apiBase === 'string' &&
      (/^https:\/\//.test(manifest.apiBase) ||
        /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(manifest.apiBase)); // http allowed for local testing only
    if (okBase) {
      const base = manifest.apiBase.replace(/\/$/, '');
      const hRes = await fetch(`${base}/v1/health`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10_000)
      });
      const health = hRes.ok ? await hRes.json() : null;
      liveFeed = health && health.ok ? { base, upstream: health.upstream || 'unknown' } : null;
    } else {
      liveFeed = null;
    }
  } catch {
    liveFeed = null; // manifest unreachable or worker down → public API fallback
  }
  const after = liveFeed ? liveFeed.base : null;
  if (before !== after) {
    // source changed - drop caches so the next refresh comes from the new feed
    leaguesCache = { at: 0, data: null };
    realmDefaultCache = { at: 0, league: null };
    categoriesCache = { at: 0, league: null, data: null };
    itemsCache.clear();
    pairsCache.clear();
    if (win && !win.isDestroyed()) win.webContents.send('feed-changed');
  }
}

// ---------- updates ----------
// Packaged app: electron-updater downloads the new installer in the background
// and applies it on one click ("Update & restart"). Dev builds, or any download
// failure, fall back to a manual notice that opens the download page.
const RELEASES_API =
  'https://api.github.com/repos/POE2-VibeTools/poe2-currency-overlay/releases/latest';
const DOWNLOAD_PAGE = 'https://poe2-vibetools.github.io/poe2-currency-overlay/';
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000; // on load + every 6 hours
let updateState = { status: 'idle', version: null }; // idle | downloading | ready | manual
let autoUpdaterRef = null;

function pushUpdateState() {
  if (win && !win.isDestroyed()) win.webContents.send('update-state', updateState);
}

function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// fallback: version notice only, button opens the download page
async function checkUpdateManual() {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) return;
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const mine = process.env.POE2_FAKE_VERSION || app.getVersion();
    if (latest && cmpVer(latest, mine) > 0 && updateState.status === 'idle') {
      updateState = { status: 'manual', version: latest };
      pushUpdateState();
    }
  } catch {} // offline or rate-limited: try again next interval
}

function initUpdates() {
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdaterRef = autoUpdater;
      autoUpdater.autoDownload = true;
      // MUST stay false: combined with our explicit quitAndInstall(), true makes
      // TWO installers race - the second one uninstalls what the first installed,
      // leaving the app missing entirely.
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.on('update-available', (info) => {
        updateState = { status: 'downloading', version: info.version };
        pushUpdateState();
      });
      autoUpdater.on('update-downloaded', (info) => {
        updateState = { status: 'ready', version: info.version };
        pushUpdateState();
      });
      autoUpdater.on('error', () => {
        if (updateState.status !== 'ready') {
          updateState = { status: 'idle', version: null };
          checkUpdateManual();
        }
      });
      const check = () => autoUpdater.checkForUpdates().catch(() => {});
      check();
      setInterval(check, UPDATE_CHECK_MS);
      return;
    } catch {} // electron-updater missing: fall through to manual
  }
  checkUpdateManual();
  setInterval(checkUpdateManual, UPDATE_CHECK_MS);
}

const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAe0lEQVR4nGO4VqfDQAnGJihyrU4n+lqdTu+1Op3lUNwLFRMhZIAzVMOPa3U6/9HwD6icMy4DQBIHsWhExweRDUF29nIiNMPwcph3YAZE43A2LvwDqgduQC8JmmG4F9kAUpyP7A3qGUCxFygORIqjkeKERJWkTJXMRDIGAMSIDttwwd2SAAAAAElFTkSuQmCC';

const DEFAULT_CONFIG = {
  hotkey: 'F6',
  league: 'auto',
  bounds: null,
  uiScale: 100,
  bgOpacity: 100, // overlay background opacity % (lower = more see-through); default fully opaque so the panel reads clearly out of the box
  defaultItems: [],
  autoAddDefaults: false,
  overrides: { enabled: false, rates: {}, ratesAt: {} }, // ratesAt: when each was pinned
  excludeExaltedArb: false, // Ange charges gold per unit; exclude exalted as a route middle
  currencyIcons: false, // show currency icons instead of names next to denominations/prices (dyslexia aid)
  dyslexicFont: false, // render the whole app in the bundled OpenDyslexic typeface (accessibility)
  // Live currency-rate polling, two independent rates. Each: 'quiet' (no auto poll) |
  // 'low' | 'medium' | 'high'. Tab = while the Currency tab is the visible view;
  // Bg = while the overlay is up but you're on another tab.
  currencyTabRate: 'medium',
  currencyBgRate: 'quiet',
  // Ctrl+F, not Ctrl+D: with WASD movement the game reads the physically-held D
  // through Raw Input (below anything an overlay can intercept) and walks the
  // character right, closing stash/vendor windows. F carries no movement.
  itemHotkey: 'Control+F', // hover an item in game, press this: copies + opens the Items tab; overlay STAYS
  itemHotkeyTemp: 'Control+Alt+F', // same check, but the overlay hides once the mouse visits it and leaves
  stashHotkey: 'F7', // view a currency tab in game, press this: reads + values it into the Net Worth tally
  gameWindowMatch: 'Path of Exile 2', // LINUX only: window title xdotool looks for (non-English clients)
  // Language for BOTH the app's own text and the item parser. 'auto' follows the OS
  // locale on first run; anything else is an explicit choice. The parser matters more
  // than the UI here: a Russian client's item text cannot be matched against the
  // English stat data at all, so a price check simply fails until this is right.
  uiLang: 'auto',
  // LINUX only, opt-in: let the price-check hotkey press Ctrl+C in the game for you via
  // xdotool. Off by default because on GNOME Wayland, Xwayland routes XTEST through
  // libei and the RemoteDesktop portal, so every press pops an "Allow Remote
  // Interaction" dialog. Off = copy the item yourself, then press the hotkey.
  linuxCopyViaXdotool: false,
  stashDupTabs: false, // Net Worth: re-capturing a tab type asks replace-which/add-new instead of just replacing
  stashSortLayout: false, // Net Worth: list a tab's items in stash reading order instead of by value
  stashShowMissing: false, // Net Worth: show empty/unread slots as editable x0 lines
  stashShowConfidence: false, // Net Worth: show the per-line OCR confidence %
  commandHotkeys: [], // Hotkeys settings: [{command:'/hideout', accelerator:'F8'}] - whitelist-only safe chat commands, one key = one manual command
  stashCalibration: null, // Net Worth: {x,y,w,h} panel box from one-time calibration; null = assume reference res
  itemQ20: true,       // search armour/weapons as if 20% quality
  itemFillRunes: true, // search as if empty rune sockets held Greater Iron Runes
  itemSliders: true,   // show per-mod range sliders in Price Check
  itemStatRange: 15,   // Price Check "stat range +/-%" - remembered between sessions
  itemIndexed: null,   // Price Check "Listed" window (trade_filters.indexed); null = any time
  itemHistory: [], // cached item price-check searches (capped, newest first)
  desecHistory: [], // Desecrate tab: items evaluated for Omen of Light rerolling
  regexBuckets: [{ id: 'default', name: 'My Regex', entries: [] }], // Regex tab: saved regexes in named buckets ({id,label,pattern} entries)
  grandexHistory: [], // Grand Expedition tab: saved runs [{ts, rumors:[names], score, verdict}] newest first
  showRegexTab: true,     // App Settings: show the Regex tab in the tab bar
  showGrandExTab: true,   // App Settings: show the Grand Expedition tab in the tab bar
  showNetWorthTab: true,  // App Settings: show the Net Worth tab in the tab bar (capture hotkey works regardless)
  showDesecrateTab: true, // App Settings: show the Desecrate tab (hidden, it still opens via redesecrate? and hides on leave)
  itemRanges: {},  // learned per-stat roll bounds from fetched listings (slider bounds)
  garbagePool: [], // user-curated worthless-mod stat ids (starts empty by design)
  tutorialDone: false,
  lastSeenVersion: null, // last app version whose "what's new" popup was shown+dismissed
  lastTab: 'currency',   // tab to reopen on (remembered across restarts): 'currency' | 'items' | 'desec' | 'networth' | 'regex' | 'grandex'
  // user's tab-bar order (drag to reorder). Unknown/missing keys fall back to
  // the built-in order, so adding a tab in a future version can't break it.
  tabOrder: ['currency', 'items', 'desec', 'networth', 'regex', 'grandex'],

  // fresh installs start empty: the first-run tutorial builds the Exalted bucket
  // hands-on; skipping the tutorial seeds the standard bucket instead (renderer)
  buckets: []
};

let win = null;
let tray = null;
let config = null;

// ---------- config ----------
function loadConfig() {
  const file = CONFIG_FILE();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    // a pre-existing config means this is NOT a first-time user: never ambush
    // them with the tutorial just because the flag didn't exist yet
    if (!('tutorialDone' in parsed)) merged.tutorialDone = true;
    // ONE-TIME migration of the old stock Ctrl+D binds to Ctrl+F (WASD:
    // raw-input D walks the character); custom binds - including a deliberate
    // re-bind BACK to Ctrl+D afterwards - are left alone
    if (!merged.hkDMigrated) {
      if (merged.itemHotkey === 'Control+D') merged.itemHotkey = 'Control+F';
      if (merged.itemHotkeyTemp === 'Control+Alt+D') merged.itemHotkeyTemp = 'Control+Alt+F';
      merged.hkDMigrated = true;
    }
    return merged;
  } catch {}
  // main file missing or corrupt - preserve the evidence, then try recovery paths
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.corrupt`);
  } catch {}
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(`${file}.backup`, 'utf8')) };
  } catch {}
  try {
    // migrate from the legacy shared folder used by packaged builds before 1.2.7
    const legacy = path.join(app.getPath('appData'), 'poe2-price-overlay', 'overlay-config.json');
    if (app.isPackaged && fs.existsSync(legacy)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(legacy, 'utf8')) };
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig() {
  // atomic: write tmp then rename, so a kill mid-save can never truncate the
  // real file; previous good copy is kept as .backup
  try {
    const file = CONFIG_FILE();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.backup`);
    } catch {}
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

// ---------- live rates from GGG's trade-site bulk exchange ----------
// Core pairs cycle at ONE request per 20s, and only while the overlay is
// visible; everything else is queried on-demand (user click). 429s trigger a
// cooldown honoring Retry-After. This keeps us a polite citizen of GGG's API.
const MAJOR_IDS = ['exalted', 'chaos', 'divine', 'annul'];
// Poll spacing per rate. QUIET = 0 = no auto poll (manual ⟳ only for that context).
// HIGH (12s) is the floor GGG's exchange budget allows (30 per 300s) without risking
// a throttle - the poll is limiter-routed regardless, so it can never exceed.
const LIVE_CADENCE_MS = { quiet: 0, low: 60_000, medium: 30_000, high: 12_000 };
const LIVE_HEARTBEAT_MS = 6_000; // heartbeat; each beat honors whichever rate applies now
const liveRates = new Map(); // 'have|want' -> { best, median, count, at }
let liveCycle = [];
let liveIdx = 0;

async function tradeExchangeQuery(have, want) {
  const league = await resolveLeague();
  // routed through trade2's self-configuring limiter (own policy bucket) - it waits
  // for a slot and honors server bans, so this poll can never exceed GGG's budget
  const d = await trade2.exchange(league, have, want);
  const vals = Array.isArray(d.result) ? d.result : Object.values(d.result || {});
  const rates = [];
  for (const v of vals) {
    const o = v && v.listing && v.listing.offers && v.listing.offers[0];
    if (o && o.exchange && o.item && o.exchange.amount > 0 && o.item.amount > 0) {
      rates.push(o.item.amount / o.exchange.amount); // want received per 1 have
    }
  }
  rates.sort((a, b) => b - a);
  // price-fixer filter: drop listings wildly off the median
  const med0 = rates[Math.floor(rates.length / 2)] || null;
  const clean = med0 ? rates.filter((r) => r <= med0 * 3 && r >= med0 / 3) : rates;
  return {
    best: clean[0] || null,
    median: clean[Math.floor(clean.length / 2)] || null,
    count: clean.length,
    at: Date.now()
  };
}

function pushLiveRates() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('live-rates', Object.fromEntries(liveRates));
  }
}

let liveTickBusy = false;
let lastLiveAt = 0;
// the cadence that applies right now: the Tab rate while the Currency tab is the
// visible view, otherwise the Background rate. 0 = quiet (no auto poll).
function liveCadenceNow() {
  const rate = currencyTabActive
    ? (config && config.currencyTabRate) || 'medium'
    : (config && config.currencyBgRate) || 'quiet';
  return LIVE_CADENCE_MS[rate] || 0;
}
async function liveTick(force) {
  if (!overlayShown) return; // never poll an invisible overlay
  const cad = liveCadenceNow();
  if (!cad) return; // quiet for this context - manual ⟳ only
  if (!force && Date.now() - lastLiveAt < cad - 500) return; // honor the spacing
  if (liveTickBusy) return; // the limiter may make a call wait; never stack ticks
  liveTickBusy = true;
  lastLiveAt = Date.now();
  try { await liveTickOnce(); } finally { liveTickBusy = false; }
}

async function liveTickOnce() {
  if (liveCycle.length === 0 || liveIdx % liveCycle.length === 0) {
    // rebuild each full pass: majors cross + every bucket row's pair, so the
    // rates the user is LOOKING AT track the live order book (what Ange shows)
    liveCycle.length = 0;
    const seen = new Set();
    const push = (have, want) => {
      const k = `${have}|${want}`;
      if (have !== want && !seen.has(k)) { seen.add(k); liveCycle.push({ have, want }); }
    };
    // MAJORS ONLY. The trade site's bulk exchange is a different market from
    // the in-game Currency Exchange, and outside the majors it is mostly bait:
    // measured on omen/exalt, 14 of 19 offers sat at or below 50ex against a
    // real ~67ex clearing price, several at 1ex. Deep pairs (ex/div/chaos/annul)
    // have enough genuine liquidity that the book tracks reality, and those are
    // the ones validated against Ange. Everything else prices off GGG's own
    // Currency Exchange data instead.
    for (const a of MAJOR_IDS) for (const b of MAJOR_IDS) push(a, b);
    liveIdx = 0;
  }
  const leg = liveCycle[liveIdx++ % liveCycle.length];
  try {
    liveRates.set(`${leg.have}|${leg.want}`, await tradeExchangeQuery(leg.have, leg.want));
    pushLiveRates();
  } catch {}
}

// ---------- API fetching (with small caches) ----------
async function apiGet(pathname) {
  // live feed serves the same paths under /scout/*; fall back to poe2scout direct
  const base = liveFeed ? `${liveFeed.base}/scout` : API_BASE;
  try {
    const res = await fetch(base + pathname, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`API ${res.status} on ${pathname}`);
    return await res.json();
  } catch (err) {
    if (liveFeed) {
      // live feed hiccup - retry against the public API rather than failing the user
      const res = await fetch(API_BASE + pathname, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`API ${res.status} on ${pathname}`);
      return res.json();
    }
    throw err;
  }
}

let leaguesCache = { at: 0, data: null };
async function getLeagues() {
  if (leaguesCache.data && Date.now() - leaguesCache.at < 60 * 60 * 1000) return leaguesCache.data;
  const data = await apiGet('/poe2/Leagues');
  leaguesCache = { at: Date.now(), data };
  return data;
}

let realmDefaultCache = { at: 0, league: null };
async function getDefaultLeague() {
  if (realmDefaultCache.league && Date.now() - realmDefaultCache.at < 60 * 60 * 1000) {
    return realmDefaultCache.league;
  }
  const realms = await apiGet('/Realms');
  const poe2 = realms.find((r) => r.GameApiId === 'poe2');
  const league = (poe2 && poe2.DefaultLeagueValue) || null;
  if (league) realmDefaultCache = { at: Date.now(), league };
  return league;
}

async function resolveLeague() {
  if (config.league && config.league !== 'auto') return config.league;
  // current softcore league first (IsCurrent, not "HC ..."), then any current, then realm default
  try {
    const leagues = await getLeagues();
    const current = leagues.filter((l) => l.IsCurrent);
    const softcore = current.find((l) => !/^HC /i.test(l.Value) && !/hardcore/i.test(l.Value));
    if (softcore) return softcore.Value;
    if (current.length > 0) return current[0].Value;
  } catch {}
  const def = await getDefaultLeague();
  if (def) return def;
  throw new Error('Could not determine current league');
}

let categoriesCache = { at: 0, league: null, data: null };
async function getCurrencyCategories(league) {
  if (
    categoriesCache.data &&
    categoriesCache.league === league &&
    Date.now() - categoriesCache.at < 60 * 60 * 1000
  ) {
    return categoriesCache.data;
  }
  const data = await apiGet(`/poe2/Leagues/${encodeURIComponent(league)}/Items/Categories`);
  const cats = data.CurrencyCategories.map((c) => ({ apiId: c.ApiId, label: c.Label }));
  categoriesCache = { at: Date.now(), league, data: cats };
  return cats;
}

// Per-category item cache: { key: { at, items } }, key = league + '|' + category
const itemsCache = new Map();
const ITEMS_TTL_MS = 45 * 1000;

async function getCategoryItems(league, category, force = false) {
  const key = `${league}|${category}`;
  const hit = itemsCache.get(key);
  if (!force && hit && Date.now() - hit.at < ITEMS_TTL_MS) return hit.items;
  const data = await apiGet(
    `/poe2/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?category=${encodeURIComponent(
      category
    )}&perPage=250&dataPoints=7`
  );
  const items = (data.Items || []).map((i) => ({
    apiId: i.ApiId,
    text: i.Text,
    icon: i.IconUrl,
    category: i.CategoryApiId,
    price: typeof i.CurrentPrice === 'number' ? i.CurrentPrice : null,
    logs: (i.PriceLogs || [])
      .filter((l) => l && typeof l.Price === 'number')
      .map((l) => ({ p: l.Price, t: l.Time, q: l.Quantity }))
      .sort((a, b) => new Date(a.t) - new Date(b.t))
  }));
  itemsCache.set(key, { at: Date.now(), items });
  return items;
}

// Direct pair snapshot (executed exchange trades, per pair). league -> {at, map}
const pairsCache = new Map();
async function getPairMap(league, force = false) {
  const hit = pairsCache.get(league);
  if (!force && hit && Date.now() - hit.at < ITEMS_TTL_MS) return hit.map;
  const data = await apiGet(`/poe2/Leagues/${encodeURIComponent(league)}/SnapshotPairs`);
  const map = {};
  for (const p of data) {
    const a = p.CurrencyOne.ApiId;
    const b = p.CurrencyTwo.ApiId;
    map[[a, b].sort().join('|')] = {
      [a]: p.CurrencyOneData.RelativePrice,
      [b]: p.CurrencyTwoData.RelativePrice,
      __vol: typeof p.Volume === 'number' ? p.Volume : 0
    };
  }
  pairsCache.set(league, { at: Date.now(), map });
  return map;
}

// Fetch prices for the categories the user's buckets reference.
async function fetchPrices(force) {
  const league = await resolveLeague();
  // majors always needed for arb-route math; ritual (omens) + abyss (bones)
  // price the Desecrate tab's consumables
  const cats = new Set(['currency', 'ritual', 'abyss']);
  for (const b of config.buckets) {
    cats.add(b.base.category);
    for (const it of b.items) cats.add(it.category);
  }
  const [pairResult, cxResult, ...results] = await Promise.allSettled([
    getPairMap(league, force),
    cxFeed.getCxPairMap(league),
    ...[...cats].map((c) => getCategoryItems(league, c, force))
  ]);
  const catalog = {};
  const errors = [];
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      for (const item of r.value) catalog[item.apiId] = item;
    } else {
      errors.push(`${[...cats][idx]}: ${r.reason.message}`);
    }
  });

  // Pair rates: GGG's official exchange digests are authoritative (real executed
  // trades); poe2scout SnapshotPairs fill any pair the CX map doesn't cover and
  // keep the app alive if the CDN is unreachable.
  const map = pairResult.status === 'fulfilled' ? pairResult.value : {};
  if (pairResult.status !== 'fulfilled') errors.push(`pairs: ${pairResult.reason.message}`);
  if (cxResult.status === 'fulfilled') {
    Object.assign(map, cxResult.value); // CX wins on shared keys
    cxState = { ok: true, at: Date.now(), pairs: Object.keys(cxResult.value).length };
  } else {
    cxState = { ok: false, at: Date.now(), pairs: 0 };
    errors.push(`ggg-exchange: ${cxResult.reason.message}`);
  }

  // ship pairs among: bucket bases + items + the 4 majors (needed for arb-route legs)
  const pairs = {};
  const interest = new Set(['exalted', 'chaos', 'divine', 'annul']);
  for (const b of config.buckets) {
    interest.add(b.base.apiId);
    for (const it of b.items) interest.add(it.apiId);
  }
  for (const key of Object.keys(map)) {
    const [a, b] = key.split('|');
    if (interest.has(a) && interest.has(b)) pairs[key] = map[key];
  }
  return { league, fetchedAt: Date.now(), catalog, pairs, errors, cx: cxState.ok };
}

// Full catalog for the currency picker (every tradeable category).
async function fetchFullCatalog() {
  const league = await resolveLeague();
  const cats = await getCurrencyCategories(league);
  const results = await Promise.allSettled(
    cats.map((c) => getCategoryItems(league, c.apiId))
  );
  const groups = [];
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      groups.push({ category: cats[idx].apiId, label: cats[idx].label, items: r.value });
    }
  });
  return { league, groups };
}

// ---------- CX-only pricing (currency-exchange feed, no poe2scout listing) ----------
// Some currency/fragment items (e.g. Raven's Reflection, the Delirium pinnacle
// key) trade only on GGG's Currency Exchange - poe2scout never lists them, so
// the item tab's catalog lookup misses. Value them straight off the CX pair
// map, mirroring the Net Worth stash valuation: a direct <id>|exalted pair when
// one exists, else one hop through chaos or divine.
let cxPairCache = new Map(); // league -> { at, map }
async function getCxPairMapCached(league, force) {
  const hit = cxPairCache.get(league);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.map;
  const map = await cxFeed.getCxPairMap(league);
  cxPairCache.set(league, { at: Date.now(), map });
  return map;
}
// units of b per 1 a from the crossed-volume pair map (see cx-feed.js)
function cxPairVal(map, a, b) {
  if (a === b) return 1;
  const e = map[[a, b].sort().join('|')];
  if (!e) return null;
  const v = e[a] / e[b];
  return Number.isFinite(v) && v > 0 ? v : null;
}
// Exalted value of one unit of `id`: direct, else one hop via divine or chaos.
function cxValueEx(map, id) {
  if (id === 'exalted') return 1;
  const direct = cxPairVal(map, id, 'exalted');
  if (direct != null) return direct;
  for (const mid of ['divine', 'chaos']) {
    const toMid = cxPairVal(map, id, mid);
    const midEx = cxPairVal(map, mid, 'exalted');
    if (toMid != null && midEx != null) return toMid * midEx;
  }
  return null;
}
// Resolve a display name (EE2 item name) to a CX apiId, once, case-insensitively.
let cxNameIndex = null;
function cxIdByName(name) {
  if (!name) return null;
  if (!cxNameIndex) {
    cxNameIndex = new Map();
    for (const [id, info] of Object.entries(CX_CATALOG)) {
      if (info && info.text) cxNameIndex.set(info.text.toLowerCase(), id);
    }
  }
  return cxNameIndex.get(String(name).toLowerCase()) || null;
}

// ---------- splash ----------
let splash = null;
function createSplash() {
  splash = new BrowserWindow({
    width: 280,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'), {
    query: { hotkey: (config && config.hotkey) || 'F6', version: app.getVersion() }
  });
  splash.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) splash.show();
  });
  // splash fades itself out at ~5.1s; close shortly after
  setTimeout(() => {
    try {
      if (splash && !splash.isDestroyed()) splash.close();
    } catch {}
    splash = null;
  }, 5700);
}

// ---------- window / hotkey ----------
function createWindow() {
  const bounds = config.bounds || {};
  win = new BrowserWindow({
    width: bounds.width || 560,
    height: bounds.height || 700,
    x: bounds.x,
    y: bounds.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    minWidth: 320,
    minHeight: 240,
    icon: path.join(__dirname, 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // keep the hidden window's renderer alive so showing it re-uses the last
      // painted frame instead of recompositing from scratch (kills flash-on-show)
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // renderer warnings/errors land in a file so UI bugs are diagnosable after the fact
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level < 2) return;
    try {
      fs.appendFileSync(
        path.join(app.getPath('userData'), 'renderer-errors.log'),
        `${new Date().toISOString()} [${level}] ${message} (${sourceId}:${line})\n`
      );
    } catch {}
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Bring the window up once, invisible and click-through. From here on it is
  // never hidden again - toggling only flips opacity (see showOverlay/hideOverlay).
  win.once('ready-to-show', () => {
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    win.showInactive();
    if (process.platform !== 'win32') win.hide(); // X11: opacity 0 is not hidden, so this is why it appeared unbidden
  });
  win.webContents.once('did-finish-load', () => {
    const scale = (config && config.uiScale) || 100;
    if (scale !== 100) win.webContents.setZoomFactor(scale / 100);
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    config.bounds = win.getBounds();
    saveConfig();
  };
  let boundsTimer = null;
  const debouncedSaveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 400);
  };
  win.on('moved', debouncedSaveBounds);
  win.on('resized', debouncedSaveBounds);
  win.on('closed', () => {
    win = null;
  });
}

// hotkey/focus diagnostics: silent unless POE2_OVERLAY_DEBUG is set, so user
// machines don't accumulate a toggle.log (the call sites stay - they document
// the failure points and light up instantly when debugging in the field)
const TOGGLE_DEBUG = !!process.env.POE2_OVERLAY_DEBUG;
function logToggle(source, note) {
  if (!TOGGLE_DEBUG) return;
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'toggle.log'),
      `${new Date().toISOString()} ${source} shown=${overlayShown} ${note}\n`
    );
  } catch {}
}

// The window is NEVER actually hidden - hiding and re-showing a transparent
// frameless window makes Windows recomposite it, which is the reopen flicker.
// Instead it stays alive at opacity 0 with clicks passing through, and "show"
// is just opacity 1: no recomposite, no repaint, no flicker.
let overlayShown = false;
// The live trade-exchange poll (liveTick) feeds ONLY the Currency tab's rate grid.
// It must not run while the user is on Price Check / Desecrate - those tabs read the
// cached poe2scout catalog, not this live order book. Polling a tab the user isn't
// looking at silently burned GGG's trade2 IP budget and got item searches rate-limited.
// Defaults FALSE: never poll until the renderer explicitly says the user opened the
// Currency tab (setActiveTab -> 'active-tab'). The app's default landing tab is
// Currency, but "shown by default" is NOT "the user is watching rates" - assuming so
// let the poll fire on startup and burned the API budget. Opening the tab flips this
// on (and kicks one immediate refresh); leaving it flips it off.
let currencyTabActive = false;

function showOverlay() {
  overlayShown = true; // state first - a throw below must not desync the toggle
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(false);
    // Esc is a renderer keydown, which needs keyboard focus - an X11 overlay shown
    // inactive never gets it, so Esc did nothing until the window was clicked. Bind it
    // globally for as long as the overlay is up, and hand it back on hide.
    if (process.platform !== 'win32') {
      try { globalShortcut.register('Escape', () => { if (overlayShown) hideOverlay(); }); } catch {}
    }
    if (!win.isVisible()) win.showInactive(); // guarantee an OS-level show if Windows dropped it
    win.setOpacity(1);
    win.webContents.send('overlay-shown');
  } catch (err) {
    logToggle('showOverlay', `ERROR ${err.message || err}`);
  }
}

function hideOverlay(toGame) {
  overlayShown = false;
  try {
    const wasFocused = win.isFocused();
    if (process.platform !== 'win32') { try { globalShortcut.unregister('Escape'); } catch {} }
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    if (process.platform !== 'win32') win.hide(); // window opacity needs a compositor honoring it; X11 ignores it" 
    logToggle('hideOverlay', `toGame=${!!toGame} wasFocused=${wasFocused}`);
    // Hand focus to the GAME - blur alone lets Windows pick the next window
    // (often the desktop), and the game then silently ignores the user's next
    // hotkey copy until they click it. We do this when we hold focus (user
    // clicked the hide button or pressed F6/Esc mid-interaction) OR when the
    // caller asks (toGame): the quick-check self-close only ever HOVERED the
    // overlay, so it isn't focused, but the whole point of that mode is to bounce
    // straight back to the game - the next Ctrl+Alt+F must copy without a click.
    if (toGame || wasFocused) {
      win.blur();
      focusGame();
    }
    if (peekWin && !peekWin.isDestroyed()) peekWin.hide();
  } catch (err) {
    logToggle('hideOverlay', `ERROR ${err.message || err}`);
  }
}

let lastFireAt = 0;
function toggleOverlay(source = 'hotkey') {
  if (!win) return;
  // Sliding-window debounce: EVERY fire (acted-on or not) resets the timer, so a
  // held key's auto-repeat stream (fires every ~30ms) collapses into exactly one
  // toggle no matter how long the key is held - while a deliberate re-press
  // (slower than 125ms) always lands.
  const now = Date.now();
  const sinceLast = now - lastFireAt;
  lastFireAt = now;
  if (sinceLast < 125) {
    logToggle(source, 'DEBOUNCED');
    return;
  }
  logToggle(source, 'toggle');
  if (overlayShown) hideOverlay();
  else showOverlay();
}

function registerHotkey(accelerator) {
  try {
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(accelerator, toggleOverlay);
    registerItemHotkey(); // unregisterAll wiped it; always restore alongside
    registerStashHotkey(); // ditto - restore the stash-capture hotkey
    registerCommandHotkeys(); // ditto - restore the chat-command binds
    if (!ok) throw new Error('register returned false');
    return true;
  } catch (err) {
    console.error(`Failed to register hotkey "${accelerator}":`, err.message);
    // fall back to previous / default so the app is never hotkey-less
    if (accelerator !== config.hotkey) {
      try {
        globalShortcut.register(config.hotkey, toggleOverlay);
      } catch {}
    }
    return false;
  }
}

// ---------- item price-check hotkey (default Ctrl+F; EE2-style) ----------
// Hover an item in game, press the hotkey: we synthesize Ctrl+C (PoE2 copies the
// full item text - mod tiers + roll ranges - on a plain Ctrl+C), wait for the
// clipboard, then pop the overlay on the Items tab with the item parsed and searched.
function registerItemHotkey() {
  if (!config) return;
  // two-hotkey behavior: pin = overlay stays until hidden; temp = overlay
  // hides itself once the mouse visits the app and leaves it
  const binds = [[config.itemHotkey, 'pin'], [config.itemHotkeyTemp, 'temp']];
  for (const [acc, mode] of binds) {
    if (!acc) continue;
    try {
      const ok = globalShortcut.register(acc, () => onItemHotkey(mode, acc));
      if (!ok) console.error(`Item hotkey "${acc}" is taken by another app`);
    } catch (err) {
      console.error(`Failed to register item hotkey "${acc}":`, err.message);
    }
  }
}

let itemHotkeyBusy = false;
let lastConsumedItemText = ''; // never re-serve a copy we already price-checked

// uiohook is a NATIVE addon: the first require() loads a .node binary from disk
// and can take hundreds of ms. That used to happen inside the hotkey handler,
// between clearing the clipboard and synthesizing the copy - long enough that
// the user had released Ctrl by the time the keys went out, so the game saw a
// bare Alt+C, no copy landed, and the tab opened on the search history. It only
// bit the FIRST press of a session, because the module is cached afterwards.
// Warmed once at startup instead, off the critical path.
let hookMod = null, hookTried = false;
function loadHook() {
  if (hookTried) return hookMod;
  hookTried = true;
  try { hookMod = require('uiohook-napi'); } catch (err) {
    hookMod = null;
    logToggle('item-hotkey', 'uiohook unavailable: ' + (err.message || err));
  }
  return hookMod;
}

// Which modifiers are ACTUALLY held right now. We used to infer this from the
// hotkey string ("Control+F contains Ctrl, so the user must be holding Ctrl")
// and synthesize only the rest. That inference is only true for the instant the
// shortcut fires: by the time the handler has loaded a native addon and blurred
// the overlay, the user has often let go, so the game received a bare Alt+C,
// no advanced copy landed, and the tab opened on the search history - needing a
// second or third press. Tracking the real state removes the guess entirely.
const heldMods = new Set();
let hookListening = false;
function startHookListener() {
  if (hookListening) return;
  const h = loadHook();
  if (!h) return;
  const { uIOhook, UiohookKey } = h;
  const nameOfKey = (kc) => {
    if (kc === UiohookKey.Ctrl || kc === UiohookKey.CtrlRight) return 'ctrl';
    if (kc === UiohookKey.Alt || kc === UiohookKey.AltRight) return 'alt';
    if (kc === UiohookKey.Shift || kc === UiohookKey.ShiftRight) return 'shift';
    return null;
  };
  try {
    uIOhook.on('keydown', (e) => { const n = nameOfKey(e.keycode); if (n) heldMods.add(n); });
    uIOhook.on('keyup', (e) => { const n = nameOfKey(e.keycode); if (n) heldMods.delete(n); });
    uIOhook.start();
    hookListening = true;
  } catch (err) {
    logToggle('item-hotkey', 'uiohook listener failed: ' + (err.message || err));
  }
}

// Bring the game window to the foreground. Native path first (focus-native.js):
// an in-process SetForegroundWindow on the game's cached HWND - the primitive
// EE2's focusTarget() uses. Windows only grants foreground changes to a process
// that holds focus or just received a registered hotkey - which is us on every
// call site here, and exactly what the old PowerShell AppActivate child (a
// background process, matching by window title) was not: it got refused or
// honored seconds late, stranding focus on the desktop after F6/Esc. PowerShell
// stays as the fallback when koffi can't load or no game window is found; the
// Promise signature is unchanged for the call sites.
function focusGame() {
  try {
    const t0 = Date.now();
    const r = focusNative.focus();
    logToggle('focusGame', `native ${r.detail} (${Date.now() - t0}ms)`);
    if (r.ok) return Promise.resolve();
  } catch (err) {
    logToggle('focusGame', `native ERROR ${(err && err.message) || err}`);
  }
  return new Promise((resolve) => {
    if (process.platform === 'linux') {
      // focus-native is Win32-only; on Linux xdotool raises the game when installed
      const ok = linuxFocus.focusGame(config.gameWindowMatch);
      logToggle('focusGame', `linux xdotool ${ok ? 'activated' : 'unavailable'}`);
      return resolve();
    }
    if (process.platform !== 'win32') return resolve(); // no powershell.exe, and focus-native is Win32-only
    try {
      const { exec } = require('child_process');
      exec(
        'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; if (-not $ws.AppActivate(\'Path of Exile 2\')) { [void]$ws.AppActivate(\'Path of Exile\') }"',
        { windowsHide: true, timeout: 3000 },
        () => resolve()
      );
    } catch { resolve(); }
  });
}

// true / false / null, whichever platform can answer. Win32 asks user32 in-process;
// Linux asks xdotool if it is installed; anything else can't tell.
function gameIsForeground() {
  const win = focusNative.foregroundIsGame();
  if (win !== null) return win;
  return linuxFocus.foregroundIsGame(config.gameWindowMatch);
}

// PoE2 localises the headers on a copied item, so testing only for the English ones
// throws away a translated client's item text: the copy DOES land, we fail to recognise
// it, retry, refocus, retry again and finally report the copy as failed - i.e. the price
// check hotkey looks dead for anyone not playing in English. These are the "Item Class:"
// and "Rarity:" strings for every language the vendored parser supports (see
// renderer/vendor/ee2/data/<lang>/client_strings.js).
const ITEM_TEXT_MARKERS = [
  'Item Class: ', 'Rarity: ',
  'Gegenstandsklasse: ', 'Seltenheit: ',
  'Класс предмета: ', 'Редкость: ',
  "Classe d'objet: ", 'Rareté: ',
  'Clase de objeto: ', 'Rareza: ',
  'Classe do Item: ', 'Raridade: ',
];
const looksLikeItemText = (t) => !!t && ITEM_TEXT_MARKERS.some((m) => t.includes(m));

async function onItemHotkey(mode = 'pin', acc = null) {
  if (itemHotkeyBusy) return;
  itemHotkeyBusy = true;
  logToggle('item-hotkey', `press mode=${mode} winFocused=${!!(win && win.isFocused())}`);
  const held = String(acc || config.itemHotkey || '');
  try {
    // The overlay never steals focus on its own - it shows inactive (showInactive),
    // so the game keeps focus through a normal Ctrl+F and you can chain checks
    // without clicking back in. It only holds focus when you deliberately CLICK it
    // to read results. In that one case, blur alone lets Windows pick the next
    // window (often the desktop), so hand focus explicitly to the GAME before we
    // synthesize the copy - otherwise it lands on us and does nothing.
    if (win && win.isFocused()) {
      win.blur();
      await focusGame();
      await new Promise((r) => setTimeout(r, 100));
    }
    const { clipboard } = require('electron');
    const before = clipboard.readText();
    let cleared = false;
    // force = ignore the tracked state and press BOTH modifiers. A global hook
    // can miss a keyup (the release landing in another app's focus), leaving a
    // modifier stuck "held" - which would make us skip pressing it and fail the
    // exact way this whole fix exists to prevent. The retry therefore trusts
    // nothing.
    const synthCopy = (force) => {
      try {
        const hook = loadHook(); // warmed at startup; see loadHook()
        if (!hook) return false;
        const { uIOhook, UiohookKey } = hook;
        // PoE2's item copy is plain Ctrl+C (no PoE1-style "advanced copy" -
        // confirmed in-game + EE2). Press Ctrl only if it isn't already down:
        // re-pressing one the user is holding desyncs the game's key state;
        // failing to press it when they've released means no copy at all - so
        // this reads the LIVE held state rather than guessing from the hotkey
        // string. Falls back to that inference if the listener never started.
        const knowHeld = hookListening && !force;
        const ctrlDown = force ? false
          : knowHeld ? heldMods.has('ctrl') : /Control|CommandOrControl|Ctrl/i.test(held);
        const mods = [];
        if (!ctrlDown) mods.push(UiohookKey.Ctrl);
        // Release the Ctrl we pressed on the NEXT event-loop tick, not in this
        // synchronous batch. keyTap already emits C-down/C-up; folding the Ctrl
        // release into the same batch can make the game read a truncated combo.
        // setTimeout(0) is a separate batch at ~1-4ms - under one game frame, so
        // the key never lingers long enough for the per-frame input poll to see
        // a stray modifier and fire a bound action.
        for (const k of mods) uIOhook.keyToggle(k, 'down');
        uIOhook.keyTap(UiohookKey.C);
        setTimeout(() => {
          try { for (const k of mods.slice().reverse()) uIOhook.keyToggle(k, 'up'); } catch {}
        }, 0);
        return true;
      } catch (err) {
        logToggle('item-hotkey', 'keystroke synthesis unavailable: ' + err.message);
        return false;
      }
    };
    const pollClip = async (tries) => {
      for (let i = 0; i < tries; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const t = clipboard.readText();
        if (looksLikeItemText(t)) return t;
      }
      return '';
    };
    let text = '';
    // Off Windows the copy is ATTEMPTED, then falls back. Awakened PoE Trade / EE2
    // synthesize on Linux too and it works on plenty of setups (they even carry a
    // Proton-10-specific clipboard bug, which only exists if the copy lands) - but on
    // a GNOME Wayland session libuiohook can't read the keyboard (XkbGetKeyboard
    // fails), posts mistranslated keycodes, and nothing arrives. So: try briefly,
    // then use whatever the user copied in game themselves.
    // The clipboard is seeded with a SENTINEL rather than emptied, per APT's two
    // Linux workarounds: KDE's "Prevent empty clipboard" blocks the empty write, and
    // Proton 10+ won't rewrite the clipboard when the content hasn't changed.
    if (process.platform !== 'win32') {
      const sentinel = `__POE2OVERLAY_EMPTY_${Date.now()}`;
      clipboard.writeText(sentinel);
      cleared = true;
      // xdotool first: it drives XTEST with a correct keymap, which is exactly what
      // libuiohook cannot do here. Then uiohook as a second chance for setups where
      // xdotool isn't installed but the hook works. Either way, fall through to the
      // clipboard the user filled themselves.
      const viaTool = config.linuxCopyViaXdotool ? linuxFocus.sendCopy() : false;
      if (viaTool) text = await pollClip(20); // ~500ms: xdotool + the game's own write
      if (!text && synthCopy()) text = await pollClip(12);
      logToggle('item-hotkey', text
        ? `copy OK via ${viaTool ? 'xdotool' : 'uiohook'} len=${text.length}`
        : `copy did not land (xdotool copy ${viaTool ? 'tried' : 'off/unavailable'}) - using existing clipboard`);
    }
    if (process.platform === 'win32') {
      clipboard.writeText(''); // so a successful copy is unambiguous
      cleared = true;
      if (synthCopy()) text = await pollClip(25);
      if (!text) {
        // nothing landed - the game may not actually hold keyboard focus even
        // though it looks active. Force it forward and try once more.
        logToggle('item-hotkey', 'copy empty; refocusing game for retry');
        await focusGame();
        await new Promise((r) => setTimeout(r, 150));
        if (synthCopy(true)) text = await pollClip(20); // force: press both modifiers
      }
      logToggle('item-hotkey', text ? `copy OK len=${text.length}` : 'copy FAILED after retry');
    }
    if (!text) {
      if (cleared && before) clipboard.writeText(before); // put their clipboard back
      // manual-workflow fallback (Ctrl+Alt+C then hotkey) - but never text we
      // already consumed, which would silently re-search the previous item
      if (looksLikeItemText(before) && before !== lastConsumedItemText) text = before;
    }
    if (!overlayShown) showOverlay();
    if (win) win.webContents.send('overlay-temp-mode', mode === 'temp');
    if (!text) {
      if (win) win.webContents.send('item-copy-failed');
      return;
    }
    lastConsumedItemText = text;
    if (win) win.webContents.send('item-copied', text);
  } finally {
    itemHotkeyBusy = false;
  }
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'app.ico'));
  if (icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_B64, 'base64'));
  }
  tray = new Tray(icon);
  tray.setToolTip(`POE2 Currency Overlay v${app.getVersion()} (${config.hotkey})`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide overlay', click: () => toggleOverlay('tray-menu') },
      {
        label: 'Check for updates',
        click: () => {
          showOverlay();
          if (autoUpdaterRef) autoUpdaterRef.checkForUpdates().catch(() => {});
          else checkUpdateManual();
        }
      },
      { type: 'separator' },
      { label: `Version ${app.getVersion()}`, enabled: false },
      { label: 'Quit', click: () => app.quit() }
    ])
  );
  tray.on('click', () => toggleOverlay('tray-click'));
}

// ---------- IPC ----------
ipcMain.handle('get-config', () => config);

ipcMain.handle('save-buckets', (_e, buckets) => {
  config.buckets = buckets;
  saveConfig();
  return true;
});

// The renderer needs its language BEFORE the first paint - an async config fetch would
// render English and then repaint. preload asks for this synchronously, so every module
// is already in the right language the moment it runs.
const UI_LANGS = ['en', 'ru', 'pt', 'de', 'fr', 'es'];
// 'qa' is the pseudo-locale used to test localisation (see scripts/i18n-pseudo.mjs). It
// is accepted ONLY with POE2_OVERLAY_DEBUG set, so a normal user can never end up stored
// on it - but without this the setting silently fell back to 'auto' and the reload put
// the tester straight back into English.
const allowedLangs = () => (process.env.POE2_OVERLAY_DEBUG ? UI_LANGS.concat('qa') : UI_LANGS);
function resolvedUiLang() {
  const want = (config && config.uiLang) || 'auto';
  if (want !== 'auto') return allowedLangs().includes(want) ? want : 'en';
  // 'auto' = follow the OS on first run. app.getLocale() gives e.g. "pt-BR", "de".
  const loc = String(app.getLocale() || 'en').toLowerCase();
  const base = loc.split('-')[0];
  return UI_LANGS.includes(base) ? base : 'en';
}
ipcMain.on('get-ui-lang', (e) => { e.returnValue = resolvedUiLang(); });

ipcMain.handle('set-language', (_e, code) => {
  const ok = ['auto'].concat(allowedLangs());
  config.uiLang = ok.includes(String(code)) ? String(code) : 'auto';
  saveConfig();
  return config.uiLang;
});

ipcMain.handle('set-tutorial-done', () => {
  config.tutorialDone = true;
  saveConfig();
  return true;
});

// remember the version whose "what's new" popup the user just dismissed, so it
// never fires again until the next update bumps app.getVersion() past this
ipcMain.handle('set-seen-version', (_e, version) => {
  config.lastSeenVersion = String(version || '');
  saveConfig();
  return true;
});

ipcMain.handle('set-overrides', (_e, overrides) => {
  const rates = {};
  if (overrides && overrides.rates) {
    for (const [k, v] of Object.entries(overrides.rates)) {
      if (/^[a-z-]+>[a-z-]+$/.test(k) && typeof v === 'number' && v > 0 && isFinite(v)) rates[k] = v;
    }
  }
  // when each rate was pinned - a rate you typed hours ago is as stale as the
  // feed, and the UI shows its age. Only keep stamps for surviving rates.
  const ratesAt = {};
  if (overrides && overrides.ratesAt) {
    for (const [k, v] of Object.entries(overrides.ratesAt)) {
      if (rates[k] !== undefined && typeof v === 'number' && v > 0 && isFinite(v)) ratesAt[k] = v;
    }
  }
  config.overrides = { enabled: !!(overrides && overrides.enabled), rates, ratesAt };
  saveConfig();
  return true;
});

ipcMain.handle('set-defaults', (_e, items, enabled) => {
  config.defaultItems = Array.isArray(items) ? items : [];
  config.autoAddDefaults = !!enabled;
  saveConfig();
  return true;
});

ipcMain.handle('set-league', (_e, league) => {
  config.league = league || 'auto';
  saveConfig();
  return true;
});

ipcMain.handle('set-hotkey', (_e, accelerator) => {
  const ok = registerHotkey(accelerator);
  if (ok) {
    config.hotkey = accelerator;
    saveConfig();
    if (tray) tray.setToolTip(`POE2 Currency Overlay v${app.getVersion()} (${config.hotkey})`);
  }
  return ok;
});

ipcMain.handle('set-item-hotkeys', (_e, { pin, temp }) => {
  const nextPin = pin || config.itemHotkey;
  const nextTemp = temp || config.itemHotkeyTemp;
  if (nextPin && nextTemp && nextPin === nextTemp) return false; // both binds must differ
  const prevPin = config.itemHotkey, prevTemp = config.itemHotkeyTemp;
  config.itemHotkey = nextPin;
  config.itemHotkeyTemp = nextTemp;
  // re-register everything (unregisterAll wipes the overlay hotkey too)
  const ok = registerHotkey(config.hotkey)
    && (!nextPin || globalShortcut.isRegistered(nextPin))
    && (!nextTemp || globalShortcut.isRegistered(nextTemp));
  if (!ok) { config.itemHotkey = prevPin; config.itemHotkeyTemp = prevTemp; registerHotkey(config.hotkey); return false; }
  saveConfig();
  return true;
});

ipcMain.handle('fetch-prices', async (_e, force) => {
  try {
    if (force) await checkFeed(); // manual refresh re-evaluates the data source too
    return await fetchPrices(!!force);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('get-feed-status', () => ({
  live: !!liveFeed,
  base: liveFeed ? liveFeed.base : null,
  upstream: liveFeed ? liveFeed.upstream : 'poe2scout (public)',
  cx: cxState.ok,
  cxPairs: cxState.pairs
}));

ipcMain.handle('fetch-catalog', async () => {
  try {
    return await fetchFullCatalog();
  } catch (err) {
    return { error: err.message };
  }
});

// CX catalog (apiId -> {text, icon, category}) so the item tab can recognise
// CX-only currency/fragments by name and route them to the exchange-value view.
ipcMain.handle('get-cx-catalog', () => CX_CATALOG);

// Exchange value (in Exalted) for a CX-market item poe2scout doesn't list.
// Accepts an apiId directly or a display name to resolve. Returns null when the
// item isn't a CX item or the feed can't price it.
ipcMain.handle('cx-item-price', async (_e, { apiId, name, league } = {}) => {
  try {
    const id = apiId || cxIdByName(name);
    if (!id) return null;
    const lg = league || await resolveLeague();
    const map = await getCxPairMapCached(lg);
    const ex = cxValueEx(map, id);
    if (ex == null) return null;
    const info = CX_CATALOG[id] || {};
    return { apiId: id, price: ex, text: info.text || name || id, icon: info.icon || null, source: 'cx' };
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
});

ipcMain.handle('list-leagues', async () => {
  try {
    const leagues = await getLeagues();
    return leagues
      .map((l) => ({ value: l.Value, isCurrent: !!l.IsCurrent }))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('get-update-state', () => updateState);

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('set-exclude-exalted-arb', (_e, on) => {
  config.excludeExaltedArb = !!on;
  saveConfig();
  return config.excludeExaltedArb;
});

ipcMain.handle('set-currency-icons', (_e, on) => {
  config.currencyIcons = !!on;
  saveConfig();
  return config.currencyIcons;
});

ipcMain.handle('set-dyslexic-font', (_e, on) => {
  config.dyslexicFont = !!on;
  saveConfig();
  return config.dyslexicFont;
});

ipcMain.handle('set-currency-rates', (_e, rates) => {
  const ok = (v, d) => (['quiet', 'low', 'medium', 'high'].includes(v) ? v : d);
  if (rates && rates.tab != null) config.currencyTabRate = ok(rates.tab, config.currencyTabRate || 'medium');
  if (rates && rates.bg != null) config.currencyBgRate = ok(rates.bg, config.currencyBgRate || 'quiet');
  saveConfig();
  lastLiveAt = 0; // let the new cadence take effect on the next heartbeat right away
  return { tab: config.currencyTabRate, bg: config.currencyBgRate };
});

ipcMain.handle('set-bg-opacity', (_e, v) => {
  const o = Math.min(100, Math.max(10, Number(v) || 92));
  config.bgOpacity = o;
  saveConfig();
  return o;
});

ipcMain.handle('set-ui-scale', (_e, v) => {
  const scale = Math.min(200, Math.max(50, Number(v) || 100));
  config.uiScale = scale;
  saveConfig();
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(scale / 100);
  return scale;
});

ipcMain.handle('get-live-rates', () => Object.fromEntries(liveRates));

// ---------- stash net-worth: capture a fixed-layout currency tab and value it ----------
// Screen capture (crisp; window/DirectX grabs are soft) -> desat-max flat-white
// filter -> read each static slot via the baked digit templates -> price via the
// live poe2scout catalog -> tab total. Empty/unreadable slots flag, never guess.
let stashPriceCache = null; // { at, map: apiId -> {price, icon, name} }
// A few currency-tab items trade on the Currency Exchange but aren't in poe2scout's
// catalog (e.g. Raven's Reflection = the Delirium pinnacle key). Price those off
// GGG's official CX feed instead, in Exalted like the rest of the map. apiId ->
// { name, icon }; icon is the official poecdn art from the vendored EE2 db (same
// source the Ctrl+F item lookup uses). Extend as new gaps surface.
const CX_FALLBACK = {
  'raven-s-reflection': {
    name: "Raven's Reflection",
    icon: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvTWFwcy9UYW5nYW1henVLZXkiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/64ddcf20c8/TangamazuKey.png',
  },
  'shattered-triskelion': {
    name: 'Shattered Triskelion',
    icon: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvUXVlc3RJdGVtcy9EYW1hZ2VkS2FsZ3V1cmFuVHJpc2tlbGxpb24iLCJ3IjoyLCJoIjoyLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/8dbe64dd12/DamagedKalguuranTriskellion.png',
  },
  'the-triskelion-reforged': {
    name: 'The Triskelion Reforged',
    icon: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvUXVlc3RJdGVtcy9LYWxndXVyYW5Ucmlza2VsbGlvbiIsInciOjIsImgiOjIsInNjYWxlIjoxLCJyZWFsbSI6InBvZTIifV0/911e9a6178/KalguuranTriskellion.png',
  },
};

async function getStashPriceMap(force) {
  if (!force && stashPriceCache && Date.now() - stashPriceCache.at < 5 * 60_000) return stashPriceCache.map;
  const full = await fetchFullCatalog();
  const map = {};
  for (const g of full.groups) for (const it of g.items) if (!map[it.apiId]) map[it.apiId] = { price: it.price, icon: it.icon, name: it.text };
  // Fill CX-only items poe2scout doesn't carry, valued in Exalted via a direct or
  // one-hop (chaos/divine) pair from the same official feed the currency tab uses.
  const needed = Object.keys(CX_FALLBACK).filter((id) => !(map[id] && typeof map[id].price === 'number'));
  if (needed.length) {
    try {
      const league = await resolveLeague();
      const cx = await cxFeed.getCxPairMap(league);
      const rate = (a, b) => { // executed units of b per 1 a, or null
        if (a === b) return 1;
        const pd = cx[[a, b].sort().join('|')];
        if (!pd || !(pd[a] > 0) || !(pd[b] > 0)) return null;
        return pd[a] / pd[b];
      };
      const valueEx = (id) => {
        const direct = rate(id, 'exalted');
        if (direct != null) return direct;
        for (const hop of ['chaos', 'divine']) {
          const r1 = rate(id, hop), r2 = rate(hop, 'exalted');
          if (r1 != null && r2 != null) return r1 * r2;
        }
        return null;
      };
      for (const id of needed) {
        const px = valueEx(id);
        if (px != null) map[id] = { price: px, icon: CX_FALLBACK[id].icon || null, name: CX_FALLBACK[id].name };
      }
    } catch { /* CX optional; the item just stays unpriced (flagged, never guessed) */ }
  }
  stashPriceCache = { at: Date.now(), map };
  return map;
}

// ---------- one screen frame, however this platform can produce one ----------
// Windows: desktopCapturer, unchanged.
// Linux: desktopCapturer cannot deliver on a Wayland session. The portal capturer
// needs a consent dialog nobody can reach behind a fullscreen game and never rejects
// when it gets nothing (Electron 43 removed that timeout), and forcing the legacy X11
// capturer returns a BLACK frame - both confirmed in the field. So the renderer
// captures with getDisplayMedia instead: one portal prompt per app run, the stream is
// kept alive, and each capture just grabs the current frame off it.
let frameWaiters = [];
ipcMain.on('stash-frame', (_e, payload) => {
  const waiting = frameWaiters;
  frameWaiters = [];
  waiting.forEach((fn) => fn(payload || null));
});
function requestRendererFrame(withDataUrl) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null);
    let done = false;
    const settle = (payload) => { if (done) return; done = true; resolve(payload); };
    frameWaiters.push(settle);
    // generous: the FIRST call may be sitting on the user's "Share this screen" dialog
    setTimeout(() => { frameWaiters = frameWaiters.filter((f) => f !== settle); settle(null); }, 30000);
    // userGesture=true is required: getDisplayMedia is gated on user activation, which
    // an IPC message or a global hotkey does not have.
    const call = `window.__poe2CaptureFrame && window.__poe2CaptureFrame(${JSON.stringify({ withDataUrl: !!withDataUrl })})`;
    win.webContents.executeJavaScript(call, true).catch(() => {
      try { win.webContents.send('stash-need-frame', { withDataUrl: !!withDataUrl }); } catch { settle(null); }
    });
  });
}
// Off Windows, open the screen-share stream while the overlay is still on screen:
// once it's veiled the renderer is throttled, and the portal dialog would be waiting
// behind a hidden window. No-op on Windows and once the stream is already up.
async function primeCapture() {
  if (process.platform === 'win32' || !win || win.isDestroyed()) return;
  try {
    await win.webContents.executeJavaScript('window.__poe2EnsureStream && window.__poe2EnsureStream()', true);
  } catch { /* the capture itself reports failure */ }
}

async function grabScreen(cw, ch, withDataUrl) {
  if (process.platform === 'win32') {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: cw, height: ch } });
    const src = sources.find((s) => s.id.startsWith('screen')) || sources[0];
    if (!src) return null;
    const img = src.thumbnail;
    const size = img.getSize();
    return { bitmap: img.toBitmap(), W: size.width, H: size.height, dataUrl: withDataUrl ? img.toDataURL() : null };
  }
  const f = await requestRendererFrame(withDataUrl);
  if (!f || !f.data || !f.w || !f.h) return null;
  // the renderer already swapped RGBA->BGRA to match nativeImage.toBitmap()
  return { bitmap: Buffer.from(f.data), W: f.w, H: f.h, dataUrl: f.dataUrl || null };
}

// Run the heavy stash OCR in a worker thread so the main event loop (hotkeys, IPC,
// window toggle) stays responsive. `onDetected(tab)` fires as soon as the worker
// knows which tab it is, before the full read finishes.
function runReaderWorker(bitmap, W, H, onDetected) {
  return new Promise((resolve) => {
    let w;
    try {
      const { Worker } = require('worker_threads');
      w = new Worker(path.join(__dirname, 'renderer', 'stash', 'reader-worker.js'));
    } catch (e) { return resolve({ ok: false, error: String(e && e.message || e) }); }
    const finish = (r) => { try { w.terminate(); } catch {} resolve(r); };
    w.on('message', (msg) => {
      if (msg && msg.phase === 'detected') { if (onDetected) onDetected(msg.tab); return; }
      finish(msg); // final payload (done / mismatch / error)
    });
    w.on('error', (e) => finish({ ok: false, error: String(e && e.message || e) }));
    const ab = bitmap.buffer.slice(bitmap.byteOffset, bitmap.byteOffset + bitmap.byteLength);
    w.postMessage({ bitmap: ab, W, H, calBox: config.stashCalibration || null }, [ab]); // transfer the ~8MB frame, no copy
  });
}

async function doStashCapture(onDetected) {
  // Hide the overlay during the grab so it doesn't occlude the panel it's reading
  // (the screen capture is the composited desktop). Restored in finally.
  const wasVisible = win && win.isVisible() && win.getOpacity() > 0;
  try {
    await primeCapture(); // before the veil - see primeCapture
    const disp = screen.getPrimaryDisplay();
    const cw = Math.round(disp.size.width * disp.scaleFactor);
    const ch = Math.round(disp.size.height * disp.scaleFactor);
    if (wasVisible) { win.setOpacity(0); if (process.platform !== 'win32') win.hide(); await new Promise((r) => setTimeout(r, 70)); }
    const shot = await grabScreen(cw, ch, false);
    if (wasVisible) { win.setOpacity(1); if (process.platform !== 'win32') win.showInactive(); }
    if (!shot) return { ok: false, error: 'no screen source' };
    const { bitmap, W, H } = shot;

    const res = await runReaderWorker(bitmap, W, H, onDetected);
    if (!res || !res.ok) return res || { ok: false, error: 'reader failed' };
    if (res.mismatch) return { ok: true, mismatch: true, autoFound: !!res.autoFound, readCount: res.readCount, slotCount: res.slotCount };

    let prices = {};
    try { prices = await getStashPriceMap(); } catch (err) { /* prices optional; counts still shown */ }
    const divPrice = prices.divine && typeof prices.divine.price === 'number' ? prices.divine.price : null;
    const mirrorPrice = prices.mirror && typeof prices.mirror.price === 'number' ? prices.mirror.price : null;

    const lines = []; const flags = []; let total = 0;
    res.reads.forEach((r, i) => {
      const info = prices[r.apiId] || {};
      const name = info.name || r.apiId;
      const price = typeof info.price === 'number' ? info.price : null;
      const icon = info.icon || null;
      // slot = read order = stash reading order (top-to-bottom, left-to-right)
      if (r.count == null) {
        // empty / unread slot: a 0-count line the UI shows (editable) only when
        // "Show missing" is on. flags kept for the read-count summary.
        flags.push({ apiId: r.apiId, name });
        lines.push({ apiId: r.apiId, name, icon, count: 0, price, valueEx: price != null ? 0 : null, slot: i, missing: true, conf: null });
        return;
      }
      const valueEx = price != null ? r.count * price : null;
      if (valueEx != null) total += valueEx;
      lines.push({ apiId: r.apiId, name, icon, count: r.count, price, valueEx, slot: i, conf: typeof r.conf === 'number' ? r.conf : null, rel: r.rel || null });
    });
    lines.sort((a, b) => (b.valueEx || 0) - (a.valueEx || 0));
    return {
      ok: true, tab: res.tab, w: W, h: H, readCount: res.readCount, slotCount: res.slotCount,
      totalEx: total, divPrice, mirrorPrice, totalDiv: divPrice ? total / divPrice : null, lines, flags, mismatch: false,
      autoFound: !!res.autoFound, // false = the panel finder came up empty, so manual calibration is worth offering
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    if (wasVisible && win && win.getOpacity() === 0) win.setOpacity(1); // never leave it hidden
    if (wasVisible && win && !win.isDestroyed() && process.platform !== 'win32' && !win.isVisible()) win.showInactive();
  }
}

// One capture, broadcasting staged progress to the Net Worth panel so it can show
// "Capturing…", then a placeholder row the instant the tab is detected, then fill.
let stashCaptureBusy = false;
async function captureAndBroadcast() {
  if (stashCaptureBusy) return;
  stashCaptureBusy = true;
  const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
  send('stash-capturing');
  try {
    const res = await doStashCapture((tab) => send('stash-detected', tab));
    send('stash-captured', res);
  } finally {
    stashCaptureBusy = false;
  }
}

ipcMain.on('stash-capture-start', () => captureAndBroadcast());
ipcMain.handle('set-stash-dup', (_e, on) => { config.stashDupTabs = !!on; saveConfig(); return true; });
ipcMain.handle('set-stash-sort', (_e, on) => { config.stashSortLayout = !!on; saveConfig(); return true; });
ipcMain.handle('set-stash-show-missing', (_e, on) => { config.stashShowMissing = !!on; saveConfig(); return true; });
ipcMain.handle('set-stash-show-confidence', (_e, on) => { config.stashShowConfidence = !!on; saveConfig(); return true; });
ipcMain.handle('set-stash-hotkey', (_e, accelerator) => {
  if (!accelerator) return false;
  const prev = config.stashHotkey;
  try { if (prev) globalShortcut.unregister(prev); } catch {}
  let ok = false;
  try { ok = globalShortcut.register(accelerator, () => captureAndBroadcast()); } catch {}
  if (!ok) { try { if (prev) globalShortcut.register(prev, () => captureAndBroadcast()); } catch {} return false; }
  config.stashHotkey = accelerator; saveConfig();
  return true;
});

// ---------- resolution calibration ----------
// The user aligns a box to the stash panel's COLORED outer bounding frame (an obvious,
// per-tab-coloured but fixed-size landmark). We convert that frame rect -> the internal
// content box (REF_BOX) the reader/detector work in. Measured in the 1920x1080 reference:
//   FRAME_BOX = the coloured border rect; REF_BOX = TT.box (the content region).
// At reference resolution frame->calBox reproduces REF_BOX exactly.
const REF_BOX = { x: 18, y: 168, w: 582, h: 606 };
const FRAME_BOX = { x: 13, y: 171, w: 594, h: 594 };
function frameToCalBox(f) {
  const sx = f.w / FRAME_BOX.w, sy = f.h / FRAME_BOX.h;
  return {
    x: Math.round(f.x + (REF_BOX.x - FRAME_BOX.x) * sx),
    y: Math.round(f.y + (REF_BOX.y - FRAME_BOX.y) * sy),
    w: Math.round(REF_BOX.w * sx), h: Math.round(REF_BOX.h * sy),
  };
}
function calBoxToFrame(c) {
  const sx = c.w / REF_BOX.w, sy = c.h / REF_BOX.h;
  return {
    x: Math.round(c.x - (REF_BOX.x - FRAME_BOX.x) * sx),
    y: Math.round(c.y - (REF_BOX.y - FRAME_BOX.y) * sy),
    w: Math.round(FRAME_BOX.w * sx), h: Math.round(FRAME_BOX.h * sy),
  };
}

// ---------- community stash-panel submissions ----------
// The Net Worth reader is tuned against ONE screenshot and misreads other machines'
// renderings (dev-docs/2.6.1-HANDOFF-RATIONALE.md). Fixing it needs a corpus of real
// captures from real setups, which is what this collects - opt-in, previewed, one panel
// crop at a time. Never captures anything without the user pressing the button.
const SAMPLE_ENDPOINT = 'https://poe2-overlay-api.dbatchell.workers.dev/v1/stash-sample';
let sampleShots = []; // { png:Buffer, meta:Object } - held in main until the user sends

// Capture the PoE2 CLIENT WINDOW only - never the desktop, never another app. Windows
// hands back a black frame for exclusive-fullscreen games, so the caller checks.
async function grabGameWindow(capW, capH) {
  const wanted = [config.gameWindowMatch, 'Path of Exile 2', 'Path of Exile'].filter(Boolean);
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: capW, height: capH } });
  let src = null;
  for (const title of wanted) { src = sources.find((s) => s.name === title); if (src) break; }
  if (!src) src = sources.find((s) => /path of exile/i.test(s.name || ''));
  if (!src || src.thumbnail.isEmpty()) return null;
  const size = src.thumbnail.getSize();
  if (!size.width || !size.height) return null;
  return { img: src.thumbnail, bitmap: src.thumbnail.toBitmap(), W: size.width, H: size.height, name: src.name };
}

// Exclusive fullscreen yields an all-black window grab. Sparse stride (prime, so it
// can't line up with any regular pattern in the frame) - we only need "is anything lit".
function frameLooksBlank(bitmap) {
  let lit = 0, n = 0;
  for (let i = 0; i + 2 < bitmap.length; i += 4 * 997) {
    n++;
    if (bitmap[i] > 12 || bitmap[i + 1] > 12 || bitmap[i + 2] > 12) lit++;
  }
  return n > 0 && lit / n < 0.01;
}

// Grab the game window, read it, and keep BOTH framings: the panel crop and the whole
// window. Which one is sent depends on whether the reader has positive evidence it
// actually located the panel - see `evidence` below - and the user can override it in
// the preview. Returns preview data URLs, never auto-sends.
async function captureStashSample() {
  const wasVisible = win && win.isVisible() && win.getOpacity() > 0;
  try {
    await primeCapture();
    const disp = screen.getPrimaryDisplay();
    const capW = Math.round(disp.size.width * disp.scaleFactor);
    const capH = Math.round(disp.size.height * disp.scaleFactor);
    if (wasVisible) { win.setOpacity(0); if (process.platform !== 'win32') win.hide(); await new Promise((r) => setTimeout(r, 70)); }
    const shot = await grabGameWindow(capW, capH);
    if (wasVisible) { win.setOpacity(1); if (process.platform !== 'win32') win.showInactive(); }
    if (!shot) return { ok: false, error: 'game-window-not-found' };
    if (frameLooksBlank(shot.bitmap)) return { ok: false, error: 'game-window-black' };

    // what our reader currently makes of it - the single most useful field in the sample
    let read = null, foundBox = null;
    try {
      const r = await runReaderWorker(Buffer.from(shot.bitmap), shot.W, shot.H, null);
      if (r && r.ok) {
        read = {
          tab: r.tab || null, score: r.score != null ? +r.score.toFixed(3) : null,
          mismatch: !!r.mismatch, readCount: r.readCount, slotCount: r.slotCount,
          boxSource: r.boxSource || null, panelCoverage: r.panelCoverage != null ? r.panelCoverage : null,
          autoFound: !!r.autoFound, box: r.box || null,
          reads: (r.reads || []).map((x) => ({ id: x.apiId, n: x.count, c: x.conf != null ? +x.conf.toFixed(2) : null })),
        };
        if (r.box) foundBox = r.box;
      }
    } catch { /* diagnostics are a bonus; the image is the point */ }

    // Always crop to wherever we think the panel is - detected box first, then the saved
    // calibration, then the scaled reference. Whether it actually caught the panel is a
    // question for the person looking at it, not something to infer from scores here.
    const fallbackBox = config.stashCalibration
      || (() => { const s = shot.W / 1920; return { x: REF_BOX.x * s, y: REF_BOX.y * s, w: REF_BOX.w * s, h: REF_BOX.h * s }; })();
    const boxN = foundBox || fallbackBox;
    const full = nativeImage.createFromBitmap(Buffer.from(shot.bitmap), { width: shot.W, height: shot.H });
    // a little margin so the panel's own border is in frame - that border is what the
    // finder keys on, so a sample that cuts it off can't explain a detection miss
    const M = 14;
    const cx = Math.max(0, Math.round(boxN.x) - M), cy = Math.max(0, Math.round(boxN.y) - M);
    const panel = full.crop({
      x: cx, y: cy,
      width: Math.min(Math.round(boxN.w) + M * 2, shot.W - cx),
      height: Math.min(Math.round(boxN.h) + M * 2, shot.H - cy),
    });

    const meta = {
      appVersion: app.getVersion(), platform: process.platform,
      screen: { w: capW, h: capH, scaleFactor: disp.scaleFactor },
      window: { w: shot.W, h: shot.H, name: shot.name },
      calibrated: !!config.stashCalibration,
      calBox: config.stashCalibration || null,
      read,
    };
    const shotRec = {
      fullPng: full.toPNG(),
      panelPng: panel.toPNG(),
      scope: 'panel', // the crop is always the default; the user swaps it if we missed
      meta,
    };
    sampleShots.push(shotRec);
    // previews are downscaled - the upload keeps full resolution, but a 4K window as a
    // data URL over IPC is tens of megabytes of string for no benefit
    const prev = (im) => im.resize({ width: Math.min(900, im.getSize().width), quality: 'good' }).toDataURL();
    return {
      ok: true, index: sampleShots.length - 1, scope: 'panel', meta,
      dataUrl: prev(panel), fullDataUrl: prev(full), panelDataUrl: prev(panel),
    };
  } catch (e) {
    if (wasVisible && win && !win.isDestroyed()) { win.setOpacity(1); }
    return { ok: false, error: String((e && e.message) || e) };
  }
}

ipcMain.handle('stash-sample-capture', async () => captureStashSample());
ipcMain.handle('stash-sample-reset', async () => { sampleShots = []; return { ok: true }; });
ipcMain.handle('stash-sample-drop', async (_e, i) => {
  if (i >= 0 && i < sampleShots.length) sampleShots.splice(i, 1);
  return { ok: true, count: sampleShots.length };
});
// A shot at 1080p+ is far bigger than the overlay, so an in-app lightbox would need the
// window blown up past the game to show one. It opens as its own resizable window at
// native size instead, on top of the overlay, and Chromium's own image view handles
// fit-to-window and click-to-zoom.
const samplePreviewWins = new Map();
ipcMain.handle('stash-sample-preview', async (_e, i) => {
  const s = sampleShots[i];
  if (!s) return { ok: false, error: 'no such shot' };
  try {
    const png = s.scope === 'panel' && s.panelPng ? s.panelPng : s.fullPng;
    // the filename IS the window title in Chromium's image view, so it names itself
    const dir = path.join(app.getPath('temp'), 'poe2-overlay-preview', String(i));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, s.scope === 'panel' ? 'stash-panel.png' : 'game-window.png');
    fs.writeFileSync(file, png);

    const old = samplePreviewWins.get(i);
    if (old && !old.isDestroyed()) old.destroy();

    const size = nativeImage.createFromBuffer(png).getSize();
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const pw = new BrowserWindow({
      width: Math.max(320, Math.min(size.width, Math.round(wa.width * 0.9))),
      height: Math.max(240, Math.min(size.height, Math.round(wa.height * 0.9))),
      resizable: true, autoHideMenuBar: true, backgroundColor: '#101010',
      alwaysOnTop: true, // the overlay itself is always-on-top; without this it hides behind
    });
    pw.loadURL(require('url').pathToFileURL(file).href);
    pw.once('ready-to-show', () => pw.show());
    pw.on('closed', () => {
      samplePreviewWins.delete(i);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ }
    });
    samplePreviewWins.set(i, pw);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// The finder can lock onto a border that is not the stash, and nothing in here can tell.
// The person looking at the preview can, so they get to switch a shot to the whole
// window (or back) before sending. Only 'panel' -> 'window' is always available; the
// reverse needs a crop to exist.
ipcMain.handle('stash-sample-scope', async (_e, i, scope) => {
  const s = sampleShots[i];
  if (!s) return { ok: false, error: 'no such shot' };
  if (scope === 'panel' && !s.panelPng) return { ok: false, error: 'no panel crop for this shot' };
  s.scope = scope === 'panel' ? 'panel' : 'window';
  return { ok: true, scope: s.scope };
});
// Sends only what the user previewed and confirmed. One request per image.
ipcMain.handle('stash-sample-send', async (_e, payload) => {
  if (!sampleShots.length) return { ok: false, error: 'nothing to send' };
  const note = String((payload && payload.note) || '').slice(0, 500);
  const sent = [];
  for (let i = 0; i < sampleShots.length; i++) {
    const s = sampleShots[i];
    try {
      const png = s.scope === 'panel' && s.panelPng ? s.panelPng : s.fullPng;
      const fd = new FormData();
      fd.append('image', new Blob([png], { type: 'image/png' }), s.scope === 'panel' ? 'panel.png' : 'window.png');
      fd.append('meta', JSON.stringify(Object.assign({}, s.meta, { scope: s.scope, note, of: sampleShots.length, i })));
      const r = await fetch(SAMPLE_ENDPOINT, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: j.error || `upload failed (${r.status})`, sent: sent.length };
      sent.push(j.id);
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), sent: sent.length };
    }
  }
  sampleShots = [];
  return { ok: true, sent: sent.length };
});

// Frameless windows have no OS border to drag, so the overlay could not be resized at
// all - a 1440p+ user could scale the UI but the window stayed the same small square.
// The renderer drags a corner grip and sends deltas; clamping lives here because only
// main knows the work area.
ipcMain.on('resize-window-by', (_e, d) => {
  if (!win || win.isDestroyed() || !d) return;
  try {
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workAreaSize;
    const width = Math.max(320, Math.min(Math.round(b.width + (d.dx || 0)), wa.width));
    const height = Math.max(240, Math.min(Math.round(b.height + (d.dy || 0)), wa.height));
    win.setBounds({ x: b.x, y: b.y, width, height });
  } catch { /* a bad delta must never take the window down */ }
});

let calibWin = null;
let calibCap = null; // { buf, W, H } kept for auto-snap border detection
function closeCalibWin() { try { if (calibWin && !calibWin.isDestroyed()) calibWin.close(); } catch {} calibWin = null; calibCap = null; }
// Snap a rough frame rect (capture px) onto the panel's coloured border: for each edge,
// find the strongest saturated-colour line within a search margin of where the user left it.
function snapFrameToBorder(f) {
  if (!calibCap) return f;
  const { buf, W, H } = calibCap;
  const isEdge = (x, y) => {
    const i = (y * W + x) * 4; const bl = buf[i], g = buf[i + 1], r = buf[i + 2];
    return (Math.max(r, g, bl) - Math.min(r, g, bl)) > 30 && Math.max(r, g, bl) > 55;
  };
  const m = Math.round(Math.max(10, f.w * 0.06)); // search margin around each edge
  const y0 = Math.max(0, Math.round(f.y + f.h * 0.15)), y1 = Math.min(H - 1, Math.round(f.y + f.h * 0.85));
  const x0 = Math.max(0, Math.round(f.x + f.w * 0.15)), x1 = Math.min(W - 1, Math.round(f.x + f.w * 0.85));
  // Snap to the strong coloured line CLOSEST to where the user placed the edge - not the
  // strongest in range. The panel border and the (brighter) tab-row dividers are both
  // strong lines; picking nearest-to-placement lets the user's rough drop disambiguate.
  const colCov = (x) => { let s = 0; for (let y = y0; y <= y1; y++) if (isEdge(x, y)) s++; return s / Math.max(1, y1 - y0); };
  const rowCov = (y) => { let s = 0; for (let x = x0; x <= x1; x++) if (isEdge(x, y)) s++; return s / Math.max(1, x1 - x0); };
  const nearestStrong = (cov, target, a, b) => {
    let pick = null, pickD = Infinity, fbBest = -1, fb = null;
    for (let v = Math.max(0, a); v <= b; v++) {
      const c = cov(v);
      if (c > fbBest) { fbBest = c; fb = v; }
      if (c >= 0.55) { const d = Math.abs(v - target); if (d < pickD) { pickD = d; pick = v; } }
    }
    return pick != null ? pick : (fbBest > 0.3 ? fb : null);
  };
  const L = nearestStrong(colCov, f.x, f.x - m, f.x + m), R = nearestStrong(colCov, f.x + f.w, f.x + f.w - m, f.x + f.w + m);
  const T = nearestStrong(rowCov, f.y, f.y - m, f.y + m), B = nearestStrong(rowCov, f.y + f.h, f.y + f.h - m, f.y + f.h + m);
  const nx = L != null ? L : f.x, ny = T != null ? T : f.y;
  return { x: nx, y: ny, w: (R != null ? R : f.x + f.w) - nx, h: (B != null ? B : f.y + f.h) - ny };
}
ipcMain.on('stash-calibrate-start', async () => {
  try {
    if (calibWin && !calibWin.isDestroyed()) { calibWin.focus(); return; }
    await primeCapture(); // before the veil - see primeCapture
    const disp = screen.getPrimaryDisplay();
    const capW = Math.round(disp.size.width * disp.scaleFactor);
    const capH = Math.round(disp.size.height * disp.scaleFactor);
    // grab the desktop without the overlay in it
    const wasVisible = win && win.isVisible() && win.getOpacity() > 0;
    if (wasVisible) { win.setOpacity(0); if (process.platform !== 'win32') win.hide(); await new Promise((r) => setTimeout(r, 70)); }
    const shot = await grabScreen(capW, capH, true);
    if (wasVisible) { win.setOpacity(1); if (process.platform !== 'win32') win.showInactive(); }
    if (!shot || !shot.dataUrl) return;
    calibCap = { buf: shot.bitmap, W: shot.W, H: shot.H };
    const dataUrl = shot.dataUrl;
    // seed the box at the previous frame, else FRAME_BOX scaled to this capture
    let seed;
    if (config.stashCalibration) seed = calBoxToFrame(config.stashCalibration);
    else { const s = capW / 1920; seed = { x: Math.round(FRAME_BOX.x * s), y: Math.round(FRAME_BOX.y * s), w: Math.round(FRAME_BOX.w * s), h: Math.round(FRAME_BOX.h * s) }; }
    calibWin = new BrowserWindow({
      x: disp.bounds.x, y: disp.bounds.y, width: disp.size.width, height: disp.size.height,
      frame: false, transparent: false, resizable: false, movable: false, skipTaskbar: true,
      fullscreenable: true, backgroundColor: '#000000',
      webPreferences: { preload: path.join(__dirname, 'renderer', 'stash', 'calibrate-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    calibWin.setAlwaysOnTop(true, 'screen-saver');
    calibWin.on('closed', () => { calibWin = null; });
    calibWin.loadFile(path.join(__dirname, 'renderer', 'stash', 'calibrate.html'));
    calibWin.webContents.once('did-finish-load', () => {
      try { calibWin.webContents.send('calib-init', { dataUrl, capW, capH, seedBox: seed }); } catch {}
    });
  } catch (err) { console.error('calibrate-start failed:', err.message); }
});
ipcMain.on('stash-calibrate-cancel', () => closeCalibWin());
ipcMain.on('stash-calibrate-snap', (_e, frame) => {
  try {
    if (!calibWin || calibWin.isDestroyed() || !frame) return;
    const snapped = snapFrameToBorder(frame);
    calibWin.webContents.send('calib-snapped', snapped);
  } catch (err) { console.error('calibrate-snap failed:', err.message); }
});
ipcMain.on('stash-calibrate-confirm', async (_e, frame) => {
  try {
    if (!frame || !(frame.w > 0) || !(frame.h > 0)) return closeCalibWin();
    config.stashCalibration = frameToCalBox(frame);
    saveConfig();
    closeCalibWin();
    // how big the calibrated panel is vs the reference - below ~1 the digits shrink
    // and reads get unreliable (surfaced as a warning in the UI).
    const calScale = config.stashCalibration.h / REF_BOX.h;
    // immediately test-scan the open tab so the user gets pass/fail feedback
    const res = await doStashCapture(() => {});
    const send = (ch, p) => { if (win && !win.isDestroyed()) win.webContents.send(ch, p); };
    send('stash-calibrated', Object.assign({ calScale }, res));
  } catch (err) { console.error('calibrate-confirm failed:', err.message); }
});
ipcMain.handle('clear-stash-calibration', () => { config.stashCalibration = null; saveConfig(); return true; });

// Global capture hotkey: view a currency tab in game, press it; the app detects the
// tab, values it, and updates its row in the Net Worth tally. Works whether or not
// the overlay is showing.
function registerStashHotkey() {
  if (!config || !config.stashHotkey) return;
  try {
    const ok = globalShortcut.register(config.stashHotkey, () => captureAndBroadcast());
    if (!ok) console.error(`Stash hotkey "${config.stashHotkey}" is taken by another app`);
  } catch (err) {
    console.error(`Failed to register stash hotkey "${config.stashHotkey}":`, err.message);
  }
}

// ---------- command hotkeys (safe chat commands) ----------
// One key = one manually-triggered chat command from a fixed whitelist - the
// 1:1 press-to-action shape GGG's macro rules allow. Nothing here automates,
// chains, or reacts; the player presses, the game gets exactly one command.
// Curated dropdown list: standalone (no arguments) + non-destructive.
const SAFE_COMMANDS = [
  '/hideout', '/guild', '/leave', '/exit', '/remaining', '/itemlevel',
  '/afk', '/dnd', '/reset_xp', '/played', '/age', '/deaths', '/kills',
  '/ladder', '/bug', '/nochat', '/clear',
];
// Custom commands are allowed too (argument commands like "/itemfilter Strict",
// new patch commands) with two fences: must be a single-line /command, and the
// command itself can't be a foot-gun. The app isn't the rules police - any 1:1
// press-to-command bind is GGG-legal - the fence exists so a mis-press can't
// destroy items or wipe unrecoverable state.
const DENY_COMMANDS = ['/destroy', '/clear_ignore_list'];
function isAllowedCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  const c = cmd.trim();
  if (!c.startsWith('/') || c.length < 2 || c.length > 100 || /[\r\n]/.test(c)) return false;
  return !DENY_COMMANDS.includes(c.split(/\s+/)[0].toLowerCase());
}
let cmdHotkeyBusy = false;
async function sendChatCommand(cmd) {
  if (!isAllowedCommand(cmd) || cmdHotkeyBusy) return;
  cmd = cmd.trim();
  cmdHotkeyBusy = true;
  try {
    // Never type into whatever else holds focus (Discord, a browser): the game
    // must already be the foreground window, otherwise the press is a no-op.
    // foregroundIsGame() is tri-state: true / false / null = nothing can tell here.
    // `!null` is true, so a plain negation made every Linux press a no-op.
    const fg = gameIsForeground();
    if (fg === false) {
      logToggle('cmd-hotkey', `${cmd}: game not foreground - ignored`);
      return;
    }
    if (fg === null) logToggle('cmd-hotkey', `${cmd}: no focus detection on this platform - sending anyway`);
    const hook = loadHook();
    if (!hook) { logToggle('cmd-hotkey', 'uiohook unavailable'); return; }
    const { uIOhook, UiohookKey } = hook;
    const { clipboard } = require('electron');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // Paste, don't type: layout-proof and one atomic insert. Clipboard is
    // restored afterwards. Timing follows the item-copy doctrine: modifier
    // release on a separate event-loop batch, small waits between game inputs
    // so the per-frame input poll sees each step (see synthCopy).
    const before = clipboard.readText();
    clipboard.writeText(cmd);
    uIOhook.keyTap(UiohookKey.Enter); // open chat
    await wait(80);
    uIOhook.keyToggle(UiohookKey.Ctrl, 'down');
    uIOhook.keyTap(UiohookKey.V); // paste the command
    await wait(1); // separate batch for the release
    uIOhook.keyToggle(UiohookKey.Ctrl, 'up');
    await wait(80);
    uIOhook.keyTap(UiohookKey.Enter); // send
    await wait(120);
    clipboard.writeText(before);
    logToggle('cmd-hotkey', `${cmd} sent`);
  } catch (err) {
    logToggle('cmd-hotkey', `${cmd} ERROR ${(err && err.message) || err}`);
  } finally {
    cmdHotkeyBusy = false;
  }
}

function registerCommandHotkeys() {
  if (!config || !Array.isArray(config.commandHotkeys)) return;
  for (const row of config.commandHotkeys) {
    if (!row || !row.accelerator || !isAllowedCommand(row.command)) continue;
    try {
      const ok = globalShortcut.register(row.accelerator, () => sendChatCommand(row.command));
      if (!ok) console.error(`Command hotkey "${row.accelerator}" is taken by another app`);
    } catch (err) {
      console.error(`Failed to register command hotkey "${row.accelerator}":`, err.message);
    }
  }
}

ipcMain.handle('get-safe-commands', () => ({ commands: SAFE_COMMANDS.slice(), denied: DENY_COMMANDS.slice() }));
ipcMain.handle('set-command-hotkeys', (_e, rows) => {
  // the fences are enforced HERE, not in the renderer - rows failing them
  // are dropped, empty accelerators kept (row bound later)
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && isAllowedCommand(r.command))
    .map((r) => ({ command: r.command.trim(), accelerator: typeof r.accelerator === 'string' ? r.accelerator : '' }));
  for (const r of config.commandHotkeys || []) {
    if (r && r.accelerator) { try { globalShortcut.unregister(r.accelerator); } catch {} }
  }
  config.commandHotkeys = clean;
  saveConfig();
  registerCommandHotkeys();
  return true;
});

// ---------- item price-check (trade2) ----------
ipcMain.handle('read-clipboard', () => {
  try { return require('electron').clipboard.readText(); } catch { return ''; }
});
ipcMain.handle('write-clipboard', (_e, text) => {
  try { require('electron').clipboard.writeText(String(text || '')); return true; } catch { return false; }
});
ipcMain.handle('set-item-history', (_e, history) => {
  config.itemHistory = Array.isArray(history) ? history.slice(0, 100) : [];
  saveConfig();
  return true;
});
ipcMain.handle('set-desec-history', (_e, history) => {
  config.desecHistory = Array.isArray(history) ? history.slice(0, 100) : [];
  saveConfig();
  return true;
});
ipcMain.handle('set-regex-buckets', (_e, buckets) => {
  config.regexBuckets = Array.isArray(buckets) ? buckets : [];
  saveConfig();
  return true;
});
ipcMain.handle('set-grandex-history', (_e, history) => {
  config.grandexHistory = Array.isArray(history) ? history.slice(0, 200) : [];
  saveConfig();
  return true;
});
ipcMain.handle('set-tab-order', (_e, order) => {
  config.tabOrder = Array.isArray(order) ? order.filter((k) => typeof k === 'string') : [];
  saveConfig();
  return true;
});
// Optional-tab visibility toggles (App Settings, and the tab's own ✕)
ipcMain.handle('set-tab-shown', (_e, which, shown) => {
  if (which === 'regex') config.showRegexTab = !!shown;
  else if (which === 'grandex') config.showGrandExTab = !!shown;
  else if (which === 'networth') config.showNetWorthTab = !!shown;
  else if (which === 'desec') config.showDesecrateTab = !!shown;
  else return false;
  saveConfig();
  return true;
});
// ---------- item listing peek (floating card OUTSIDE the overlay, to its left) ----------
let peekWin = null;
function ensurePeekWin() {
  if (peekWin && !peekWin.isDestroyed()) return peekWin;
  peekWin = new BrowserWindow({
    width: 360, height: 200, show: false, frame: false, transparent: true,
    resizable: false, movable: false, focusable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'item', 'peek-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  peekWin.setAlwaysOnTop(true, 'screen-saver');
  peekWin.setIgnoreMouseEvents(true); // hover stays with the results list
  peekWin.loadFile(path.join(__dirname, 'renderer', 'item', 'peek.html'));
  return peekWin;
}
let peekAnchorY = 0;
let peekPendingShow = false; // defer a fresh peek's reveal until peek-height has sized it (no scrollbar-flash / resize snap)
// The comparison card sits to the LEFT of the overlay, which has nowhere to go when the
// overlay is against the left edge of the screen - it used to clamp to x=0 and sit under
// the overlay. Fall back to the right side, and only clamp inside the work area when
// neither side fits. Work-area coords, not 0: a left-hand second monitor has negative x.
const PEEK_W = 360, PEEK_GAP = 10;
function peekX(b) {
  const disp = screen.getDisplayMatching(b).workArea;
  const left = b.x - PEEK_W - PEEK_GAP;
  if (left >= disp.x) return left;
  const right = b.x + b.width + PEEK_GAP;
  if (right + PEEK_W <= disp.x + disp.width) return right;
  return Math.max(disp.x, Math.min(left, disp.x + disp.width - PEEK_W));
}

ipcMain.on('item-peek-show', (_e, { html, frac }) => {
  try {
    if (!win) return;
    const pw = ensurePeekWin();
    const b = win.getBounds();
    peekAnchorY = b.y + Math.round((frac || 0) * b.height);
    const alpha = Math.max(0.1, Math.min(1, (config && config.bgOpacity ? config.bgOpacity : 100) / 100));
    const dyslexic = !!(config && config.dyslexicFont);
    const send = () => { try { pw.webContents.send('peek-content', { html: String(html || ''), alpha, dyslexic }); } catch {} };
    // first open: the page may still be loading and would miss the message
    if (pw.webContents.isLoading()) pw.webContents.once('did-finish-load', send);
    else send();
    pw.setBounds({ x: peekX(b), y: peekAnchorY, width: 360, height: pw.getBounds().height });
    // If it's coming from hidden, DON'T show it at the previous card's height and
    // let the new content overflow (that's the scrollbar-flash + resize snap the
    // user sees). Keep it hidden and let peek-height reveal it fully sized. If it's
    // already visible (gliding between rows), keep it up and just resize in place.
    if (pw.isVisible()) peekPendingShow = false;
    else peekPendingShow = true;
  } catch {}
});
ipcMain.on('peek-height', (_e, h) => {
  try {
    if (!peekWin || peekWin.isDestroyed()) return;
    const height = Math.max(60, Math.min(640, Math.ceil(Number(h) || 60)));
    const b = peekWin.getBounds();
    // keep the card on-screen: grow upward if it would run off the bottom
    const disp = require('electron').screen.getDisplayMatching(b).workArea;
    let y = peekAnchorY;
    if (y + height > disp.y + disp.height) y = Math.max(disp.y, disp.y + disp.height - height - 8);
    peekWin.setBounds({ x: b.x, y, width: 360, height });
    // reveal only now that the window matches the card - no snap
    if (peekPendingShow) { peekWin.showInactive(); peekPendingShow = false; }
  } catch {}
});
ipcMain.on('item-peek-hide', () => {
  peekPendingShow = false; // cancel a deferred reveal if the cursor left before it showed
  try { if (peekWin && !peekWin.isDestroyed()) peekWin.hide(); } catch {}
});

ipcMain.handle('set-item-search-opts', (_e, o) => {
  if (o && typeof o === 'object') {
    if ('q20' in o) config.itemQ20 = !!o.q20;
    if ('fillRunes' in o) config.itemFillRunes = !!o.fillRunes;
    if ('sliders' in o) config.itemSliders = !!o.sliders;
    // negative = mins above the roll (strictly-better comps) - deliberately allowed
    if ('statRange' in o) { const n = Number(o.statRange); if (Number.isFinite(n)) config.itemStatRange = Math.max(-100, Math.min(100, n)); }
    // how far back to accept listings (GGG trade_filters.indexed). Sticky, because
    // "ignore anything older than a week" is a standing preference, not a per-item one.
    if ('indexed' in o) config.itemIndexed = o.indexed == null ? null : String(o.indexed);
    saveConfig();
  }
  return true;
});
ipcMain.handle('set-garbage-pool', (_e, ids) => {
  config.garbagePool = Array.isArray(ids) ? ids.filter((s) => typeof s === 'string').slice(0, 200) : [];
  saveConfig();
  return true;
});
ipcMain.handle('set-item-ranges', (_e, ranges) => {
  if (ranges && typeof ranges === 'object') {
    config.itemRanges = ranges;
    saveConfig();
  }
  return true;
});
let tradeLeaguesCache = { ts: 0, list: [] };
ipcMain.handle('trade2-leagues', async () => {
  if (Date.now() - tradeLeaguesCache.ts < 15 * 60 * 1000 && tradeLeaguesCache.list.length) {
    return tradeLeaguesCache.list;
  }
  try {
    const list = await trade2.leagues();
    tradeLeaguesCache = { ts: Date.now(), list };
    return list;
  } catch {
    return tradeLeaguesCache.list;
  }
});
ipcMain.handle('trade2-auth-check', async (_e, { league, force }) => {
  try { return await trade2.authCheck(league, !!force); } catch { return false; }
});
// Open GGG's real login page with a minimal browser bar (back / forward / home) so
// a wrong click - Steam login, forgot-password - never strands the user. Cookies
// land in the shared persistent session; we never see or handle credentials.
ipcMain.handle('poe-login', () => new Promise((resolve) => {
  const { WebContentsView } = require('electron');
  const TOOLBAR_H = 40;
  const LOGIN_URL = 'https://www.pathofexile.com/login';
  const lw = new BrowserWindow({
    width: 560, height: 800, autoHideMenuBar: true,
    title: 'Log in to pathofexile.com',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'item', 'login-shell-preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  });
  const view = new WebContentsView({
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  lw.contentView.addChildView(view);
  const layout = () => {
    try {
      const [w, h] = lw.getContentSize();
      view.setBounds({ x: 0, y: TOOLBAR_H, width: w, height: h - TOOLBAR_H });
    } catch {}
  };
  lw.on('resize', layout);
  layout();
  lw.loadFile(path.join(__dirname, 'renderer', 'item', 'login-shell.html'));
  view.webContents.loadURL(LOGIN_URL);

  const hist = () => view.webContents.navigationHistory;
  const pushState = () => {
    try {
      lw.webContents.send('login-state', {
        url: view.webContents.getURL(),
        canBack: hist().canGoBack(),
        canFwd: hist().canGoForward(),
      });
    } catch {}
  };
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-finish-load']) {
    view.webContents.on(ev, pushState);
  }
  // Auto-close on success: every login flow (email, Steam, ...) ends by redirecting
  // back to a pathofexile.com page OUTSIDE /login. Flush cookies to disk first so
  // the session survives even a force-killed process.
  view.webContents.on('did-navigate', (_e, url) => {
    try {
      const u = new URL(url);
      if (/(^|\.)pathofexile\.com$/.test(u.hostname) && !u.pathname.startsWith('/login')) {
        view.webContents.session.flushStorageData();
        setTimeout(() => { try { if (!lw.isDestroyed()) lw.close(); } catch {} }, 600);
      }
    } catch {}
  });
  const onNav = (e, dir) => {
    if (e.sender !== lw.webContents) return;
    try {
      if (dir === 'back' && hist().canGoBack()) hist().goBack();
      else if (dir === 'forward' && hist().canGoForward()) hist().goForward();
      else if (dir === 'home') view.webContents.loadURL(LOGIN_URL);
    } catch {}
  };
  ipcMain.on('login-nav', onNav);
  lw.on('closed', () => {
    ipcMain.removeListener('login-nav', onNav);
    resolve(true);
  });
}));
ipcMain.handle('trade2-search', async (_e, { league, query }) => {
  try { return { ok: true, data: await trade2.search(league, query) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('trade2-fetch', async (_e, { ids, queryId }) => {
  try { return { ok: true, data: await trade2.fetchListings(ids, queryId) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('trade2-search-fetch', async (_e, { league, query, limit }) => {
  try { return { ok: true, data: await trade2.searchAndFetch(league, query, limit) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// Renderer reports which tab is active so the live trade-exchange poll runs ONLY
// while the Currency tab is open (see liveTick / currencyTabActive). Opening the
// tab kicks an immediate refresh so the grid isn't stale for up to a full tick.
ipcMain.on('active-tab', (_e, which) => {
  const wasActive = currencyTabActive;
  currencyTabActive = which === 'currency';
  // remember the tab so the app reopens on it next launch
  if (config && ['currency', 'items', 'desec'].includes(which) && config.lastTab !== which) {
    config.lastTab = which;
    saveConfig();
  }
  // opening the tab kicks an immediate refresh (unless the Tab rate is quiet)
  if (currencyTabActive && !wasActive) liveTick(true).catch(() => {});
});

ipcMain.on('check-updates-now', () => {
  if (autoUpdaterRef) autoUpdaterRef.checkForUpdates().catch(() => {});
  else checkUpdateManual();
});

ipcMain.on('install-update', () => {
  if (updateState.status === 'ready' && autoUpdaterRef) {
    const v = updateState.version;
    updateState = { status: 'installing', version: v };
    pushUpdateState();
    // toast survives the app quitting - tells the user the silence is intentional
    try {
      new Notification({
        title: 'POE2 Currency Overlay',
        body: `Installing v${v}. The app will close and restart itself - this can take up to a minute.`
      }).show();
    } catch {}
    // brief pause so the banner state is visible before the window vanishes;
    // non-silent install so the NSIS progress window shows while it applies
    setTimeout(() => autoUpdaterRef.quitAndInstall(false, true), 1500);
  } else {
    shell.openExternal(DOWNLOAD_PAGE);
  }
});

// in-app feedback -> Google Apps Script web app -> feedback Sheet. The /exec URL
// is a public endpoint (no secret), so validation/limits live in the script.
const FEEDBACK_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzzeXIgPXcpZJG3BSnd-feEIQ-7G_-41IHnZHptENI3QvYeTi0zgFBQg_WG0GUXMru-/exec';
ipcMain.handle('submit-feedback', async (_e, payload) => {
  try {
    if (!/^https:\/\/script\.google\.com\//.test(FEEDBACK_ENDPOINT)) return false;
    const body = JSON.stringify({
      kind: String((payload && payload.kind) || 'feedback').slice(0, 20),
      type: String((payload && payload.type) || '').slice(0, 60),
      details: String((payload && payload.details) || '').slice(0, 5000),
      contact: String((payload && payload.contact) || '').slice(0, 200),
      log: String((payload && payload.log) || '').slice(0, 20000),
      // only present when the user ticked "include system information"; the renderer
      // sends '' otherwise and we add nothing of our own here
      system: String((payload && payload.system) || '').slice(0, 2000),
      // the item text they last copied, for item bugs - same tick box, and the form
      // shows it to them before sending
      item: String((payload && payload.item) || '').slice(0, 2000),
      version: app.getVersion(),
      ts: new Date().toISOString()
    });
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    return res.ok;
  } catch {
    return false;
  }
});

// open a vetted external link in the user's default browser. Host-whitelisted so
// the renderer can never be tricked into launching an arbitrary URL.
const EXTERNAL_HOST_ALLOW = ['ko-fi.com', 'docs.google.com', 'forms.gle', 'poe2-vibetools.github.io', 'poe2scout.com'];
ipcMain.on('open-external', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:' && EXTERNAL_HOST_ALLOW.includes(u.hostname)) {
      shell.openExternal(u.href);
    }
  } catch {}
});

ipcMain.on('hide-overlay', (_e, toGame) => {
  logToggle('renderer-esc-or-x', 'hide');
  if (win) hideOverlay(!!toGame);
});

// The overlay shows inactive and never grabs focus on its own (so Ctrl+F chains
// without clicking back into the game). But once the user CLICKS into it, they
// expect to type - which needs OS keyboard focus. The renderer asks for it on the
// first click into an unfocused window.
ipcMain.on('focus-overlay', () => {
  try { if (win && !win.isDestroyed()) win.focus(); } catch {}
});

ipcMain.on('quit-app', () => app.quit());

// ---------- lifecycle ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => toggleOverlay('second-instance'));

  // The NSIS updater launches the app via its Start-menu shortcut; if that
  // shortcut ever goes missing, updates end with a "Windows cannot find .lnk"
  // error. Self-heal: recreate it on every packaged startup if absent.
  function ensureShortcuts() {
    if (!app.isPackaged) return;
    try {
      const lnk = path.join(
        app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs',
        'POE2 Currency Overlay.lnk'
      );
      if (!fs.existsSync(lnk)) {
        shell.writeShortcutLink(lnk, 'create', {
          target: process.execPath,
          cwd: path.dirname(process.execPath)
        });
      }
    } catch {}
  }

  // ee2://root/data/<...> -> renderer/vendor/ee2/data/<...> (read-only, path-jailed)
  const EE2_DATA_ROOT = path.join(__dirname, 'renderer', 'vendor', 'ee2', 'data');
  const EE2_MIME = { '.ndjson': 'application/x-ndjson', '.json': 'application/json', '.bin': 'application/octet-stream', '.js': 'text/javascript' };
  function serveEe2Data(request) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/data/')) return new Response('not found', { status: 404 });
      const rel = decodeURIComponent(url.pathname.slice('/data/'.length));
      const file = path.resolve(EE2_DATA_ROOT, rel);
      if (!file.startsWith(path.resolve(EE2_DATA_ROOT) + path.sep)) return new Response('forbidden', { status: 403 });
      const body = fs.readFileSync(file);
      return new Response(body, {
        headers: {
          'Content-Type': EE2_MIME[path.extname(file)] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }

  app.whenReady().then(() => {
    protocol.handle('ee2', serveEe2Data);
    // getDisplayMedia needs a handler or the request is denied outright. Only the
    // non-Windows capture path uses it (see grabScreen); useSystemPicker hands the
    // choice to the desktop's own portal dialog, which is what GNOME requires.
    if (process.platform !== 'win32') {
      try {
        session.defaultSession.setDisplayMediaRequestHandler(
          (_request, callback) => callback({ useSystemPicker: true }),
          { useSystemPicker: true }
        );
      } catch (err) { console.error('display-media handler failed:', err && err.message); }
    }
    // surface rate-limit queuing in the UI so a throttled search never looks hung
    trade2.setOnWait((policy, ms, banned) => {
      try { if (win) win.webContents.send('trade2-wait', { policy, ms, banned: !!banned }); } catch {}
    });
    config = loadConfig();
    ensureShortcuts();
    createSplash();
    createWindow();
    createTray();
    registerHotkey(config.hotkey);
    // load the native key-synthesis addon NOW, so the first price-check hotkey
    // isn't the one paying for it, and start tracking real modifier state
    setTimeout(startHookListener, 0);
    // same treatment for the native focus module (koffi + game-window lookup):
    // bind and prime the HWND cache off the critical path
    setTimeout(() => { try { focusNative.warm(); } catch {} }, 0);
    checkFeed(); // pick data source on load
    setInterval(checkFeed, FEED_CHECK_MS); // re-check every 15 minutes
    setInterval(liveTick, LIVE_HEARTBEAT_MS); // live core-pair rates; each beat honors the Tab/Bg rate
    // hotkey watchdog: games/apps can steal or drop the global hotkey; if our
    // registration ever vanishes, take it back and log the recovery
    setInterval(() => {
      try {
        if (config.hotkey && !globalShortcut.isRegistered(config.hotkey)) {
          logToggle('watchdog', 'hotkey registration lost - re-registering');
          registerHotkey(config.hotkey);
        }
        // item hotkey too: e.g. Exiled Exchange holds Ctrl+D until the user closes
        // it - grab it as soon as it frees up
        if (config.itemHotkey && !globalShortcut.isRegistered(config.itemHotkey)) {
          registerItemHotkey();
        }
      } catch {}
    }, 60 * 1000);
    initUpdates();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    // release the global keyboard hook, or the process can outlive the window
    if (hookListening && hookMod) { try { hookMod.uIOhook.stop(); } catch {} }
  });

  // keep running when the (only) window is hidden/closed
  app.on('window-all-closed', (e) => {});
}
