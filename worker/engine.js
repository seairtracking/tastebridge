// TasteBridge planning agent: understands two tastes through Qloo, searches for an occasion,
// refines the search when there is not enough common ground, and ranks a fair plan for both people.
import { ORIGIN, tidy, candidates, insights, kind } from './qloo.js';
import { cleanProfile, profileSize, profileSeed, profilePrefs } from './taste.js';
import { familyFriendly } from './family.js';

// `fits` matches the Qloo place categories that really suit the occasion; Qloo's tag filter alone is loose
// (a museum that also has a bar counts as a bar).
export const OCCASIONS = {
  dinner: { label: 'Dinner', plural: 'restaurants', tag: 'urn:tag:category:place:restaurant', fits: /restaurant|bistro|brasserie|steakhouse|eatery|diner|gastropub|izakaya|trattoria|food_court/ },
  drinks: { label: 'Drinks', plural: 'bars', tag: 'urn:tag:category:place:bar', fits: /bar$|bar_|pub|lounge|brewery|taproom|tavern|speakeasy|winery|beer/ },
  culture: { label: 'Culture', plural: 'museums and galleries', tag: 'urn:tag:category:place:museum', fits: /museum|gallery|art|theater|theatre|cultural|exhibit|histor|library|opera|concert_hall|monument/ },
  'night-out': { label: 'Night out', plural: 'night spots', tag: 'urn:tag:category:place:night_club', fits: /club|disco|music_venue|live_music|comedy|karaoke|lounge|jazz|cabaret|bar$|bar_|dance/ },
  coffee: { label: 'Coffee', plural: 'cafés', tag: 'urn:tag:category:place:cafe', fits: /cafe|coffee|tea|bakery|patisserie|dessert/ },
};

// 1 when the place's main category suits the occasion, less when it is only a side category.
export function occasionFit(categories, fits) {
  if (!fits || !categories?.length) return 1;
  if (fits.test(categories[0])) return 1;
  if (categories.slice(1, 3).some((c) => fits.test(c))) return 0.75;
  return 0.4;
}

// Each attempt is tried until at least three shared candidates exist.
const PLACE_ATTEMPTS = [
  { radius: 15000, quality: 'medium', tag: true },
  { radius: 40000, quality: null, tag: true, whyKey: 'why.widen40', why: 'widened the search to 40 km and relaxed the quality filter' },
  { radius: 40000, quality: null, tag: false, whyKey: 'why.anyPlace', why: 'dropped the occasion filter to look at any kind of place' },
];

// Accent- and case-insensitive text, so "Hồ Chí Minh" matches "Ho Chi Minh City".
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
// Spaces are dropped too, so "Hanoi" matches "Hà Nội" and "New York" matches "New York, NY".
// Local spellings that addresses use, so "Lisbon" matches "Lisboa".
const CITY_ALIASES = {
  lisbon: 'lisboa', munich: 'munchen', rome: 'roma', prague: 'praha', vienna: 'wien', florence: 'firenze', milan: 'milano',
  naples: 'napoli', venice: 'venezia', cologne: 'koln', copenhagen: 'kobenhavn', warsaw: 'warszawa', athens: 'athina',
  seville: 'sevilla', brussels: 'bruxelles', saigon: 'hochiminh', hochiminh: 'saigon', mexico: 'cdmx', thehague: 'denhaag',
  // short names people type: "TP HCM", "HCM", "SG", "HN", "NYC"...
  hcm: 'hochiminh|saigon', hcmc: 'hochiminh|saigon', tphcm: 'hochiminh|saigon', sg: 'hochiminh|saigon', hn: 'hanoi', nyc: 'newyork', sf: 'sanfrancisco',
};
export function cityKey(city) {
  const key = fold(city).replace(/\b(city|thanh pho|tp\.?)\b/g, ' ').replace(/[^a-z0-9]/g, '');
  return CITY_ALIASES[key] ? `${key}|${CITY_ALIASES[key]}` : key;
}
// Qloo can read "New York" as the whole state; places whose address names the city are preferred.
export function inCity(address, key) {
  if (!address || !key) return true;
  const text = fold(address).replace(/[^a-z0-9]/g, '');
  return key.split('|').some((k) => text.includes(k));
}

// What a result card needs beyond the name: a photo, rating, price level, a map link and the website.
export function placeDetails(x) {
  const query = [x.name, x.address].filter(Boolean).join(', ') || (x.lat != null ? `${x.lat},${x.lon}` : '');
  return {
    image: x.image || null, rating: x.rating ?? null, price: x.price ?? null, website: x.website || null, lat: x.lat ?? null, lon: x.lon ?? null,
    map: query ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) : null,
  };
}
export const filmDetails = (f) => ({ image: f.image || null, year: f.year ?? null, genres: f.genres || [] });

// Plans are for friends, couples and colleagues: adult entertainment venues are never suggested.
// Qloo files some of them as ordinary night clubs, so names are checked as well as categories.
const ADULT_NAME = /\b(strip ?clubs?|strippers?|gentlemen'?s club|male revue|hunk-?o-?mania|chippendales|topless|erotic|xxx|peep ?show)\b/i;
export function adultVenue(x) {
  return (x?.categories || []).some((c) => /^adult_entertainment|strip_club/.test(c)) || (x?.ambience || []).includes('adult') || ADULT_NAME.test(x?.name || '');
}

// Each person's share of a result in percent (summing to 100), from Qloo explainability.
// A person with a taste profile is one signal made of several entities ("id1,id2,..."). Their share uses the
// favorite that fits this result best, so naming five favorites neither outweighs nor dilutes a friend who named one.
export function shareList(item, ids) {
  const scores = ids.map((id) => Math.max(0, ...String(id).split(',').map((one) => item?.explain?.find((x) => x.id === one)?.score || 0)));
  const total = scores.reduce((t, v) => t + v, 0);
  return total > 0 ? percents(scores.map((v) => v / total)) : null;
}
// Largest-remainder rounding, so the percentages always add up to exactly 100.
export function percents(fractions) {
  const raw = fractions.map((f) => f * 100), out = raw.map(Math.floor);
  let rest = 100 - out.reduce((t, v) => t + v, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]).forEach(([, i]) => { if (rest > 0) { out[i]++; rest--; } });
  return out;
}
// Two-person form kept for older clients.
export function shares(item, aId, bId) {
  const s = shareList(item, [aId, bId]);
  return s ? { a: s[0], b: s[1] } : null;
}
const asPair = (s) => (s && s.length === 2 ? { a: s[0], b: s[1] } : null);
export const M = (k, v = {}) => ({ k, v });
export const PREF_TEXT = { veg: 'Vegetarian and vegan dishes come first.', thrifty: 'Places that are easy on the wallet come first.', fine: 'Fine dining comes first.', kids: 'Family-friendly places, for a parent of young children.' };
export const who = (n) => (n === 1 ? 'you' : n === 2 ? 'both of you' : 'everyone');

// Fairness-weighted reciprocal-rank ranking over each person's list and the combined list (1 to 4 people).
export function bridgeN(lists, joint, { seeds = [], take = 4, city = '', fits = null, boost = () => 1, extra = () => ({}), seen = {} } = {}) {
  const key = cityKey(city), n = lists.length;
  const rank = (list) => new Map(list.map((x, i) => [x.id, i + 1]));
  const ranks = lists.map(rank), rj = rank(joint);
  const pool = new Map([...lists.flat(), ...joint].map((x) => [x.id, x])); // combined entries win: they carry explainability
  return [...pool.values()].filter((x) => !adultVenue(x) && seen[x.id] !== -1).map((x) => {
    const r = ranks.map((m) => m.get(x.id) || null), jr = rj.get(x.id) || null;
    const v = r.map((k) => (k ? 1 / (4 + k) : 0)), jv = jr ? 1 / (4 + jr) : 0;
    const sum = v.reduce((t, y) => t + y, 0);
    let score = Math.min(...v) * 6 + sum * 0.8 * (2 / n) + jv * 1.3;
    const mainstream = (x.popularity ?? 0) >= 0.995;
    if (mainstream) score *= 0.85; // nudge away from the most generic landmarks
    if (!inCity(x.address, key)) score *= 0.35; // outside the city the user asked for
    score *= occasionFit(x.categories, fits); // e.g. a museum with a bar is not really a drinks spot
    score *= boost(x); // evening plans: mood, cuisine, distance, opening hours, budget
    if (seen[x.id] === 1) score *= 0.6; // been there: still possible, but somewhere new comes first
    const split = n > 1 ? shareList(x, seeds) || (sum > 0 ? percents(v.map((y) => y / sum)) : null) : null;
    const present = r.filter(Boolean).length;
    const reasonKey = n === 1 ? 'reason.solo' : n !== 2 ? null : present === n ? 'reason.both' : jr ? 'reason.joint' : 'reason.one';
    const reason = n === 1 ? 'A strong match for your taste.'
      : present === n ? (n === 2 ? 'In both people’s individual Qloo lists.' : 'In everyone’s individual Qloo lists.')
      : jr ? `In Qloo’s combined-taste list for the ${n === 2 ? 'pair' : 'group'}.`
      : n === 2 ? 'A strong pick for one person.' : `A strong pick for ${present} of ${n} people.`;
    const fit = occasionFit(x.categories, fits);
    return { id: x.id, name: x.name, address: x.address, category: (x.categories?.[0] || '').replace(/_/g, ' '), ...placeDetails(x), ...extra(x), been: seen[x.id] === 1, reasonKey, ranks: r, aRank: r[0], bRank: r[1] ?? null, jointRank: jr, shares: split, share: asPair(split), mainstream, fit, reason, score };
  }).sort((x, y) => y.score - x.score)
    .filter((x, i, all) => all.findIndex((y) => y.name.toLowerCase() === x.name.toLowerCase()) === i)
    .slice(0, take)
    .map(({ score, ...x }) => x);
}
export const bridge = (a, b, joint, opts) => bridgeN([a, b], joint, opts);

// Films whose Qloo explainability is closest to an even split between everyone.
export function balancedFilms(list, ids, exclude = new Set(), take = 3) {
  return list.filter((f) => !exclude.has(f.id)).map((f, i) => {
    const split = ids.length > 1 ? shareList(f, ids) : null;
    const balance = ids.length === 1 ? 1 : split ? Math.min(...split) / Math.max(...split) : 0;
    return { id: f.id, name: f.name, ...filmDetails(f), shares: split, share: asPair(split), score: balance - i * 0.01 };
  }).sort((x, y) => y.score - x.score).slice(0, take).map(({ score, ...f }) => f);
}

// A side list that fails (Qloo can reject some signals) should not sink the whole plan.
export const soft = (promise) => promise.catch(() => []);

// One to four favorites, from `favorites` or the older `first`/`second` fields; names are optional labels.
export function readFavorites(input) {
  const raw = Array.isArray(input?.favorites) ? input.favorites : [input?.first, input?.second];
  const favorites = raw.map((f) => tidy(f, 70)).filter(Boolean);
  if (!favorites.length || favorites.some((f) => f.length < 2)) throw new Error('Enter at least one favorite.');
  if (favorites.length > 4) throw new Error('Plan for up to four people.');
  const names = Array.isArray(input?.names) ? favorites.map((_, i) => tidy(input.names[i], 40) || null) : [];
  const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const picks = Array.isArray(input?.picks) ? favorites.map((_, i) => (UUIDISH.test(String(input.picks[i] || '')) ? String(input.picks[i]).toLowerCase() : null)) : [];
  // A detailed taste profile can stand in for a person's favorite (see taste.js).
  const profiles = Array.isArray(input?.profiles) ? favorites.map((_, i) => (input.profiles[i] && typeof input.profiles[i] === 'object' ? cleanProfile(input.profiles[i]) : null)).map((p) => (p && profileSize(p) ? p : null)) : [];
  return { favorites, names, picks, profiles };
}

export function parseInput(input) {
  const { favorites, names } = readFavorites(input);
  const city = tidy(input?.city, 70);
  const occasion = Object.hasOwn(OCCASIONS, input?.occasion) ? input.occasion : 'dinner';
  if (city.length < 2) throw new Error('Enter a city.');
  const { picks, profiles } = readFavorites(input);
  return { favorites, names, picks, profiles, first: favorites[0], second: favorites[1] || '', city, occasion };
}

// Resolves every favorite and checks that each one really shapes Qloo's results.
export async function understandAll(favorites, key, origin, step, picks = [], profiles = []) {
  const n = favorites.length;
  step('resolve', n === 1 ? 'Understanding your taste' : n === 2 ? 'Understanding both tastes' : 'Understanding everyone’s tastes',
    `Looking up ${favorites.map((f) => `“${f}”`).join(n === 2 ? ' and ' : ', ')} in Qloo’s taste graph.`,
    n === 1 ? { l: M('s.resolve.l1'), d: [M('s.resolve.d1', { a: favorites[0] })] } : n === 2 && { l: M('s.resolve.l'), d: [M('s.resolve.d', { a: favorites[0], b: favorites[1] })] });
  // A profile is already a precise set of works, so it is used as it is, with no other readings to fall back on.
  const pools = await Promise.all(favorites.map(async (f, i) => {
    const seed = profiles[i] ? await profileSeed(profiles[i], key, origin).catch(() => null) : null;
    return seed ? [seed] : candidates(f, key, origin, 10);
  }));
  // A reading the person picked from the suggestions goes first, if Qloo search still returns it.
  pools.forEach((pool, i) => { const j = picks[i] ? pool.findIndex((x) => x.id === picks[i]) : -1; if (j > 0) pool.unshift(...pool.splice(j, 1)); });
  const seeds = [];
  for (const pool of pools) {
    const pick = pool.find((x) => !seeds.some((s) => s.id === x.id));
    if (!pick) throw new Error('Choose a different favorite for each person.');
    seeds.push(pick);
  }
  step('resolved', n === 1 ? 'Taste identified' : 'Tastes identified', seeds.map((s) => `${s.name} (${kind(s)})`).join(n === 2 ? ' and ' : ', ') + '.',
    n === 1 ? { l: M('s.resolved.l1'), d: [M('s.resolved.d1', { a: seeds[0].name, ka: kind(seeds[0]) })] }
      : n === 2 && { l: M('s.resolved.l'), d: [M('s.resolved.d', { a: seeds[0].name, ka: kind(seeds[0]), b: seeds[1].name, kb: kind(seeds[1]) })] });

  const probe = () => soft(insights({ 'filter.type': 'urn:entity:movie', 'signal.interests.entities': seeds.map((s) => s.id).join(','), 'feature.explainability': 'true', take: 20 }, key, origin));
  let filmList = await probe(), warning = '', warningKey = null;
  if (n === 1) return { seeds, filmList, warning, warningKey };

  // Signal check: some Qloo entities (e.g. an album or a person page) barely shape recommendations.
  // The combined film list shows each favorite's influence; a silent favorite is swapped for its next reading.
  step('check', n === 2 ? 'Checking both tastes carry signal' : 'Checking every taste carries signal', `Asking Qloo for films that fit ${who(n)}, to confirm each favorite really shapes the results.`,
    n === 2 && { l: M('s.check.l'), d: [M('s.check.d')] });
  const fair = 100 / n;
  for (let tries = 0; ; tries++) {
    const splits = filmList.map((f) => shareList(f, seeds.map((s) => s.id))).filter(Boolean);
    if (!splits.length) break;
    const means = seeds.map((_, i) => splits.reduce((t, s) => t + s[i], 0) / splits.length);
    const i = means.indexOf(Math.min(...means));
    if (means[i] >= fair * 0.1) break; // 5% for two people
    const weak = seeds[i], pool = pools[i];
    const taken = (x) => seeds.some((s, j) => j !== i && s.id === x.id);
    const next = pool.slice(pool.indexOf(weak) + 1).find((x) => !taken(x));
    if (!next || tries >= 3) {
      // Nothing better: go back to the first reading so the plan names what the person actually typed.
      const original = pool.find((x) => !taken(x));
      const others = seeds.filter((_, j) => j !== i).map((s) => s.name).join(', ');
      warning = `Qloo has little film-taste data linked to ${original.name} (${kind(original)}), so the film picks lean toward ${others}. A specific work, such as a film or album, usually gives a fairer result.`;
      warningKey = M('warn.weak', { name: original.name, k: kind(original), others });
      step('refine', 'Weak taste signal', warning, { l: M('s.weak.l'), d: [warningKey] });
      if (original.id !== weak.id) { seeds[i] = original; filmList = await probe(); }
      break;
    }
    step('refine', 'Weak taste signal', `Qloo has little taste data for “${weak.name}” as a ${kind(weak)}, so the agent switched to ${next.name} (${kind(next)}).`,
      { l: M('s.weak.l'), d: [M('s.switch.d', { weak: weak.name, wk: kind(weak), next: next.name, nk: kind(next) })] });
    seeds[i] = next;
    filmList = await probe();
  }
  return { seeds, filmList, warning, warningKey };
}

// Two-person form used by older callers.
export async function understand(first, second, key, origin, step) {
  const { seeds, filmList, warning } = await understandAll([first, second], key, origin, step);
  return { a: seeds[0], b: seeds[1], filmList, warning };
}

// Films closest to an even split; falls back to one film per person when there is no shared film taste.
export async function pickFilms(filmList, seeds, key, origin, step) {
  const n = seeds.length, ids = seeds.map((s) => s.id);
  step('films', n === 1 ? 'Finding a film for you' : n === 2 ? 'Finding a film for both' : 'Finding a film for the group',
    n === 1 ? 'Asking Qloo which films fit your taste.' : 'Asking Qloo which films sit between everyone’s tastes, then keeping the most evenly shared ones.',
    n === 1 ? { l: M('s.films.l1'), d: [M('s.films.d1')] } : n === 2 && { l: M('s.films.l'), d: [M('s.films.d')] });
  let films = balancedFilms(filmList, ids, new Set(ids));
  if (n === 1) return { films, filmNote: 'Films that fit your taste, according to Qloo.', filmNoteKey: M('film.solo') };
  let filmNote = `Films closest to an even split between ${n === 2 ? 'both tastes' : 'everyone’s tastes'}, according to Qloo explainability.`;
  let filmNoteKey = n === 2 ? M('film.even') : null;
  const best = films[0]?.shares ? Math.min(...films[0].shares) : 0;
  if (best < (100 / n) * 0.3) { // 15% for two people
    // Almost no shared film taste: one pick for each person instead of pretending there is overlap.
    step('refine', 'Little film overlap', 'Qloo’s combined film list leans almost entirely to one person, so the agent picks a film for each of them.', n === 2 && { l: M('s.gap.l'), d: [M('s.gap.d')] });
    const own = await Promise.all(ids.map((id) => soft(insights({ 'filter.type': 'urn:entity:movie', 'signal.interests.entities': id, take: 5 }, key, origin))));
    const skip = new Set(ids), picks = [];
    own.forEach((list, i) => {
      const f = list.find((x) => !skip.has(x.id) && !picks.some((p) => p.id === x.id));
      if (f) { const s = ids.map((_, j) => (j === i ? 100 : 0)); picks.push({ id: f.id, name: f.name, ...filmDetails(f), shares: s, share: asPair(s), for: seeds[i].name }); }
    });
    if (picks.length === n) { films = picks; filmNote = 'Qloo found little shared film taste, so here is one pick for each of you.'; filmNoteKey = n === 2 ? M('film.each') : null; }
    else if (picks.length) {
      films = [...picks, ...films.filter((f) => !picks.some((p) => p.id === f.id))].slice(0, Math.max(3, picks.length));
      filmNote = `Qloo found little shared film taste, so the first ${picks.length === 1 ? 'pick is' : 'picks are'} for ${picks.map((p) => p.for).join(', ')} and the others are the closest shared films.`;
      filmNoteKey = n === 2 ? M('film.firstFor', { name: picks.map((p) => p.for).join(', ') }) : null;
    } else { filmNote = `Qloo found little shared film taste for this ${n === 2 ? 'pair' : 'group'}; these lean toward one person.`; filmNoteKey = n === 2 ? M('film.none') : null; }
  }
  return { films, filmNote, filmNoteKey };
}

export const seedSummary = (seeds, names = []) => seeds.map((s, i) => ({ id: s.id, name: s.name, kind: kind(s), person: names[i] || null }));

export async function plan(input, key, origin = ORIGIN, onStep = () => {}) {
  const { favorites, names, picks, profiles, city, occasion } = parseInput(input);
  const seen = input?.seen && typeof input.seen === 'object' ? input.seen : {};
  const occ = OCCASIONS[occasion];
  const steps = [];
  const step = (id, label, detail, t) => { const s = { id, label, detail, ...(t ? { t } : {}) }; steps.push(s); onStep(s); };

  const { seeds, filmList, warning, warningKey } = await understandAll(favorites, key, origin, step, picks, profiles);
  const n = seeds.length, ids = seeds.map((s) => s.id);
  // Profile hobbies the planner can act on: vegetarian food first at dinner, price, and no bars for young kids.
  const prefs = profilePrefs(profiles).filter((p) => p !== 'veg' || occasion === 'dinner');
  if (prefs.length) step('profile', 'Using your taste profile', prefs.map((p) => PREF_TEXT[p]).join(' '), { l: M('s.prefs.l'), d: prefs.map((p) => M('pref.' + p)) });
  const boost = (x) => {
    let f = 1;
    if (prefs.includes('veg')) f *= x.cuisines?.some((c) => /vegetarian|vegan/.test(c)) ? 1.6 : 1;
    if (prefs.includes('thrifty') && x.price) f *= x.price >= 3 ? 0.6 : 1.1;
    if (prefs.includes('fine') && x.price) f *= x.price >= 3 ? 1.3 : x.price <= 1 ? 0.7 : 1;
    return f;
  };
  const kidsOk = (p) => !prefs.includes('kids') || familyFriendly(p.category, p.name);

  // A good pick is in the city and is mainly the kind of place the occasion calls for.
  const good = (list) => list.filter((p) => inCity(p.address, cityKey(city)) && p.fit === 1).length;
  let places = [], strong = -1;
  for (const [i, attempt] of PLACE_ATTEMPTS.entries()) {
    if (i > 0) step('refine', 'Not enough common ground yet', `Found ${strong} of the 3 strong ${occ.plural} in ${city} it wants, so the agent ${attempt.why}.`,
      n <= 2 && { l: M('s.thin.l'), d: [M('s.thin.d', { count: strong, occ: occasion, city, why: M(attempt.whyKey) })] });
    else step('places', `Searching ${occ.plural} in ${city}`, n === 1 ? `Asking Qloo what fits your taste within ${attempt.radius / 1000} km.` : `Asking Qloo what fits each person on their own, and what fits ${who(n)} together, within ${attempt.radius / 1000} km.`,
      n <= 2 && { l: M('s.places.l', { occ: occasion, city }), d: [M(n === 1 ? 's.places.d1' : 's.places.d', { km: attempt.radius / 1000 })] });
    const base = { 'filter.type': 'urn:entity:place', 'filter.location.query': city, 'filter.location.radius': attempt.radius, take: 25 };
    if (attempt.tag) base['filter.tags'] = occ.tag;
    if (attempt.quality) base['bias.quality'] = attempt.quality;
    const own = (id) => insights({ ...base, 'signal.interests.entities': id }, key, origin);
    const [lists, joint] = await Promise.all([
      Promise.all(ids.map((id) => (n === 1 ? own(id) : soft(own(id))))),
      n > 1 ? insights({ ...base, 'signal.interests.entities': ids.join(','), 'feature.explainability': 'true' }, key, origin) : Promise.resolve([]),
    ]);
    // Rank a wider pool, then drop places that are clearly the wrong kind when enough right ones exist.
    const pool = bridgeN(lists, joint, { seeds: ids, city, fits: occ.fits, take: 12, seen, boost }).filter(kidsOk);
    // Places that are mainly the right kind lead; the rest keep their fairness order behind them.
    const suited = pool.filter((p) => p.fit >= 0.75 && inCity(p.address, cityKey(city))).sort((x, y) => (y.fit === 1) - (x.fit === 1));
    const found = (suited.length >= 3 ? suited : pool).slice(0, 4);
    if (good(found) > strong || (!places.length && found.length)) { places = found; strong = good(found); }
    if (strong >= 3) break;
  }
  if (!places.length) throw new Error(`Qloo found no places near ${city} for ${n === 1 ? 'this taste' : 'this group'}. Try another city or occasion.`);
  step('rank', n === 1 ? 'Ranking for your taste' : 'Ranking for fairness', n === 1 ? 'Scored candidates by how strongly they match your taste.' : 'Scored candidates by how well they serve everyone, using Qloo explainability to show each person’s share.', n === 1 ? { l: M('s.rank.l1'), d: [M('s.rank.d1')] } : n === 2 && { l: M('s.rank.l'), d: [M('s.rank.d')] });

  const { films, filmNote, filmNoteKey } = await pickFilms(filmList, seeds, key, origin, step);
  step('done', 'Plan ready', `${places.length} ${occ.plural} and ${films.length} films for ${who(n)}.`, n <= 2 && { l: M('s.done.l'), d: [M(n === 1 ? 's.done.d1' : 's.done.d', { count: places.length, occ: occasion, films: films.length })] });

  return {
    source: 'qloo-live', city, occasion, occasionLabel: occ.label, people: n,
    seeds: seedSummary(seeds, names),
    places, films, filmNote, filmNoteKey, warning, warningKey, steps, methodKey: n === 1 ? 'method.solo' : 'method.plan',
    method: 'TasteBridge resolves each favorite with Qloo Search, asks Qloo Insights for places that fit each person and the group (filtered by occasion and distance), refines the search when there is too little overlap, and ranks candidates with a fairness-weighted reciprocal-rank rule. Shares come from Qloo explainability. Films are the combined-taste results closest to an even split. These are aggregate cultural affinities, not predictions about a person.',
  };
}
