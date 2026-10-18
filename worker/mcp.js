// Minimal MCP server (Streamable HTTP, JSON responses) so AI agents such as Claude or ChatGPT
// can call TasteBridge as a tool. Stateless: every POST /mcp carries one JSON-RPC message or a batch.
import { plan, OCCASIONS } from './engine.js';
import { evening, CUISINES, MOODS, SPECIALS } from './evening.js';
import { searchEntities, kind } from './qloo.js';

const PROTOCOL = '2025-06-18';
const SERVER = { name: 'tastebridge', title: 'TasteBridge', version: '2.1.0' };

const TOOLS = [
  {
    name: 'find_common_ground',
    title: 'Find common ground for two tastes',
    description: 'Plan an outing for one to four people (solo, a pair or a group) with different cultural tastes. Give one favorite from each person (an artist, film, book, TV show or game) and a city. TasteBridge uses the Qloo taste graph to find places that fit each person and both together, refines the search when there is too little overlap, and returns a fair shortlist: each place shows how much it is driven by each person (Qloo explainability), plus films that sit between both tastes. Use it when friends, couples or groups disagree about where to go.',
    inputSchema: {
      type: 'object',
      properties: {
        favorites: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, description: 'One favorite per person, 1 to 4 people (an artist, film, book, TV show or game). Use this for a solo plan or a group.' },
        names: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Optional display names in the same order as favorites, e.g. ["Me", "Lan"].' },
        first: { type: 'string', description: 'Person one’s favorite: an artist, film, book, TV show or game, e.g. "Spirited Away".' },
        second: { type: 'string', description: 'Person two’s favorite, e.g. "Daft Punk".' },
        city: { type: 'string', description: 'City to explore, e.g. "New York" or "Ho Chi Minh City".' },
        occasion: { type: 'string', enum: Object.keys(OCCASIONS), description: 'Kind of outing. Defaults to dinner.' },
      },
      required: ['city'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'plan_evening',
    title: 'Plan a whole evening for two',
    description: 'Plan an evening after work for one to four people (solo, a pair or a group): dinner that fits both tastes (optionally a cuisine, a mood and a budget), a second stop within walking distance, a live music or show venue nearby, and a film for home. Every stop is ranked for fairness with Qloo explainability, with photos, ratings, price level, map and website links, walking time and opening hours where Qloo has them. Give a city, or a latitude and longitude for "near me". Qloo has no event listings, so show venues link to their own programme.',
    inputSchema: {
      type: 'object',
      properties: {
        favorites: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, description: 'One favorite per person, 1 to 4 people (an artist, film, book, TV show or game). Use this for a solo plan or a group.' },
        names: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Optional display names in the same order as favorites, e.g. ["Me", "Lan"].' },
        first: { type: 'string', description: 'Person one’s favorite: an artist, film, book, TV show or game.' },
        second: { type: 'string', description: 'Person two’s favorite.' },
        city: { type: 'string', description: 'City to plan in. Optional when lat and lon are given.' },
        lat: { type: 'number', description: 'Latitude to start near (for example the office).' },
        lon: { type: 'number', description: 'Longitude to start near.' },
        start: { type: 'string', description: 'Dinner time as HH:MM, e.g. "18:30". Defaults to 18:30.' },
        day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], description: 'Day of the week, used to check opening hours.' },
        cuisine: { type: 'string', enum: CUISINES, description: 'What to eat.' },
        mood: { type: 'string', enum: MOODS, description: 'The feel of the evening.' },
        special: { type: 'string', enum: Object.keys(SPECIALS), description: 'A special occasion: birthday, anniversary, first date, date night, celebration, friends reunion, family or business dinner.' },
        budget: { type: 'integer', minimum: 1, maximum: 4, description: 'Highest price level, 1 ($) to 4 ($$$$).' },
      },
      required: [],
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

// Labels and share text for one to four people.
const label = (p, i) => p.seeds[i].person || p.seeds[i].name;
const forWhom = (p) => (p.seeds.length === 1 ? `a fan of ${p.seeds[0].name}` : p.seeds.map((s) => `a fan of ${s.name}`).join(p.seeds.length === 2 ? ' and ' : ', '));
const pctOf = (p) => (x) => (x?.shares ? ` (${x.shares.map((v, i) => `${v}% ${label(p, i)}`).join(' / ')})` : '');

function summary(p) {
  const pct = pctOf(p);
  const lines = [
    `${p.occasionLabel} in ${p.city} for ${forWhom(p)}:`,
    ...p.places.map((x, i) => {
      const facts = [x.category, x.rating ? `★${x.rating}` : '', x.price ? '$'.repeat(x.price) : ''].filter(Boolean).join(', ');
      const links = [x.map && `map: ${x.map}`, x.website && `website: ${x.website}`].filter(Boolean).join(' · ');
      return `${i + 1}. ${x.name}${facts ? ` [${facts}]` : ''}${x.address ? ` — ${x.address}` : ''}${pct(x)}. ${x.reason}${links ? ` (${links})` : ''}`;
    }),
    `${p.seeds.length === 1 ? 'Watch' : 'Watch together'}: ${p.films.map((f) => f.name + (f.year ? ` (${f.year})` : '') + pct(f)).join('; ') || 'no film found'}. ${p.filmNote}`,
    ...(p.warning ? [`Note: ${p.warning}`] : []),
    `How the agent decided: ${p.steps.map((s) => s.detail).join(' ')}`,
  ];
  return lines.join('\n');
}

function eveningSummary(p) {
  const pct = pctOf(p);
  const place = (x) => {
    const facts = [x.category, x.rating ? `★${x.rating}` : '', x.price ? '$'.repeat(x.price) : '', x.walk ? `${x.walk.minutes} min walk` : '', x.open === 'open' ? 'open then' : '', x.liveMusic ? 'live music' : ''].filter(Boolean).join(', ');
    const links = [x.map && `map: ${x.map}`, x.website && `website: ${x.website}`].filter(Boolean).join(' · ');
    return `${x.name}${facts ? ` [${facts}]` : ''}${pct(x)}${links ? ` (${links})` : ''}`;
  };
  return [
    `An evening ${p.city === 'near you' ? 'near you' : 'in ' + p.city} from ${p.start} for ${forWhom(p)}${p.cuisine ? `, ${p.cuisine} food` : ''}${p.mood ? `, ${p.mood} mood` : ''}${p.specialLabel ? `, for a ${p.specialLabel.toLowerCase()}` : ''}:`,
    ...p.stops.map((s) => `${s.time} ${s.title}: ${place(s.options[0])}${s.options.length > 1 ? `. Or: ${s.options.slice(1).map((x) => x.name).join(', ')}` : ''}.`),
    `Back home: ${p.films.map((f) => f.name + (f.year ? ` (${f.year})` : '') + pct(f)).join('; ') || 'no film found'}.`,
    ...(p.tip ? [`Tip: ${p.tip}`] : []),
    'Qloo has no event listings, so check the show venue’s website for tonight’s programme.',
    ...(p.warning ? [`Note: ${p.warning}`] : []),
    `How the agent decided: ${p.steps.map((s) => s.detail).join(' ')}`,
  ].join('\n');
}

async function callTool(name, args, env, origin) {
  if (name === 'plan_evening') {
    const result = await evening(args, env.QLOO_API_KEY, origin);
    return { content: [{ type: 'text', text: eveningSummary(result) }], structuredContent: result };
  }
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
        instructions: 'Ask each person for one cultural favorite and agree on a city. For a whole evening (dinner, a nearby second stop, a show, a film) call plan_evening; for a quick shortlist call find_common_ground. Present the shortlist with each person’s share so both can see it is fair.',
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
