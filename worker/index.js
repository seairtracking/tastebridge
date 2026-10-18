// TasteBridge HTTP entry point (Cloudflare Worker style; local-server.mjs runs it on Node).
// Routes: the web app, a JSON/NDJSON planning API and an MCP endpoint for AI agents.
import { ORIGIN, tidy, entity } from './qloo.js';
import { plan, bridge, balancedFilms, shares, parseInput, OCCASIONS } from './engine.js';
import { handleMcp } from './mcp.js';
import { page } from './page.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// Ten-minute result cache, keyed by the normalised request.
const cache = new Map();
function cacheKey(input) {
  try {
    const { first, second, city, occasion } = parseInput(input);
    return [first, second, city, occasion].join('|').toLowerCase();
  } catch {
    return null;
  }
}
function remember(key, value) {
  if (cache.size > 100) cache.clear();
  cache.set(key, { value, expires: Date.now() + 600000 });
}

// Per-client limit on fresh plans, shared by the web app and MCP tool calls.
const LIMIT = 20, WINDOW = 600000;
const hits = new Map();
function clientId(request) {
  const forwarded = (request.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return request.headers.get('cf-connecting-ip') || forwarded.at(-1) || 'local';
}
function allow(request) {
  const id = clientId(request), now = Date.now();
  const recent = (hits.get(id) || []).filter((t) => now - t < WINDOW);
  if (recent.length >= LIMIT) { hits.set(id, recent); return false; }
  recent.push(now);
  if (hits.size > 5000) hits.clear();
  hits.set(id, recent);
  return true;
}

const qlooOrigin = (env) => ['https://api.qloo.com', 'https://hackathon.api.qloo.com'].includes(env.QLOO_API_URL) ? env.QLOO_API_URL : ORIGIN;

// Streams agent steps as they happen, then the plan: one JSON object per line.
function streamPlan(input, key, origin, cached, allowed) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (message) => controller.enqueue(encoder.encode(JSON.stringify(message) + '\n'));
      try {
        if (cached) {
          for (const step of cached.steps) send({ event: 'step', step });
          send({ event: 'result', plan: cached });
        } else if (!allowed()) {
          send({ event: 'error', error: 'Too many plans from this connection. Try again in a few minutes.' });
        } else {
          const result = await plan(input, key, origin, (step) => send({ event: 'step', step }));
          const k = cacheKey(input);
          if (k) remember(k, result);
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

async function planRoute(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env.QLOO_API_KEY) return json({ error: 'Live Qloo data is not configured yet. Try the clearly labeled sample while the key is being added.' }, 503);
  if (Number(request.headers.get('content-length') || 0) > 3000) return json({ error: 'Request is too large.' }, 413);
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const key = cacheKey(input);
  if (!key) return json({ error: 'Enter two favorites and a city.' }, 422);
  const hit = cache.get(key);
  const cached = hit && hit.expires > Date.now() ? hit.value : null;
  const origin = qlooOrigin(env);
  if ((request.headers.get('accept') || '').includes('application/x-ndjson')) return streamPlan(input, env.QLOO_API_KEY, origin, cached, () => allow(request));
  if (cached) return json(cached);
  if (!allow(request)) return json({ error: 'Too many plans from this connection. Try again in a few minutes.' }, 429);
  try {
    const result = await plan(input, env.QLOO_API_KEY, origin);
    remember(key, result);
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Plan failed.' }, 422);
  }
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname === '/api/status') return json({ live: Boolean(env.QLOO_API_KEY), occasions: Object.keys(OCCASIONS), mcp: url.origin + '/mcp' });
    if (url.pathname === '/api/plan') return planRoute(request, env);
    if (url.pathname === '/mcp') return handleMcp(request, env, qlooOrigin(env), () => allow(request));
    return json({ error: 'Not found.' }, 404);
  },
};

export { plan, bridge, balancedFilms, shares, entity, tidy };
