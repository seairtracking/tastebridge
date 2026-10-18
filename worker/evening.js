// "Tonight" mode: a whole evening for two people after work. The agent picks dinner by cuisine and mood,
// a second stop within walking distance, a live music or show venue nearby, and a film for home.
// Every stop is ranked for fairness with Qloo explainability, and the agent relaxes its own filters
// when there is too little to choose from.
import { ORIGIN, tidy, insights, kind } from './qloo.js';
import { understand, pickFilms, bridge, cityKey, inCity, occasionFit } from './engine.js';

export const CUISINES = ['vietnamese', 'japanese', 'korean', 'chinese', 'thai', 'indian', 'italian', 'french', 'mexican', 'american', 'mediterranean', 'vegetarian'];
export const MOODS = ['romantic', 'cozy', 'lively', 'quiet', 'chill'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const DINNER_FITS = /restaurant|bistro|brasserie|steakhouse|eatery|diner|gastropub|izakaya|trattoria|food_court|noodle|sushi|ramen|pho|pizzeria|grill|bbq|tapas/;
const AFTER_FITS = /bar$|bar_|pub|lounge|wine|cocktail|speakeasy|dessert|cafe|coffee|tea|patisserie|ice_cream|gelato|bakery/;
const SHOW_FITS = /music|jazz|comedy|club|theater|theatre|concert|cabaret|karaoke|opera|performing/;
const SHOW_TAGS = ['live_music_venue', 'live_music_bar', 'jazz_club', 'comedy_club', 'night_club'].map((t) => 'urn:tag:category:place:' + t).join(',');

// Distance in metres between two points (haversine) and the walk it takes at about 80 m a minute.
export function metres(p, q) {
  if (p?.lat == null || q?.lat == null) return null;
  const rad = Math.PI / 180, dLat = (q.lat - p.lat) * rad, dLon = (q.lon - p.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(12742000 * Math.asin(Math.sqrt(h)));
}
const walk = (m) => (m == null ? null : { metres: m, minutes: Math.max(1, Math.round(m / 80)) });

// Minutes since midnight for "HH:MM" (or Qloo's "T18:30:00").
const minutesOf = (t) => { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const clock = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

// 'open', 'closed' or 'unknown' at a given day and time. Qloo hours that say "closed every day" are treated
// as missing data rather than trusted.
export function openAt(hours, day, time) {
  const at = minutesOf(time);
  if (!hours || !DAYS.includes(day) || at == null) return 'unknown';
  const all = DAYS.flatMap((d) => (Array.isArray(hours[d]) ? hours[d] : []));
  if (!all.length || all.every((s) => s?.closed)) return 'unknown';
  const today = Array.isArray(hours[day]) ? hours[day] : [];
  const prev = Array.isArray(hours[DAYS[(DAYS.indexOf(day) + 6) % 7]]) ? hours[DAYS[(DAYS.indexOf(day) + 6) % 7]] : [];
  const within = (slot, shift) => {
    const o = minutesOf(slot?.opens), c0 = minutesOf(slot?.closes);
    if (slot?.closed || o == null || c0 == null) return false;
    const c = c0 <= o ? c0 + 1440 : c0; // closes after midnight
    return at + shift >= o && at + shift < c;
  };
  if (today.some((s) => within(s, 0)) || prev.some((s) => within(s, 1440))) return 'open';
  return today.length ? 'closed' : 'unknown';
}

export function parseEvening(input) {
  const first = tidy(input?.first, 70), second = tidy(input?.second, 70), city = tidy(input?.city, 70);
  const lat = Number(input?.lat), lon = Number(input?.lon);
  const near = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
    ? { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 } : null; // about 10 m: enough, and not more precise than needed
  if (first.length < 2 || second.length < 2) throw new Error('Enter two favorites.');
  if (!near && city.length < 2) throw new Error('Enter a city or use your location.');
  const start = minutesOf(input?.start) ?? 18 * 60 + 30;
  return {
    first, second, city, near,
    start: clock(Math.min(start, 23 * 60)),
    day: DAYS.includes(input?.day) ? input.day : null,
    cuisine: CUISINES.includes(input?.cuisine) ? input.cuisine : null,
    mood: MOODS.includes(input?.mood) ? input.mood : null,
    budget: [1, 2, 3, 4].includes(Number(input?.budget)) ? Number(input.budget) : null,
  };
}

// Where to search: around a point (the user's location or the dinner spot) or inside a named city.
const where = (point, city, radius) => (point
  ? { 'filter.location': `POINT(${point.lon} ${point.lat})`, 'filter.location.radius': radius }
  : { 'filter.location.query': city, 'filter.location.radius': radius });

// One fair search round: each person's list plus the combined list with explainability, ranked by `bridge`.
async function round(a, b, params, opts, key, origin) {
  const soft = (p) => p.catch(() => []);
  const [ap, bp, jp] = await Promise.all([
    soft(insights({ ...params, 'signal.interests.entities': a.id }, key, origin)),
    soft(insights({ ...params, 'signal.interests.entities': b.id }, key, origin)),
    soft(insights({ ...params, 'signal.interests.entities': `${a.id},${b.id}`, 'feature.explainability': 'true' }, key, origin)),
  ]);
  return bridge(ap, bp, jp, { seeds: [a.id, b.id], take: 12, ...opts });
}

// Runs search attempts until enough suitable places exist, keeping the best attempt and logging refinements.
async function search(stage, attempts, { a, b, key, origin, step, accept }) {
  let best = [], bestCount = -1;
  for (const [n, attempt] of attempts.entries()) {
    if (n > 0) step('refine', `Refining the ${stage}`, `Only ${Math.max(bestCount, 0)} good ${attempt.plural} so far, so the agent ${attempt.why}.`);
    const pool = await round(a, b, attempt.params, attempt.opts, key, origin);
    const good = pool.filter(accept);
    // Places that are mainly the right kind lead; the rest keep their fairness order behind them.
    const ranked = good.sort((x, y) => (y.fit === 1) - (x.fit === 1));
    if (good.length > bestCount) { best = good.length ? ranked : pool; bestCount = good.length; }
    if (bestCount >= attempt.enough) break;
  }
  return best;
}

export async function evening(input, key, origin = ORIGIN, onStep = () => {}) {
  const q = parseEvening(input);
  const steps = [];
  const step = (id, label, detail) => { const s = { id, label, detail }; steps.push(s); onStep(s); };
  const area = q.near ? 'near you' : q.city;
  const ck = q.near ? '' : cityKey(q.city);
  const startMin = minutesOf(q.start);

  const { a, b, filmList, warning } = await understand(q.first, q.second, key, origin, step);

  // 1. Dinner: cuisine and mood first; the agent relaxes the mood, then the cuisine, if too little fits.
  const restaurant = 'urn:tag:category:place:restaurant';
  const cuisineTag = q.cuisine && `urn:tag:genre:place:restaurant:${q.cuisine}`;
  const moodTag = q.mood && `urn:tag:ambience:qloo:${q.mood}`;
  const r0 = q.near ? 3000 : 15000;
  const dinnerBoost = (x) => {
    let f = 1;
    if (q.mood) f *= x.ambience?.includes(q.mood) ? 1.3 : 0.85;
    if (q.cuisine) f *= x.cuisines?.includes(q.cuisine) ? 1.25 : 0.7;
    if (q.budget && x.price) f *= x.price <= q.budget ? 1 : 0.4;
    const open = openAt(x.hours, q.day, q.start);
    return f * (open === 'closed' ? 0.2 : 1);
  };
  const dinnerExtra = (x) => ({ open: openAt(x.hours, q.day, q.start), moodMatch: q.mood ? !!x.ambience?.includes(q.mood) : null, cuisineMatch: q.cuisine ? !!x.cuisines?.includes(q.cuisine) : null, lat: x.lat, lon: x.lon });
  const dinnerOpts = { city: ck ? q.city : '', fits: DINNER_FITS, boost: dinnerBoost, extra: dinnerExtra };
  const tags = (...t) => { const list = t.filter(Boolean); return list.length > 1 ? { 'filter.tags': list.join(','), 'operator.filter.tags': 'intersection' } : { 'filter.tags': list[0] }; };
  const label = [q.cuisine && q.cuisine[0].toUpperCase() + q.cuisine.slice(1), 'restaurants'].filter(Boolean).join(' ');
  step('dinner', `Finding dinner ${q.near ? 'near you' : 'in ' + q.city}`, `Asking Qloo for ${label.toLowerCase()}${q.mood ? ` with a ${q.mood} feel` : ''} that fit each of you and both together.`);
  const base = { 'filter.type': 'urn:entity:place', take: 25 };
  const dinnerAttempts = [
    { params: { ...base, ...where(q.near, q.city, r0), ...tags(restaurant, cuisineTag, moodTag) }, opts: dinnerOpts, enough: 3 },
    moodTag && { params: { ...base, ...where(q.near, q.city, r0), ...tags(restaurant, cuisineTag) }, opts: dinnerOpts, enough: 3, plural: 'restaurants', why: `let the ${q.mood} mood guide the ranking instead of filtering on it` },
    { params: { ...base, ...where(q.near, q.city, r0 * 2.5), ...tags(restaurant) }, opts: dinnerOpts, enough: 2, plural: 'restaurants', why: `widened the search to ${(r0 * 2.5) / 1000} km${q.cuisine ? ` and opened it to cuisines close to ${q.cuisine}` : ''}` },
  ].filter(Boolean);
  const dinner = await search('dinner', dinnerAttempts, {
    a, b, key, origin, step,
    accept: (p) => p.fit >= 0.75 && inCity(p.address, ck) && p.open !== 'closed' && (!q.cuisine || p.cuisineMatch),
  });
  if (!dinner.length) throw new Error(`Qloo found no restaurants ${q.near ? 'near you' : 'in ' + q.city} for this pair. Try another cuisine or area.`);
  const pick = dinner[0];
  const anchor = pick.lat != null ? { lat: pick.lat, lon: pick.lon } : q.near;

  // 2. A second stop within walking distance of dinner, ranked by fairness and closeness.
  const afterTime = clock(startMin + 105);
  const afterTag = q.mood === 'cozy' || q.mood === 'quiet' ? 'urn:tag:category:place:dessert_shop,urn:tag:category:place:cafe,urn:tag:category:place:bar' : 'urn:tag:category:place:bar';
  const nearBoost = (time, mood) => (x) => {
    const m = metres(anchor, x);
    let f = m == null ? 0.6 : 1 / (1 + m / 500); // a second stop should be a short walk
    if (mood && x.ambience?.includes(mood)) f *= 1.25;
    if (q.budget && x.price && x.price > q.budget) f *= 0.4;
    return f * (openAt(x.hours, q.day, time) === 'closed' ? 0.2 : 1);
  };
  const nearExtra = (time) => (x) => ({ open: openAt(x.hours, q.day, time), walk: walk(metres(anchor, x)), liveMusic: !!x.liveMusic, lat: x.lat, lon: x.lon });
  const taken = new Set([pick.id]);
  step('after', 'Finding a second stop nearby', `Looking for ${q.mood === 'cozy' || q.mood === 'quiet' ? 'dessert, cafés or quiet bars' : 'bars'} within a short walk of ${pick.name}.`);
  const after = anchor ? await search('second stop', [
    { params: { ...base, ...where(anchor, q.city, 1200), 'filter.tags': afterTag }, opts: { fits: AFTER_FITS, boost: nearBoost(afterTime, q.mood), extra: nearExtra(afterTime) }, enough: 2 },
    { params: { ...base, ...where(anchor, q.city, 3000), 'filter.tags': afterTag }, opts: { fits: AFTER_FITS, boost: nearBoost(afterTime, q.mood), extra: nearExtra(afterTime) }, enough: 1, plural: 'places', why: 'widened the walk to about 3 km' },
  ], { a, b, key, origin, step, accept: (p) => !taken.has(p.id) && p.fit >= 0.75 && p.open !== 'closed' }) : [];
  const afterList = after.filter((p) => !taken.has(p.id));
  afterList.slice(0, 3).forEach((p) => taken.add(p.id)); // the show list should offer different places

  // 3. Live music or a show nearby. Qloo has no event listings, so venues link to their own programme.
  const showTime = clock(startMin + 180);
  step('show', 'Looking for live music or a show', `Searching music venues, jazz and comedy clubs near ${pick.name}. Qloo has no event listings, so each venue links to its own programme.`);
  // Real stages first (live music, jazz, comedy, theatre); dance clubs rank lower on a romantic, cozy or quiet night.
  const calm = ['romantic', 'cozy', 'quiet'].includes(q.mood);
  const showBoost = (x) => {
    const main = x.categories?.[0] || '';
    const stage = /music|jazz|comedy|concert|theat|opera|cabaret|performing/.test(main);
    const m = metres(anchor, x);
    const close = m == null ? 0.6 : 1 / (1 + m / 600); // after dinner, a show should be a short walk or ride away
    const open = openAt(x.hours, q.day, showTime) === 'closed' ? 0.2 : 1;
    return close * open * (x.liveMusic ? 1.3 : 1) * (stage ? 1.3 : calm ? 0.6 : 0.9);
  };
  const show = anchor ? await search('show', [
    { params: { ...base, ...where(anchor, q.city, 2500), 'filter.tags': SHOW_TAGS }, opts: { fits: SHOW_FITS, boost: showBoost, extra: nearExtra(showTime) }, enough: 2 },
    { params: { ...base, ...where(anchor, q.city, 6000), 'filter.tags': SHOW_TAGS }, opts: { fits: SHOW_FITS, boost: showBoost, extra: nearExtra(showTime) }, enough: 1, plural: 'venues', why: 'widened the search to about 6 km' },
  ], { a, b, key, origin, step, accept: (p) => !taken.has(p.id) && p.fit >= 0.75 && p.open !== 'closed' }) : [];
  const showList = show.filter((p) => !taken.has(p.id));

  // 4. A film for home.
  const { films, filmNote } = await pickFilms(filmList, a, b, key, origin, step);

  const stops = [
    { slot: 'dinner', time: q.start, title: 'Dinner', options: dinner.slice(0, 3) },
    afterList.length && { slot: 'after', time: afterTime, title: 'Second stop', options: afterList.slice(0, 3) },
    showList.length && { slot: 'show', time: showTime, title: 'Live music or a show', options: showList.slice(0, 3) },
  ].filter(Boolean);
  step('done', 'Evening ready', `${stops.map((s) => s.title.toLowerCase()).join(', ')} and ${films.length} films for home.`);

  return {
    mode: 'evening', source: 'qloo-live', city: area, start: q.start, day: q.day, cuisine: q.cuisine, mood: q.mood, budget: q.budget,
    occasionLabel: 'Tonight', seeds: [{ id: a.id, name: a.name, kind: kind(a) }, { id: b.id, name: b.name, kind: kind(b) }],
    stops, films, filmNote, warning, steps,
    method: 'TasteBridge resolves both favorites with Qloo Search and checks their signal, then plans the evening stop by stop with Qloo Insights: dinner filtered by cuisine and mood, a second stop and a live music or show venue searched around the dinner spot. Every stop is ranked with the fairness-weighted rule and Qloo explainability, adjusted for mood, cuisine, budget, walking distance and opening hours where Qloo has them. Qloo does not list events, so check each venue for tonight’s programme.',
  };
}
