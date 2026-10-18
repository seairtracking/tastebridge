// A person's taste profile: favorites by section, genres, instruments and hobbies.
// Every genre id below was checked against Qloo: filtering by it returns the expected works
// (mystery books → Gone Girl, The Silent Patient; soccer → FC Barcelona, Real Madrid).
import { insights, requestQloo, rows, entity, kind } from './qloo.js';

const G = 'urn:tag:genre:media:', MU = 'urn:tag:genre:music:', SP = 'urn:tag:genre:brand:sports_organization:',
  DE = 'urn:tag:genre:destination:', BR = 'urn:tag:genre:brand:', IN = 'urn:tag:instrument:qloo:';

// `types`: what the name boxes suggest; `genreType`: the kind of work a genre chip stands for.
export const SECTIONS = [
  { id: 'film', icon: '🎬', types: ['movie'], genreType: 'movie', genres: ['action', 'comedy', 'drama', 'romance', 'horror', 'thriller', 'science_fiction', 'animation', 'fantasy', 'mystery', 'documentary', 'crime', 'family', 'adventure'].map((g) => G + g) },
  { id: 'tv', icon: '📺', types: ['tv_show'], genreType: 'tv_show', genres: ['comedy', 'drama', 'romance', 'thriller', 'science_fiction', 'animation', 'fantasy', 'mystery', 'documentary', 'crime'].map((g) => G + g) },
  { id: 'music', icon: '🎵', types: ['artist'], genreType: 'artist', genres: ['pop', 'rock', 'hip_hop', 'electronic', 'jazz', 'classical', 'r_b_soul', 'k_pop', 'indie', 'ballad', 'metal', 'lo_fi', 'edm'].map((g) => MU + g) },
  { id: 'book', icon: '📚', types: ['book', 'author'], genreType: 'book', genres: ['mystery', 'fantasy', 'romance', 'science_fiction', 'self_help', 'biography', 'history', 'young_adult', 'classics', 'nonfiction', 'manga', 'business', 'poetry', 'horror'].map((g) => G + g) },
  { id: 'game', icon: '🎮', types: ['videogame'], genreType: null, genres: [] }, // Qloo has no game genre filter that works
  { id: 'sport', icon: '🏅', types: ['brand', 'person'], genreType: 'brand', genres: ['soccer', 'football', 'basketball', 'baseball', 'hockey', 'cricket'].map((g) => SP + g) },
  { id: 'travel', icon: '✈️', types: ['destination'], genreType: 'destination', genres: ['beaches', 'nature', 'great_nightlife', 'urban_destinations', 'art_culture', 'foodie_destination', 'romantic_getaways', 'outdoor_activities'].map((g) => DE + g) },
  { id: 'brand', icon: '🏷️', types: ['brand'], genreType: 'brand', genres: ['fashion', 'retail', 'electronics', 'automotive', 'travel', 'entertainment'].map((g) => BR + g) },
];
export const INSTRUMENTS = ['guitar', 'piano', 'violin', 'drums', 'ukulele', 'saxophone', 'bass', 'flute', 'cello', 'trumpet', 'keyboards', 'synthesizers', 'vocals'].map((g) => IN + g);
// Hobbies and lifestyle are Qloo audiences. As taste signals they are noisy (photography → a comedy club), so
// they describe the person in their portrait and never steer Qloo's results. A few map to the planner's own
// filters instead (see PREFS). Religion, politics and ethnic or LGBTQ communities are left out on purpose:
// TasteBridge does not collect sensitive traits.
const AU = 'urn:audience:';
export const HOBBY_GROUPS = [
  ['hobbies', 'hobbies_and_interests', ['photography', 'hiking', 'travel', 'yoga', 'running', 'musician', 'video_gamer', 'arts_crafts', 'dance', 'meditation', 'outdoors', 'swimming', 'fishing', 'adventuring', 'adrenaline_rushers', 'casual_escapists', 'secret_unravelers', 'spy_enthusiast', 'soccer', 'basketball', 'baseball', 'american_football', 'hockey', 'tennis', 'golf', 'martial_arts', 'wrestling', 'racing', 'motorcycles', 'automotive', 'architecture', 'home_decor', 'home_organization', 'high_fashion', 'street_fashion', 'sneakerheads', 'jewellery', 'watches', 'perfume', 'health_and_beauty', 'tattoos', 'wine_enthusiast']],
  ['leisure', 'leisure', ['foodie', 'cooking', 'coffee', 'avid_reader', 'cinephile', 'museums', 'music_festivals', 'arts_culture', 'exercising', 'news_junkie']],
  ['lifestyle', 'lifestyle_preferences_beliefs', ['healthy_eating', 'veganism', 'organic_ingredients', 'astrology', 'spirituality']],
  ['spending', 'spending_habits', ['gourmand_fine_dining', 'discount_shoppers', 'boutique_hotels', 'vintage_apparel', 'technology_enthusiast', 'watch_collecting']],
  ['life', 'life_stage', ['parents_with_young_children', 'single', 'engaged', 'retirement']],
  ['work', 'professional_area', ['business_professional', 'technology_professional', 'marketing_professional', 'advertising_design', 'finance_professional', 'sales_professional', 'retail_professional', 'hospitality_professional', 'medical_professional']],
  ['investing', 'investing_interests', ['stocks_bonds', 'real_estate', 'angel_start_up_investing', 'cryptocurrency_enthusiasts', 'nft_collectors', 'art_collectibles']],
  ['causes', 'global_issues', ['climate_activism', 'sustainability', 'ocean_health', 'animal_issues', 'mental_health', 'education_issues', 'gender_equality', 'racial_justice', 'wealth_inequality', 'fair_wages', 'foreign_affairs']],
].map(([id, type, list]) => ({ id, ids: list.map((h) => AU + type + ':' + h) }));
export const HOBBIES = HOBBY_GROUPS.flatMap((g) => g.ids);
// Hobbies the planner can act on directly, with its own filters rather than Qloo signals.
const PREF_OF = {
  [AU + 'lifestyle_preferences_beliefs:veganism']: 'veg', [AU + 'lifestyle_preferences_beliefs:healthy_eating']: 'veg',
  [AU + 'spending_habits:discount_shoppers']: 'thrifty', [AU + 'spending_habits:gourmand_fine_dining']: 'fine',
  [AU + 'life_stage:parents_with_young_children']: 'kids',
};
export const profilePrefs = (profiles) => [...new Set((profiles || []).filter(Boolean).flatMap((p) => (p.hobbies || []).map((h) => PREF_OF[h]).filter(Boolean)))];
const GENRE_SECTION = new Map(SECTIONS.flatMap((s) => s.genres.map((g) => [s.id + '|' + g, s])));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PICKS = 12, MAX_GENRES = 8, PER_SECTION = 3;

// Keeps only known ids and short names, so a profile can be stored and sent back safely.
export function cleanProfile(input) {
  const out = { sections: {}, instruments: [], hobbies: [] };
  let picks = 0, genres = 0;
  for (const s of SECTIONS) {
    const raw = input?.sections?.[s.id];
    if (!raw || typeof raw !== 'object') continue;
    const p = (Array.isArray(raw.picks) ? raw.picks : []).filter((x) => UUID.test(String(x?.id || '')))
      .slice(0, PER_SECTION).filter(() => picks++ < MAX_PICKS)
      .map((x) => ({ id: String(x.id).toLowerCase(), name: String(x.name || '').trim().slice(0, 80) || '?', kind: String(x.kind || '').slice(0, 20) }));
    const g = [...new Set((Array.isArray(raw.genres) ? raw.genres : []).filter((t) => GENRE_SECTION.has(s.id + '|' + t)))]
      .slice(0, 4).filter(() => genres++ < MAX_GENRES);
    if (p.length || g.length) out.sections[s.id] = { picks: p, genres: g };
  }
  out.instruments = [...new Set((input?.instruments || []).filter((t) => INSTRUMENTS.includes(t)))].slice(0, 5);
  out.hobbies = [...new Set((input?.hobbies || []).filter((t) => HOBBIES.includes(t)))].slice(0, 20);
  return out;
}
export const profileSize = (p) => Object.values(p.sections).reduce((t, s) => t + s.picks.length + s.genres.length, 0);
// Picks first: they are what the person actually named.
export const profilePicks = (p) => Object.values(p.sections).flatMap((s) => s.picks);

// Looks up the named works (with their Qloo tags) and stands in two well-known works for each genre.
export async function resolveProfile(profile, key, origin) {
  const picks = profilePicks(profile);
  const named = picks.length ? rows(await requestQloo('/entities', { entity_ids: picks.map((x) => x.id).join(',') }, key, origin)) : [];
  const genreJobs = SECTIONS.flatMap((s) => (profile.sections[s.id]?.genres || []).map((g) => ({ s, g })));
  const reps = await Promise.all(genreJobs.map(({ s, g }) => insights({ 'filter.type': 'urn:entity:' + s.genreType, 'filter.tags': g, take: 2 }, key, origin)
    .then((list) => list.map((x) => ({ ...x, viaGenre: g }))).catch(() => [])));
  const seen = new Set(picks.map((x) => x.id));
  const stand = reps.flat().filter((x) => !seen.has(x.id) && seen.add(x.id));
  return { picks, named, stand, ids: [...picks.map((x) => x.id), ...stand.map((x) => x.id)].slice(0, 16) };
}

// "What you really like": the Qloo tags your favorites share, with the favorites that carry each one.
const PORTRAIT = [
  ['themes', /^urn:tag:theme:qloo:/],
  ['moods', /^urn:tag:(style|plot|emotional_tone|music|characteristic):qloo:/],
  ['viewer', /^urn:tag:(audience|viewer_characteristic):qloo:/],
  ['interests', /^urn:tag:(interests|lifestyle|personal_style):qloo:/],
  ['genres', /^urn:tag:(genre|subgenre):(qloo|media):/],
];
export function portrait(named) {
  const out = {};
  for (const [group, re] of PORTRAIT) {
    const count = new Map();
    for (const item of named) {
      const seen = new Set();
      for (const t of item?.tags || []) {
        const id = String(t?.tag_id || t?.id || ''), name = String(t?.name || '').trim();
        if (!re.test(id) || !name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const k = name.toLowerCase(), e = count.get(k) || { name, from: [] };
        e.from.push(item.name);
        count.set(k, e);
      }
    }
    // Shared traits first; a single favorite still says something when nothing is shared.
    out[group] = [...count.values()].sort((a, b) => b.from.length - a.from.length).slice(0, 6).map((e) => ({ name: e.name.slice(0, 40), from: e.from.slice(0, 3).map((n) => String(n).slice(0, 60)) }));
  }
  return out;
}

// "You might also like": a few works per domain that fit the whole profile, excluding what the person named.
const DISCOVER = [['movie', 'film'], ['tv_show', 'tv'], ['artist', 'music'], ['book', 'book'], ['destination', 'travel']];
export async function discover(ids, exclude, key, origin) {
  if (!ids.length) return {};
  const lists = await Promise.all(DISCOVER.map(([type]) => insights({ 'filter.type': 'urn:entity:' + type, 'signal.interests.entities': ids.join(','), 'filter.exclude.entities': exclude.join(',') || undefined, take: 4 }, key, origin).catch(() => [])));
  return Object.fromEntries(DISCOVER.map(([, section], i) => [section, lists[i].filter((x) => !exclude.includes(x.id)).slice(0, 4).map((x) => ({ id: x.id, name: x.name, kind: kind(x), image: x.image, year: x.year }))]));
}

// The whole answer for the profile sheet.
export async function tasteReport(input, key, origin) {
  const profile = cleanProfile(input);
  if (!profileSize(profile)) throw new Error('Add at least one favorite or genre.');
  const r = await resolveProfile(profile, key, origin);
  const named = r.named.map((x) => ({ name: x?.name, tags: x?.tags }));
  // Genre stand-ins count for the portrait only when the person named nothing in that area.
  const traits = portrait(named.length ? named : r.stand.map((x) => ({ name: x.name, tags: [] })));
  const found = await discover(r.ids, r.picks.map((x) => x.id), key, origin);
  return {
    profile,
    portrait: traits,
    standIns: r.stand.slice(0, 8).map((x) => ({ id: x.id, name: x.name, kind: kind(x), genre: x.viaGenre })),
    discover: found,
  };
}

// For the planner: one person's whole profile as a single Qloo signal (a comma list of entity ids).
export async function profileSeed(input, key, origin) {
  const profile = cleanProfile(input);
  if (!profileSize(profile)) return null;
  const r = await resolveProfile(profile, key, origin);
  if (!r.ids.length) return null;
  const names = r.picks.map((x) => x.name);
  const label = names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : '') : r.stand.slice(0, 2).map((x) => x.name).join(', ');
  return { id: r.ids.join(','), name: label, types: ['urn:entity:profile'], profile: true };
}

export { entity };
