const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, shell, Notification, protocol, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const focusNative = require('./focus-native'); // lazy inside - koffi binds on first use
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

const API_BASE = 'https://api.poe2scout.com';
const USER_AGENT = 'POE2-Price-Overlay/1.0 (https://github.com/POE2-VibeTools/poe2-currency-overlay)';
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'overlay-config.json');

// Item price-check: rate-limited PoE2 trade2 API client (main process).
const trade2 = require('./trade2');
// Currency pairs: GGG's public Currency Exchange CDN (executed trades, hourly).
const cxFeed = require('./cx-feed');
let cxState = { ok: false, at: 0, pairs: 0 };

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
  stashHotkey: 'F7', // view a special stash tab in game, press this: reads + values it into the Net Worth tally
  itemQ20: true,       // search armour/weapons as if 20% quality
  itemFillRunes: true, // search as if empty rune sockets held Greater Iron Runes
  itemSliders: true,   // show per-mod range sliders in Price Check
  itemStatRange: 15,   // Price Check "stat range +/-%" - remembered between sessions
  itemHistory: [], // cached item price-check searches (capped, newest first)
  desecHistory: [], // Desecrate tab: items evaluated for Omen of Light rerolling
  itemRanges: {},  // learned per-stat roll bounds from fetched listings (slider bounds)
  garbagePool: [], // user-curated worthless-mod stat ids (starts empty by design)
  tutorialDone: false,
  lastSeenVersion: null, // last app version whose "what's new" popup was shown+dismissed
  lastTab: 'currency',   // tab to reopen on (remembered across restarts): 'currency' | 'items' | 'desec'

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
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
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
        if (t && /Item Class:|Rarity:/.test(t)) return t;
      }
      return '';
    };
    clipboard.writeText(''); // so a successful copy is unambiguous
    cleared = true;
    let text = '';
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
    if (!text) {
      if (cleared && before) clipboard.writeText(before); // put their clipboard back
      // manual-workflow fallback (Ctrl+Alt+C then hotkey) - but never text we
      // already consumed, which would silently re-search the previous item
      if (/Item Class:|Rarity:/.test(before) && before !== lastConsumedItemText) text = before;
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

// ---------- stash net-worth: capture a fixed-layout special tab and value it ----------
// Screen capture (crisp; window/DirectX grabs are soft) -> desat-max flat-white
// filter -> read each static slot via the baked digit templates -> price via the
// live poe2scout catalog -> tab total. Empty/unreadable slots flag, never guess.
let stashPriceCache = null; // { at, map: apiId -> {price, icon, name} }
async function getStashPriceMap(force) {
  if (!force && stashPriceCache && Date.now() - stashPriceCache.at < 5 * 60_000) return stashPriceCache.map;
  const full = await fetchFullCatalog();
  const map = {};
  for (const g of full.groups) for (const it of g.items) if (!map[it.apiId]) map[it.apiId] = { price: it.price, icon: it.icon, name: it.text };
  stashPriceCache = { at: Date.now(), map };
  return map;
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
    w.postMessage({ bitmap: ab, W, H }, [ab]); // transfer the ~8MB frame, no copy
  });
}

async function doStashCapture(onDetected) {
  // Hide the overlay during the grab so it doesn't occlude the panel it's reading
  // (the screen capture is the composited desktop). Restored in finally.
  const wasVisible = win && win.isVisible() && win.getOpacity() > 0;
  try {
    const disp = screen.getPrimaryDisplay();
    const cw = Math.round(disp.size.width * disp.scaleFactor);
    const ch = Math.round(disp.size.height * disp.scaleFactor);
    if (wasVisible) { win.setOpacity(0); await new Promise((r) => setTimeout(r, 70)); }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: cw, height: ch } });
    if (wasVisible) win.setOpacity(1);
    const src = sources.find((s) => s.id.startsWith('screen')) || sources[0];
    if (!src) return { ok: false, error: 'no screen source' };
    const img = src.thumbnail;
    const { width: W, height: H } = img.getSize();

    const res = await runReaderWorker(img.toBitmap(), W, H, onDetected);
    if (!res || !res.ok) return res || { ok: false, error: 'reader failed' };
    if (res.mismatch) return { ok: true, mismatch: true, readCount: res.readCount, slotCount: res.slotCount };

    let prices = {};
    try { prices = await getStashPriceMap(); } catch (err) { /* prices optional; counts still shown */ }
    const divPrice = prices.divine && typeof prices.divine.price === 'number' ? prices.divine.price : null;

    const lines = []; const flags = []; let total = 0;
    for (const r of res.reads) {
      const info = prices[r.apiId] || {};
      const name = info.name || r.apiId;
      if (r.count == null) { flags.push({ apiId: r.apiId, name }); continue; }
      const price = typeof info.price === 'number' ? info.price : null;
      const valueEx = price != null ? r.count * price : null;
      if (valueEx != null) total += valueEx;
      lines.push({ apiId: r.apiId, name, icon: info.icon || null, count: r.count, price, valueEx });
    }
    lines.sort((a, b) => (b.valueEx || 0) - (a.valueEx || 0));
    return {
      ok: true, tab: res.tab, w: W, h: H, offset: res.offset, readCount: res.readCount, slotCount: res.slotCount,
      totalEx: total, divPrice, totalDiv: divPrice ? total / divPrice : null, lines, flags, mismatch: false,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    if (wasVisible && win && win.getOpacity() === 0) win.setOpacity(1); // never leave it hidden
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

// Global capture hotkey: view a special tab in game, press it; the app detects the
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
    pw.setBounds({ x: Math.max(0, b.x - 360 - 10), y: peekAnchorY, width: 360, height: pw.getBounds().height });
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
