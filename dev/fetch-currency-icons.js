'use strict';
// Pull the source art for every currency a player can price an item in, straight from
// the CDN the price feed already uses. Writes to dev/currency-icons/ - raw downloads are
// dev input, not shipped; dev/build-currency-templates.js turns them into the small
// baked signature file the app actually loads.
//
// Shards are excluded on purpose: they cannot be selected in the Set Item Price dropdown.
const fs = require('fs');
const path = require('path');
const https = require('https');

const CATALOG = path.join(__dirname, '..', 'cx-catalog.json');
const OUT = path.join(__dirname, 'currency-icons');

function currencies() {
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  return Object.entries(cat)
    .filter(([, v]) => /^currency$/i.test(v.category || ''))
    .filter(([, v]) => !/\bshard\b/i.test(v.text || ''))
    .filter(([, v]) => v.icon)
    .map(([key, v]) => ({ key, text: v.text, icon: v.icon }))
    .sort((a, b) => a.text.localeCompare(b.text));
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'user-agent': 'poe2-overlay-dev' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

(async () => {
  const list = currencies();
  fs.mkdirSync(OUT, { recursive: true });
  console.log(list.length + ' currencies to fetch\n');

  // The catalog points several entries at the same art file. Fetch each URL once.
  const cache = new Map();
  const manifest = [];
  let ok = 0, failed = 0;

  for (const c of list) {
    const file = c.key + '.png';
    try {
      if (!cache.has(c.icon)) cache.set(c.icon, await get(c.icon));
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

  // Two currencies sharing one art file cannot be told apart by icon. Say so loudly here
  // rather than letting the matcher pick one of them at random later.
  const byUrl = new Map();
  for (const m of manifest) {
    if (!byUrl.has(m.url)) byUrl.set(m.url, []);
    byUrl.get(m.url).push(m.text);
  }
  const dupes = [...byUrl.values()].filter((v) => v.length > 1);

  console.log('\n' + ok + ' fetched, ' + failed + ' failed -> ' + OUT);
  if (dupes.length) {
    console.log('\nSHARED ART - these cannot be distinguished by icon alone:');
    for (const d of dupes) console.log('  ' + d.join('  ==  '));
  }
})();
