// TasteBridge planning agent: understands two tastes through Qloo, searches for an occasion,
// refines the search when there is not enough common ground, and ranks a fair plan for both people.
import { ORIGIN, tidy, candidates, insights, kind } from './qloo.js';

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
  { radius: 40000, quality: null, tag: true, why: 'widened the search to 40 km and relaxed the quality filter' },
  { radius: 40000, quality: null, tag: false, why: 'dropped the occasion filter to look at any kind of place' },
];

// Share of a result driven by each person, from Qloo explainability (percent, sums to 100).
export function shares(item, aId, bId) {
  const a = item?.explain?.find((x) => x.id === aId)?.score || 0;
  const b = item?.explain?.find((x) => x.id === bId)?.score || 0;
  if (a + b <= 0) return null;
  const pa = Math.round((a / (a + b)) * 100);
  return { a: pa, b: 100 - pa };
}

// Accent- and case-insensitive text, so "Hồ Chí Minh" matches "Ho Chi Minh City".
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
// Spaces are dropped too, so "Hanoi" matches "Hà Nội" and "New York" matches "New York, NY".
// Local spellings that addresses use, so "Lisbon" matches "Lisboa".
const CITY_ALIASES = {
  lisbon: 'lisboa', munich: 'munchen', rome: 'roma', prague: 'praha', vienna: 'wien', florence: 'firenze', milan: 'milano',
  naples: 'napoli', venice: 'venezia', cologne: 'koln', copenhagen: 'kobenhavn', warsaw: 'warszawa', athens: 'athina',
  seville: 'sevilla', brussels: 'bruxelles', saigon: 'hochiminh', hochiminh: 'saigon', mexico: 'cdmx', thehague: 'denhaag',
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
    image: x.image || null, rating: x.rating ?? null, price: x.price ?? null, website: x.website || null,
    map: query ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query) : null,
  };
}
export const filmDetails = (f) => ({ image: f.image || null, year: f.year ?? null, genres: f.genres || [] });

// Fairness-weighted reciprocal-rank ranking over each person's list and the combined list.
export function bridge(a, b, joint, { seeds = [], take = 4, city = '', fits = null } = {}) {
  const key = cityKey(city);
  const rank = (list) => new Map(list.map((x, i) => [x.id, i + 1]));
  const ra = rank(a), rb = rank(b), rj = rank(joint);
  const pool = new Map([...a, ...b, ...joint].map((x) => [x.id, x])); // combined entries win: they carry explainability
  return [...pool.values()].map((x) => {
    const ar = ra.get(x.id) || null, br = rb.get(x.id) || null, jr = rj.get(x.id) || null;
    const av = ar ? 1 / (4 + ar) : 0, bv = br ? 1 / (4 + br) : 0, jv = jr ? 1 / (4 + jr) : 0;
    let score = Math.min(av, bv) * 6 + (av + bv) * 0.8 + jv * 1.3;
    const mainstream = (x.popularity ?? 0) >= 0.995;
    if (mainstream) score *= 0.85; // nudge away from the most generic landmarks
    if (!inCity(x.address, key)) score *= 0.35; // outside the city the user asked for
    score *= occasionFit(x.categories, fits); // e.g. a museum with a bar is not really a drinks spot
    const share = shares(x, seeds[0], seeds[1]) || (av + bv > 0 ? { a: Math.round((av / (av + bv)) * 100), b: 100 - Math.round((av / (av + bv)) * 100) } : null);
    const reason = ar && br ? 'In both people’s individual Qloo lists.' : jr ? 'In Qloo’s combined-taste list for the pair.' : 'A strong pick for one person.';
    const fit = occasionFit(x.categories, fits);
    return { id: x.id, name: x.name, address: x.address, category: (x.categories?.[0] || '').replace(/_/g, ' '), ...placeDetails(x), aRank: ar, bRank: br, jointRank: jr, share, mainstream, fit, reason, score };
  }).sort((x, y) => y.score - x.score)
    .filter((x, i, all) => all.findIndex((y) => y.name.toLowerCase() === x.name.toLowerCase()) === i)
    .slice(0, take)
    .map(({ score, ...x }) => x);
}

// Films whose Qloo explainability is closest to an even split between both people.
export function balancedFilms(list, [aId, bId], exclude = new Set(), take = 3) {
  return list.filter((f) => !exclude.has(f.id)).map((f, i) => {
    const share = shares(f, aId, bId);
    const balance = share ? Math.min(share.a, share.b) / Math.max(share.a, share.b) : 0;
    return { id: f.id, name: f.name, ...filmDetails(f), share, score: balance - i * 0.01 };
  }).sort((x, y) => y.score - x.score).slice(0, take).map(({ score, ...f }) => f);
}

// A side list that fails (Qloo can reject some signals) should not sink the whole plan.
const soft = (promise) => promise.catch(() => []);

export function parseInput(input) {
  const first = tidy(input?.first, 70), second = tidy(input?.second, 70), city = tidy(input?.city, 70);
  const occasion = Object.hasOwn(OCCASIONS, input?.occasion) ? input.occasion : 'dinner';
  if (first.length < 2 || second.length < 2 || city.length < 2) throw new Error('Enter two favorites and a city.');
  return { first, second, city, occasion };
}

export async function plan(input, key, origin = ORIGIN, onStep = () => {}) {
  const { first, second, city, occasion } = parseInput(input);
  const occ = OCCASIONS[occasion];
  const steps = [];
  const step = (id, label, detail) => { const s = { id, label, detail }; steps.push(s); onStep(s); };

  step('resolve', 'Understanding both tastes', `Looking up “${first}” and “${second}” in Qloo’s taste graph.`);
  const [ca, cb] = await Promise.all([candidates(first, key, origin), candidates(second, key, origin)]);
  let a = ca[0], b = cb.find((x) => x.id !== a.id);
  if (!b) throw new Error('Choose two different favorites.');
  step('resolved', 'Tastes identified', `${a.name} (${kind(a)}) and ${b.name} (${kind(b)}).`);

  // Signal check: some Qloo entities (e.g. an album or a person page) barely shape recommendations.
  // The combined film list shows each favorite's influence; a silent favorite is swapped for its next reading.
  step('check', 'Checking both tastes carry signal', 'Asking Qloo for films that fit both, to confirm each favorite really shapes the results.');
  const probe = () => soft(insights({ 'filter.type': 'urn:entity:movie', 'signal.interests.entities': `${a.id},${b.id}`, 'feature.explainability': 'true', take: 20 }, key, origin));
  let filmList = await probe(), warning = '';
  for (let tries = 0; ; tries++) {
    const split = filmList.map((f) => shares(f, a.id, b.id)).filter(Boolean);
    if (!split.length) break;
    const meanA = split.reduce((t, x) => t + x.a, 0) / split.length;
    const side = meanA < 5 ? 'a' : meanA > 95 ? 'b' : null;
    if (!side) break;
    const [weak, other, pool] = side === 'a' ? [a, b, ca] : [b, a, cb];
    const next = pool.slice(pool.indexOf(weak) + 1).find((x) => x.id !== other.id);
    if (!next || tries >= 3) {
      // Nothing better: go back to the first reading so the plan names what the person actually typed.
      const first = pool.find((x) => x.id !== other.id);
      warning = `Qloo has little film-taste data linked to ${first.name} (${kind(first)}), so the film picks lean toward ${other.name}. A specific work, such as a film or album, usually gives a fairer result.`;
      step('refine', 'Weak taste signal', warning);
      if (first.id !== weak.id) { if (side === 'a') a = first; else b = first; filmList = await probe(); }
      break;
    }
    step('refine', 'Weak taste signal', `Qloo has little taste data for “${weak.name}” as a ${kind(weak)}, so the agent switched to ${next.name} (${kind(next)}).`);
    if (side === 'a') a = next; else b = next;
    filmList = await probe();
  }

  // A good pick is in the city and is mainly the kind of place the occasion calls for.
  const good = (list) => list.filter((p) => inCity(p.address, cityKey(city)) && p.fit === 1).length;
  let places = [], strong = -1;
  for (const [n, attempt] of PLACE_ATTEMPTS.entries()) {
    if (n > 0) step('refine', 'Not enough common ground yet', `Found ${strong} of the 3 strong ${occ.plural} in ${city} it wants, so the agent ${attempt.why}.`);
    else step('places', `Searching ${occ.plural} in ${city}`, `Asking Qloo what fits each person on their own, and what fits both together, within ${attempt.radius / 1000} km.`);
    const base = { 'filter.type': 'urn:entity:place', 'filter.location.query': city, 'filter.location.radius': attempt.radius, take: 25 };
    if (attempt.tag) base['filter.tags'] = occ.tag;
    if (attempt.quality) base['bias.quality'] = attempt.quality;
    const [ap, bp, jp] = await Promise.all([
      soft(insights({ ...base, 'signal.interests.entities': a.id }, key, origin)),
      soft(insights({ ...base, 'signal.interests.entities': b.id }, key, origin)),
      insights({ ...base, 'signal.interests.entities': `${a.id},${b.id}`, 'feature.explainability': 'true' }, key, origin),
    ]);
    // Rank a wider pool, then drop places that are clearly the wrong kind when enough right ones exist.
    const pool = bridge(ap, bp, jp, { seeds: [a.id, b.id], city, fits: occ.fits, take: 12 });
    // Places that are mainly the right kind lead; the rest keep their fairness order behind them.
    const suited = pool.filter((p) => p.fit >= 0.75 && inCity(p.address, cityKey(city))).sort((x, y) => (y.fit === 1) - (x.fit === 1));
    const found = (suited.length >= 3 ? suited : pool).slice(0, 4);
    if (good(found) > strong || (!places.length && found.length)) { places = found; strong = good(found); }
    if (strong >= 3) break;
  }
  if (!places.length) throw new Error(`Qloo found no places near ${city} for this pair. Try another city or occasion.`);
  step('rank', 'Ranking for fairness', `Scored candidates by how well they serve both people, using Qloo explainability to show each person’s share.`);

  step('films', 'Finding a film for both', 'Asking Qloo which films sit between both tastes, then keeping the most evenly shared ones.');
  let films = balancedFilms(filmList, [a.id, b.id], new Set([a.id, b.id]));
  let filmNote = 'Films closest to an even split between both tastes, according to Qloo explainability.';
  const best = films[0]?.share ? Math.min(films[0].share.a, films[0].share.b) : 0;
  if (best < 15) {
    // Almost no shared film taste: alternate one pick for each person instead of pretending there is overlap.
    step('refine', 'Little film overlap', 'Qloo’s combined film list leans almost entirely to one person, so the agent picks a film for each of them.');
    const [aFilms, bFilms] = await Promise.all([
      soft(insights({ 'filter.type': 'urn:entity:movie', 'signal.interests.entities': a.id, take: 5 }, key, origin)),
      soft(insights({ 'filter.type': 'urn:entity:movie', 'signal.interests.entities': b.id, take: 5 }, key, origin)),
    ]);
    const skip = new Set([a.id, b.id]);
    const pickA = aFilms.find((f) => !skip.has(f.id));
    const pickB = bFilms.find((f) => !skip.has(f.id) && f.id !== pickA?.id);
    const fallback = [pickA && { id: pickA.id, name: pickA.name, ...filmDetails(pickA), share: { a: 100, b: 0 }, for: a.name }, pickB && { id: pickB.id, name: pickB.name, ...filmDetails(pickB), share: { a: 0, b: 100 }, for: b.name }].filter(Boolean);
    if (fallback.length === 2) { films = fallback; filmNote = 'Qloo found little shared film taste, so here is one pick for each of you.'; }
    else if (fallback.length) {
      // Only one side has its own film list: show that pick next to the closest shared films, with their real shares.
      films = [fallback[0], ...films.filter((f) => f.id !== fallback[0].id)].slice(0, 3);
      filmNote = `Qloo found little shared film taste, so the first pick is for ${fallback[0].for} and the others are the closest shared films.`;
    }
    else filmNote = 'Qloo found little shared film taste for this pair; these lean toward one person.';
  }
  step('done', 'Plan ready', `${places.length} ${occ.plural} and ${films.length} films for both of you.`);

  return {
    source: 'qloo-live', city, occasion, occasionLabel: occ.label,
    seeds: [{ id: a.id, name: a.name, kind: kind(a) }, { id: b.id, name: b.name, kind: kind(b) }],
    places, films, filmNote, warning, steps,
    method: 'TasteBridge resolves both favorites with Qloo Search, asks Qloo Insights for places that fit each person and the pair (filtered by occasion and distance), refines the search when there is too little overlap, and ranks candidates with a fairness-weighted reciprocal-rank rule. Shares come from Qloo explainability. Films are the combined-taste results closest to an even split. These are aggregate cultural affinities, not predictions about a person.',
  };
}
