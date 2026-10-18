// Qloo API client: entity parsing, a small request queue and rate-limit retries.
export const ORIGIN = 'https://hackathon.api.qloo.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const tidy = (value, limit = 90) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export function rows(payload) {
  for (const list of [payload, payload?.results?.entities, payload?.results, payload?.entities, payload?.data?.entities]) if (Array.isArray(list)) return list;
  return [];
}

// Normalises one Qloo result. `explain` holds Qloo explainability: how much each input entity drove this result.
export function entity(item) {
  const id = item?.entity_id || item?.id || item?.entity?.entity_id || item?.entity?.id;
  const name = item?.name || item?.entity?.name || item?.title;
  if (!UUID.test(id || '') || !tidy(name)) return null;
  const explain = item?.query?.explainability?.['signal.interests.entities'];
  const tags = Array.isArray(item?.tags) ? item.tags.map((t) => String(t?.id || t?.tag_id || '')) : [];
  const p = item?.properties || {};
  const price = Number(p.price_level), year = Number(p.release_year), rating = Number(p.business_rating);
  return {
    id: id.toLowerCase(),
    name: tidy(name, 100),
    address: tidy(item?.properties?.address || item?.address, 140),
    types: Array.isArray(item?.types) ? item.types.filter((t) => typeof t === 'string') : [],
    // Place categories in Qloo's order; the first is the place's main kind (e.g. "museum", "cocktail_bar").
    categories: tags.filter((t) => t.startsWith('urn:tag:category:place:')).map((t) => t.slice('urn:tag:category:place:'.length)),
    popularity: typeof item?.popularity === 'number' ? item.popularity : null,
    explain: Array.isArray(explain) ? explain.map((x) => ({ id: String(x?.entity_id || '').toLowerCase(), score: Number(x?.score) || 0 })) : [],
    // Details for the result cards: a photo or poster, rating, price level, links and film facts.
    image: safeUrl(p.image?.url || p.images?.[0]?.url, ['https:']),
    rating: rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
    price: Number.isInteger(price) && price >= 1 && price <= 4 ? price : null,
    website: safeUrl(p.website, ['https:', 'http:']),
    lat: Number.isFinite(item?.location?.lat) ? item.location.lat : null,
    lon: Number.isFinite(item?.location?.lon) ? item.location.lon : null,
    year: Number.isInteger(year) && year > 1850 && year < 2100 ? year : null,
    genres: Array.isArray(p.genres) ? p.genres.filter((g) => typeof g === 'string').slice(0, 2).map((g) => tidy(g, 30)) : [],
  };
}

// Only plain web links reach the page; anything else (javascript:, data:, malformed) is dropped.
function safeUrl(value, protocols) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try { const url = new URL(value); return protocols.includes(url.protocol) ? url.href : null; } catch { return null; }
}

// The hackathon key allows only a few requests in flight: queue calls and retry 429s with backoff.
const MAX_IN_FLIGHT = 3;
let active = 0;
const waiting = [];
async function withSlot(task) {
  while (active >= MAX_IN_FLIGHT) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try { return await task(); } finally { active--; waiting.shift()?.(); }
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestQloo(path, query, key, origin = ORIGIN) {
  const url = new URL(path, origin);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await withSlot(() => fetch(url, { headers: { 'X-Api-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(12000) }));
    } catch {
      throw new Error('Could not reach Qloo. Try again later.');
    }
    if (response.status !== 429 || attempt >= 3) break;
    await pause(700 * (attempt + 1));
  }
  if (response.status === 401 || response.status === 403) throw new Error('Qloo rejected this API key.');
  if (response.status === 429) throw new Error('Qloo rate limit reached. Try again later.');
  if (!response.ok) throw new Error('Qloo returned HTTP ' + response.status + '.');
  return response.json();
}

export async function searchEntities(name, key, origin, take = 8) {
  return rows(await requestQloo('/search', { query: name, take }, key, origin)).map(entity).filter(Boolean);
}

// Entity types that tend to carry the most taste signal in Qloo, best first.
const TYPE_ORDER = ['movie', 'tv_show', 'artist', 'book', 'videogame', 'podcast', 'brand', 'album', 'author', 'person', 'destination', 'place'];
const typeRank = (x) => {
  const i = TYPE_ORDER.indexOf((x.types.find((t) => t.startsWith('urn:entity:')) || '').slice('urn:entity:'.length));
  return i < 0 ? TYPE_ORDER.length : i;
};

// Ranked readings of a favorite: exact-name matches (by type), then titles that start with it.
// The agent falls back to the next reading when Qloo has little taste data for the first.
export async function candidates(name, key, origin) {
  const q = name.toLowerCase();
  const matches = await searchEntities(name, key, origin, 10);
  // Venues are not tastes: "Christopher Noland Salon" must never stand in for Christopher Nolan.
  const taste = matches.filter((x) => !x.types.includes('urn:entity:place'));
  const exact = taste.filter((x) => x.name.toLowerCase() === q).sort((x, y) => typeRank(x) - typeRank(y));
  const near = taste.filter((x) => x.name.toLowerCase() !== q && x.name.toLowerCase().startsWith(q) && !/[\p{L}\p{N}]/u.test(x.name[q.length] || ''));
  const list = [...exact, ...near];
  if (!list.length && matches[0]) list.push(matches[0]);
  if (!list.length) throw new Error('Qloo could not find “' + name + '”. Try a well-known artist, movie, book or show.');
  return list.slice(0, 4);
}

export async function resolveFavorite(name, key, origin) {
  return (await candidates(name, key, origin))[0];
}

export async function insights(params, key, origin) {
  return rows(await requestQloo('/v2/insights', params, key, origin)).map(entity).filter(Boolean);
}

const KINDS = { artist: 'artist', movie: 'film', book: 'book', author: 'author', tv_show: 'TV show', podcast: 'podcast', video_game: 'video game', videogame: 'video game', album: 'album', brand: 'brand', person: 'person', place: 'place', destination: 'destination' };
export function kind(item) {
  const type = (item?.types || []).find((t) => t.startsWith('urn:entity:'));
  return KINDS[type?.slice('urn:entity:'.length)] || 'favorite';
}
