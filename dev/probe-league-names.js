'use strict';
// Does GGG localize league names? Ask the trade API's own /data/leagues on the English
// host and a language host and compare ids vs display text.
//
//   npx electron dev/probe-league-names.js
const { app, net } = require('electron');

function get(url) {
  return new Promise((resolve) => {
    const r = net.request({ method: 'GET', url });
    r.setHeader('User-Agent', 'poe2-price-overlay (+https://github.com/POE2-VibeTools/poe2-currency-overlay)');
    r.setHeader('Accept', 'application/json');
    r.on('response', (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', (e) => resolve({ status: 0, body: String(e) }));
    r.end();
  });
}

app.whenReady().then(async () => {
  for (const host of ['www', 'ru', 'de']) {
    const r = await get(`https://${host}.pathofexile.com/api/trade2/data/leagues`);
    let out = 'HTTP ' + r.status;
    try {
      const j = JSON.parse(r.body);
      out = (j.result || []).slice(0, 4).map((l) => `${l.id} => "${l.text}"`).join(' | ');
    } catch { out += ' (non-JSON: ' + r.body.slice(0, 60).replace(/\s+/g, ' ') + ')'; }
    console.log(host.padEnd(4), out);
  }
  app.exit(0);
});
