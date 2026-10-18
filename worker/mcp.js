// Minimal MCP server (Streamable HTTP, JSON responses) so AI agents such as Claude or ChatGPT
// can call TasteBridge as a tool. Stateless: every POST /mcp carries one JSON-RPC message or a batch.
import { plan, OCCASIONS } from './engine.js';
import { searchEntities, kind } from './qloo.js';

const PROTOCOL = '2025-06-18';
const SERVER = { name: 'tastebridge', title: 'TasteBridge', version: '2.0.0' };

const TOOLS = [
  {
    name: 'find_common_ground',
    title: 'Find common ground for two tastes',
    description: 'Plan an outing for two people with different cultural tastes. Give one favorite from each person (an artist, film, book, TV show or game) and a city. TasteBridge uses the Qloo taste graph to find places that fit each person and both together, refines the search when there is too little overlap, and returns a fair shortlist: each place shows how much it is driven by each person (Qloo explainability), plus films that sit between both tastes. Use it when friends, couples or groups disagree about where to go.',
    inputSchema: {
      type: 'object',
      properties: {
        first: { type: 'string', description: 'Person one’s favorite: an artist, film, book, TV show or game, e.g. "Spirited Away".' },
        second: { type: 'string', description: 'Person two’s favorite, e.g. "Daft Punk".' },
        city: { type: 'string', description: 'City to explore, e.g. "New York" or "Ho Chi Minh City".' },
        occasion: { type: 'string', enum: Object.keys(OCCASIONS), description: 'Kind of outing. Defaults to dinner.' },
      },
      required: ['first', 'second', 'city'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'resolve_favorite',
    title: 'Check what a favorite matches in Qloo',
    description: 'Look up how Qloo understands a favorite before planning, to disambiguate names (for example a film versus a book with the same title). Returns the top Qloo matches with their type.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'A favorite artist, film, book, TV show or game.' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

function summary(p) {
  const pct = (s) => (s ? ` (${s.a}% ${p.seeds[0].name} / ${s.b}% ${p.seeds[1].name})` : '');
  const lines = [
    `${p.occasionLabel} in ${p.city} for a fan of ${p.seeds[0].name} and a fan of ${p.seeds[1].name}:`,
    ...p.places.map((x, i) => {
      const facts = [x.category, x.rating ? `★${x.rating}` : '', x.price ? '$'.repeat(x.price) : ''].filter(Boolean).join(', ');
      const links = [x.map && `map: ${x.map}`, x.website && `website: ${x.website}`].filter(Boolean).join(' · ');
      return `${i + 1}. ${x.name}${facts ? ` [${facts}]` : ''}${x.address ? ` — ${x.address}` : ''}${pct(x.share)}. ${x.reason}${links ? ` (${links})` : ''}`;
    }),
    `Watch together: ${p.films.map((f) => f.name + (f.year ? ` (${f.year})` : '') + pct(f.share)).join('; ') || 'no film found'}. ${p.filmNote}`,
    ...(p.warning ? [`Note: ${p.warning}`] : []),
    `How the agent decided: ${p.steps.map((s) => s.detail).join(' ')}`,
  ];
  return lines.join('\n');
}

async function callTool(name, args, env, origin) {
  if (name === 'find_common_ground') {
    const result = await plan(args, env.QLOO_API_KEY, origin);
    return { content: [{ type: 'text', text: summary(result) }], structuredContent: result };
  }
  if (name === 'resolve_favorite') {
    const text = typeof args?.name === 'string' ? args.name.trim().slice(0, 70) : '';
    if (text.length < 2) throw new Error('Give a favorite name with at least two characters.');
    const matches = (await searchEntities(text, env.QLOO_API_KEY, origin, 5)).map((m) => ({ id: m.id, name: m.name, kind: kind(m) }));
    return { content: [{ type: 'text', text: matches.length ? matches.map((m) => `${m.name} (${m.kind})`).join('\n') : 'No Qloo match.' }], structuredContent: { matches } };
  }
  return null;
}

async function handle(message, env, origin, allow) {
  const { id, method, params } = message || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, msg) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: msg } });
  if (message?.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid request.');
  if (id === undefined) return null; // notifications (e.g. notifications/initialized) need no reply
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: 'Ask each person for one cultural favorite and agree on a city, then call find_common_ground. Present the shortlist with each person’s share so both can see it is fair.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      if (!env.QLOO_API_KEY) return reply({ content: [{ type: 'text', text: 'Live Qloo data is not configured on this server.' }], isError: true });
      if (!allow()) return reply({ content: [{ type: 'text', text: 'Too many requests from this client. Try again in a few minutes.' }], isError: true });
      try {
        const result = await callTool(params?.name, params?.arguments || {}, env, origin);
        return result ? reply(result) : fail(-32602, `Unknown tool: ${params?.name}`);
      } catch (error) {
        return reply({ content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed.' }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept, mcp-protocol-version, mcp-session-id', 'access-control-expose-headers': 'mcp-session-id' };

export async function handleMcp(request, env, origin, allow) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Use POST with a JSON-RPC message.' }), { status: 405, headers: { ...CORS, allow: 'POST', 'content-type': 'application/json' } });
  if (Number(request.headers.get('content-length') || 0) > 20000) return new Response(null, { status: 413, headers: CORS });
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } });
  }
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).slice(0, 10).map((m) => handle(m, env, origin, allow)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return new Response(JSON.stringify(batch ? replies : replies[0]), { headers: { ...CORS, 'content-type': 'application/json' } });
}

export { TOOLS };
