/**
 * POE2 Currency Overlay - edge proxy.
 *
 * GET /v1/snapshot?league=<name>   → currency-exchange snapshot (JSON)
 * GET /v1/leagues                  → league list (JSON)
 * GET /v1/health                   → { ok, upstream: "ggg" | "poe2scout" }
 *
 * Upstream selection:
 *   - If GGG_CLIENT_ID / GGG_CLIENT_SECRET secrets are configured, fetches the
 *     official Currency Exchange API (service:cxapi) via client_credentials.
 *   - Otherwise falls back to poe2scout's public API.
 *
 * All responses are cached at the edge for CACHE_TTL seconds, so upstream load
 * is one request per league per TTL window regardless of user count. The
 * confidential credential exists only in the Worker secret store; clients never
 * receive or need it.
 */

const CACHE_TTL = 600; // seconds - one upstream fetch per league per 10 minutes
const UA = 'OAuth poe2-currency-overlay/1.0 (https://github.com/POE2-VibeTools/poe2-currency-overlay)';

const GGG_TOKEN_URL = 'https://www.pathofexile.com/oauth/token';
// NOTE: verify exact CX endpoint path against developer docs when credentials arrive.
const GGG_CX_URL = (league) =>
  `https://api.pathofexile.com/currency-exchange/poe2/${encodeURIComponent(league)}`;

const SCOUT = 'https://poe2scout.com/api';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // The one WRITE route: community-submitted stash panel captures, used to build a
    // corpus of real renderings for the Net Worth reader. Handled ahead of the GET-only
    // guard and the edge cache, neither of which applies to an upload.
    if (url.pathname === '/v1/stash-sample') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        } });
      }
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      try { return await stashSample(request, env); }
      catch (e) { return noCacheJson({ error: String(e) }, 500); }
    }

    // Admin-only listing. Without it the bucket is WRITE-ONLY: keys are server-generated
    // uuids, wrangler has no `r2 object list`, and there is no other read path - so the
    // corpus we ask people to contribute to could not be retrieved at all. Never cached,
    // and gated on a secret so submissions stay private.
    if (url.pathname === '/v1/stash-sample/list') {
      if (request.method !== 'GET') return noCacheJson({ error: 'GET only' }, 405);
      const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
        || url.searchParams.get('key') || '';
      const expected = env.SAMPLE_ADMIN_KEY || '';
      // constant-time-ish: compare full length always, and fail closed if unset
      let ok = expected.length > 0 && provided.length === expected.length;
      for (let i = 0; ok && i < expected.length; i++) if (expected[i] !== provided[i]) ok = false;
      if (!ok) return noCacheJson({ error: 'unauthorized' }, 401);
      if (!env.STASH_SAMPLES) return noCacheJson({ error: 'sample storage not configured' }, 503);
      try {
        const listed = await env.STASH_SAMPLES.list({
          limit: Math.min(1000, Number(url.searchParams.get('limit')) || 200),
          cursor: url.searchParams.get('cursor') || undefined,
          prefix: url.searchParams.get('prefix') || undefined,
        });
        return noCacheJson({
          objects: listed.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
          truncated: listed.truncated,
          cursor: listed.truncated ? listed.cursor : null,
        });
      } catch (e) {
        return noCacheJson({ error: String((e && e.message) || e) }, 500);
      }
    }

    if (request.method !== 'GET') return json({ error: 'GET only' }, 405);

    // Serve from edge cache first.
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let resp;
    try {
      if (url.pathname === '/v1/health') {
        resp = json({ ok: true, upstream: hasGGG(env) ? 'ggg' : 'poe2scout' });
      } else if (url.pathname.startsWith('/scout/')) {
        // transparent cached passthrough of the poe2scout API (same paths the
        // overlay uses directly) - whitelisted to the read-only routes we need
        const rest = url.pathname.slice('/scout'.length);
        if (!(rest.startsWith('/poe2/') || rest === '/Realms')) {
          return json({ error: 'path not allowed' }, 403);
        }
        const r = await fetch(`https://api.poe2scout.com${rest}${url.search}`, {
          headers: { 'user-agent': UA }
        });
        resp = await passthrough(r);
      } else if (url.pathname === '/v1/leagues') {
        resp = await leagues();
      } else if (url.pathname === '/v1/snapshot') {
        const league = url.searchParams.get('league');
        if (!league) return json({ error: 'league query param required' }, 400);
        resp = hasGGG(env) ? await gggSnapshot(env, league) : await scoutSnapshot(league);
      } else {
        return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: String(e) }, 502);
    }

    if (resp.ok) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }
};

function hasGGG(env) {
  return Boolean(env.GGG_CLIENT_ID && env.GGG_CLIENT_SECRET);
}

// A stash panel crop runs ~200-500KB, but a sample whose panel could NOT be located is
// sent as the whole game window (that framing is the only thing that can explain the
// miss) - 2-5MB at 1080p-4K. PNG stays lossless on purpose: JPEG artifacts would land on
// the exact pixels the digit reader looks at, so a compressed corpus would lie to us.
// 4K and ultrawide game frames land at 8-14MB, so the ceiling has to clear those: the
// app decides the framing, the user cannot make the file smaller, and "too large" is an
// error they have no way to act on.
const SAMPLE_MAX_BYTES = 24 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
// One per readable tab layout: the app reads 12, so a submitter can send all of theirs
// and no more. Only STORED images count against it - a rejected upload writes nothing,
// so it costs nothing and must not burn someone's allowance. Rejects are still bounded,
// just by the global counter rather than this one.
const SAMPLE_PER_IP_PER_WEEK = 12;
const SAMPLE_GLOBAL_PER_DAY = 200; // hard ceiling on what a bad day can cost

// Quota counters, backed by KV: a rolling-week counter per address and a daily one
// globally. FAILS CLOSED: no KV binding, or KV erroring, means no uploads. The whole
// point is a spend ceiling, so "storage is unprotected" must never be the fallback.
// KV is eventually consistent, so simultaneous requests can slip a couple past the
// per-IP count - the global counter is what actually bounds the bill.
// The per-submitter counter is keyed by a SALTED HASH of the IP, never the address
// itself: this only ever needs "have I seen this one before", which a hash answers just
// as well, and it keeps us from holding a week of raw visitor IPs to explain in the
// privacy statement. Truncated to 8 bytes - collisions cost a stranger a slot, nothing worse.
async function hashIp(ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`poe2-stash-sample:${ip}`));
  return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const quotaKeys = (ipHash) => ({
  gKey: `total:${new Date().toISOString().slice(0, 10)}`,
  // fixed 7-day bucket rather than calendar weeks - no timezone or ISO-week edge cases
  iKey: `ip:${Math.floor(Date.now() / 604800000)}:${ipHash}`,
});

async function checkQuota(env, ip) {
  const kv = env.SAMPLE_QUOTA;
  if (!kv) return { ok: false, status: 503, error: 'submissions unavailable' };
  try {
    if (await kv.get('disabled')) return { ok: false, status: 503, error: 'submissions closed' };
    const { gKey, iKey } = quotaKeys(await hashIp(ip));
    const [gRaw, iRaw] = await Promise.all([kv.get(gKey), kv.get(iKey)]);
    if ((Number(gRaw) || 0) >= SAMPLE_GLOBAL_PER_DAY) {
      return { ok: false, status: 429, error: 'daily limit reached, try tomorrow' };
    }
    if ((Number(iRaw) || 0) >= SAMPLE_PER_IP_PER_WEEK) {
      return { ok: false, status: 429, error: `that is all ${SAMPLE_PER_IP_PER_WEEK} for this week - thank you` };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 503, error: 'submissions unavailable' };
  }
}

// Counted only AFTER an image is stored, so the allowance means 12 stored tabs exactly.
async function bumpQuota(env, ip) {
  const kv = env.SAMPLE_QUOTA;
  if (!kv) return;
  try {
    const { gKey, iKey } = quotaKeys(await hashIp(ip));
    const [gRaw, iRaw] = await Promise.all([kv.get(gKey), kv.get(iKey)]);
    await Promise.all([
      kv.put(gKey, String((Number(gRaw) || 0) + 1), { expirationTtl: 172800 }),   // 48h
      kv.put(iKey, String((Number(iRaw) || 0) + 1), { expirationTtl: 1209600 }),  // 14d
    ]);
  } catch { /* the image is already stored; a lost count is not worth failing the upload */ }
}

// Store ONE submitted stash panel capture plus its diagnostics.
// Deliberately narrow: PNG only, size-capped, keys are server-generated so a submitter
// can never overwrite someone else's sample, and there is no read or list route - the
// corpus is pulled with wrangler, not served. Abuse control beyond the size cap is a
// Cloudflare rate-limiting rule on this path, NOT anything in this code.
async function stashSample(request, env) {
  if (!env.STASH_SAMPLES) return noCacheJson({ error: 'sample storage not configured' }, 503);
  if (Number(request.headers.get('content-length') || 0) > SAMPLE_MAX_BYTES) {
    return noCacheJson({ error: 'too large' }, 413);
  }
  // quota BEFORE reading the body, so a spammer can't make us buffer megabytes per request
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const q = await checkQuota(env, ip);
  if (!q.ok) return noCacheJson({ error: q.error }, q.status);

  let form;
  try { form = await request.formData(); }
  catch { return noCacheJson({ error: 'expected multipart/form-data' }, 400); }

  const file = form.get('image');
  if (!file || typeof file === 'string') return noCacheJson({ error: 'image field required' }, 400);
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!buf.byteLength) return noCacheJson({ error: 'empty image' }, 400);
  if (buf.byteLength > SAMPLE_MAX_BYTES) return noCacheJson({ error: 'too large' }, 413);
  if (!PNG_MAGIC.every((b, i) => buf[i] === b)) return noCacheJson({ error: 'png only' }, 415);

  const id = crypto.randomUUID();
  const key = `${new Date().toISOString().slice(0, 10)}/${id}`;
  await env.STASH_SAMPLES.put(`${key}.png`, buf, { httpMetadata: { contentType: 'image/png' } });
  // diagnostics ride alongside as a sibling object rather than R2 custom metadata,
  // which is size-limited and awkward to read back in bulk
  const meta = String(form.get('meta') || '').slice(0, 8192);
  if (meta) {
    await env.STASH_SAMPLES.put(`${key}.json`, meta, { httpMetadata: { contentType: 'application/json' } });
  }
  await bumpQuota(env, ip);
  return noCacheJson({ ok: true, id });
}

function noCacheJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': `public, max-age=${CACHE_TTL}`
    }
  });
}

async function passthrough(upstreamResp) {
  const body = await upstreamResp.text();
  return new Response(body, {
    status: upstreamResp.status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': `public, max-age=${CACHE_TTL}`
    }
  });
}

// ---------- poe2scout fallback ----------

async function leagues() {
  const r = await fetch(`${SCOUT}/poe2/Leagues`, { headers: { 'user-agent': UA } });
  return passthrough(r);
}

async function scoutSnapshot(league) {
  const r = await fetch(
    `${SCOUT}/poe2/Leagues/${encodeURIComponent(league)}/SnapshotPairs`,
    { headers: { 'user-agent': UA } }
  );
  return passthrough(r);
}

// ---------- official GGG upstream (activates when secrets are set) ----------

let tokenCache = { token: null, exp: 0 };

async function gggToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const r = await fetch(GGG_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.GGG_CLIENT_ID,
      client_secret: env.GGG_CLIENT_SECRET,
      scope: 'service:cxapi'
    })
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}`);
  const d = await r.json();
  tokenCache = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return tokenCache.token;
}

async function gggSnapshot(env, league) {
  const token = await gggToken(env);
  const r = await fetch(GGG_CX_URL(league), {
    headers: { authorization: `Bearer ${token}`, 'user-agent': UA }
  });
  return passthrough(r);
}
