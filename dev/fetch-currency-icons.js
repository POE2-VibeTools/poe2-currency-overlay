'use strict';
// Pull the source art for every currency a player can price an item in.
//
// Icons come from the LIVE poe2scout API, the same place the app's own currency list and
// price checker get theirs. The bundled cx-catalog.json also carries an icon field, but it
// is a stale snapshot: a third of its URLs 404 now. If the app can show an icon on screen,
// this script can fetch it - anything missing here is a bug in this script, not a gap in
// the data.
//
// Writes to dev/currency-icons/. Raw downloads are dev input, not shipped;
// dev/build-currency-templates.js turns them into the baked file the app loads.
//
// Shards are excluded on purpose: they cannot be selected in the Set Item Price dropdown.
const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = 'https://api.poe2scout.com';
const UA = 'poe2-price-overlay (+https://github.com/POE2-VibeTools/poe2-currency-overlay)';
const OUT = path.join(__dirname, 'currency-icons');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { s += d; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function getBuf(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getBuf(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// Same endpoint and same current-softcore preference the app uses. The icon set does not
// vary by league, but the category endpoint needs a real league name in the path.
async function league() {
  const ls = await getJSON(API_BASE + '/poe2/Leagues');
  const arr = Array.isArray(ls) ? ls : (ls.Leagues || ls.leagues || []);
  const current = arr.filter((l) => l.IsCurrent);
  const softcore = current.find((l) => !/^HC /i.test(l.Value) && !/hardcore/i.test(l.Value));
  const pick = softcore || current[0] || arr[0];
  if (!pick || !pick.Value) throw new Error('could not read a league name from /poe2/Leagues');
  return pick.Value;
}

(async () => {
  const lg = await league();
  console.log('league: ' + lg + '\n');
  const data = await getJSON(API_BASE + '/poe2/Leagues/' + encodeURIComponent(lg)
    + '/Currencies/ByCategory?category=currency&perPage=250&dataPoints=7');

  const list = (data.Items || [])
    .map((i) => ({ key: i.ApiId, text: i.Text, icon: i.IconUrl }))
    .filter((c) => c.icon && !/\bshard\b/i.test(c.text || ''))
    .sort((a, b) => a.text.localeCompare(b.text));

  fs.mkdirSync(OUT, { recursive: true });
  console.log(list.length + ' currencies to fetch\n');

  const cache = new Map();
  const manifest = [];
  let ok = 0, failed = 0;

  for (const c of list) {
    const file = c.key + '.png';
    try {
      if (!cache.has(c.icon)) cache.set(c.icon, await getBuf(c.icon));
      const buf = cache.get(c.icon);
      fs.writeFileSync(path.join(OUT, file), buf);
      manifest.push({ key: c.key, text: c.text, file, bytes: buf.length, url: c.icon });
      console.log('  ok    ' + c.text.padEnd(34) + (buf.length / 1024).toFixed(1) + ' KB');
      ok++;
    } catch (err) {
      console.log('  FAIL  ' + c.text.padEnd(34) + (err && err.message));
      failed++;
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const byUrl = new Map();
  for (const m of manifest) {
    if (!byUrl.has(m.url)) byUrl.set(m.url, []);
    byUrl.get(m.url).push(m.text);
  }
  const dupes = [...byUrl.values()].filter((v) => v.length > 1);

  console.log('\n' + ok + ' fetched, ' + failed + ' failed -> ' + OUT);
  console.log(byUrl.size + ' distinct images');
  if (dupes.length) {
    console.log('\nSHARED ART - these need the tier word to tell apart:');
    for (const d of dupes) console.log('  ' + d.join('  ==  '));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
