// TasteBridge HTTP entry point (Cloudflare Worker style; local-server.mjs runs it on Node).
// Routes: the web app, a JSON/NDJSON planning API and an MCP endpoint for AI agents.
import { ORIGIN, tidy, entity } from './qloo.js';
import { plan, bridge, balancedFilms, shares, parseInput, OCCASIONS } from './engine.js';
import { evening, parseEvening } from './evening.js';
import { handleMcp } from './mcp.js';
import { page } from './page.js';
import { appRoute } from './app.js';
import { handleSocial, sessionUser, planTitle } from './social.js';

// Small stable hash (FNV-1a) for cache keys; works in Workers and Node alike.
const fnv = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// Two planners share the same routes: the quick shortlist and the "Tonight" evening plan.
const MODES = {
  plan: { run: plan, key: (input) => { const q = parseInput(input); return ['plan', ...q.favorites, '|', ...q.names, q.city, q.occasion]; } },
  evening: { run: evening, key: (input) => { const q = parseEvening(input); return ['evening', ...q.favorites, '|', ...q.names, q.city, q.near?.lat, q.near?.lon, q.start, q.day, q.cuisine, q.mood, q.budget, q.special]; } },
};

// Ten-minute result cache, keyed by the normalised request.
const cache = new Map();
function cacheKey(mode, input) {
  try {
    // Plans that know where people have been are personal, so their key includes that history.
    const seen = input?.seen && Object.keys(input.seen).length ? fnv(JSON.stringify(Object.entries(input.seen).sort())) : '';
    return [...MODES[mode].key(input), seen].join('|').toLowerCase();
  } catch {
    return null;
  }
}
function remember(key, value) {
  if (cache.size > 100) cache.clear();
  cache.set(key, { value, expires: Date.now() + 600000 });
}

// Per-client limit on fresh plans, shared by the web app and MCP tool calls.
// MCP gets a higher limit: calls from Claude or ChatGPT arrive from a few shared provider addresses.
const LIMIT = 20, MCP_LIMIT = 120, WINDOW = 600000;
const hits = new Map();
function clientId(request) {
  const forwarded = (request.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return request.headers.get('cf-connecting-ip') || forwarded.at(-1) || 'local';
}
function allow(request, limit = LIMIT, bucket = 'web') {
  const id = bucket + ':' + clientId(request), now = Date.now();
  const recent = (hits.get(id) || []).filter((t) => now - t < WINDOW);
  if (recent.length >= limit) { hits.set(id, recent); return false; }
  recent.push(now);
  if (hits.size > 5000) hits.clear();
  hits.set(id, recent);
  return true;
}

const qlooOrigin = (env) => ['https://api.qloo.com', 'https://hackathon.api.qloo.com'].includes(env.QLOO_API_URL) ? env.QLOO_API_URL : ORIGIN;

// Streams agent steps as they happen, then the plan: one JSON object per line.
function streamPlan(mode, input, key, origin, cached, allowed, onResult = () => {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (message) => controller.enqueue(encoder.encode(JSON.stringify(message) + '\n'));
      try {
        if (cached) {
          for (const step of cached.steps) send({ event: 'step', step });
          onResult(cached);
          send({ event: 'result', plan: cached });
        } else if (!allowed()) {
          send({ event: 'error', error: 'Too many plans from this connection. Try again in a few minutes.' });
        } else {
          const result = await MODES[mode].run(input, key, origin, (step) => send({ event: 'step', step }));
          const k = cacheKey(mode, input);
          if (k) remember(k, result);
          onResult(result);
          send({ event: 'result', plan: result });
        }
      } catch (error) {
        send({ event: 'error', error: error instanceof Error ? error.message : 'Plan failed.' });
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

async function planRoute(mode, request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env.QLOO_API_KEY) return json({ error: 'Live Qloo data is not configured yet. Try the clearly labeled sample while the key is being added.' }, 503);
  if (Number(request.headers.get('content-length') || 0) > 3000) return json({ error: 'Request is too large.' }, 413);
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (input && typeof input === 'object') delete input.seen; // only the server knows where someone has been
  const me = sessionUser(request, env.STORE);
  if (me) input.seen = env.STORE.seenBy([me.id]);
  const keep = (result) => { if (me) env.STORE.savePlanFor(me.id, planTitle(result, (result.seeds || []).map((x) => x.person).filter(Boolean)[1]), result); };
  const key = cacheKey(mode, input);
  if (!key) {
    try { MODES[mode].key(input); } catch (error) { return json({ error: error.message }, 422); }
    return json({ error: 'Invalid request.' }, 422);
  }
  const hit = cache.get(key);
  const cached = hit && hit.expires > Date.now() ? hit.value : null;
  const origin = qlooOrigin(env);
  if ((request.headers.get('accept') || '').includes('application/x-ndjson')) return streamPlan(mode, input, env.QLOO_API_KEY, origin, cached, () => allow(request), keep);
  if (cached) { keep(cached); return json(cached); }
  if (!allow(request)) return json({ error: 'Too many plans from this connection. Try again in a few minutes.' }, 429);
  try {
    const result = await MODES[mode].run(input, env.QLOO_API_KEY, origin);
    remember(key, result);
    keep(result);
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Plan failed.' }, 422);
  }
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === '/' || /^\/r\/[a-z0-9]{6,16}$/.test(url.pathname)) return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/api/status') return json({ live: Boolean(env.QLOO_API_KEY), occasions: Object.keys(OCCASIONS), mcp: url.origin + '/mcp' });
    if (url.pathname === '/api/plan') return planRoute('plan', request, env);
    if (url.pathname === '/api/evening') return planRoute('evening', request, env);
    if (url.pathname.startsWith('/api/account') || url.pathname.startsWith('/api/rooms') || url.pathname.startsWith('/api/photos/')) {
      return handleSocial(request, env, {
        allow: (req, limit, bucket) => allow(req, limit, bucket),
        // Shared plans stream their steps like the guest planner and are saved to the room when done.
        runPlan: (mode, input, req, save) => {
          if (!env.QLOO_API_KEY) return json({ error: 'Live Qloo data is not configured yet.' }, 503);
          const k = cacheKey(mode, input);
          if (!k) { try { MODES[mode].key(input); } catch (error) { return json({ error: error.message }, 422); } }
          const hit = k && cache.get(k);
          return streamPlan(mode, input, env.QLOO_API_KEY, qlooOrigin(env), hit && hit.expires > Date.now() ? hit.value : null, () => allow(req), save);
        },
      });
    }
    const app = appRoute(url.pathname);
    if (app) return app;
    if (url.pathname === '/mcp') return handleMcp(request, env, qlooOrigin(env), () => allow(request, MCP_LIMIT, 'mcp'));
    return json({ error: 'Not found.' }, 404);
  },
};

export { plan, bridge, balancedFilms, shares, entity, tidy };
