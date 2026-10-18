// Run with: npm test  (node --test, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import worker, { plan, bridge, balancedFilms, shares, entity } from "../worker/index.js";
import { OCCASIONS, occasionFit, placeDetails } from "../worker/engine.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n, name, extra = {}) => ({ entity_id: id(n), name, ...extra });
const explained = (n, name, a, b, address = "1 Main St, Hanoi") => item(n, name, {
  properties: { address },
  query: { explainability: { "signal.interests.entities": [{ entity_id: id(1), score: a }, { entity_id: id(2), score: b }] } },
});

test("entity keeps only Qloo records with a UUID and a name, and reads explainability", () => {
  const e = entity(explained(5, "Cafe", 0.6, 0.4));
  assert.equal(e.id, id(5));
  assert.equal(e.address, "1 Main St, Hanoi");
  assert.deepEqual(e.explain, [{ id: id(1), score: 0.6 }, { id: id(2), score: 0.4 }]);
  assert.equal(entity({ entity_id: "not-a-uuid", name: "x" }), null);
  assert.equal(entity({ entity_id: id(2) }), null);
});

test("entity keeps safe photo, rating, price, website and film details only", () => {
  const place = entity(item(6, "Bar", { location: { lat: 10.77, lon: 106.69 }, properties: { image: { url: "https://images.qloo.com/x.jpg" }, business_rating: 4.2999, price_level: 2, website: "javascript:alert(1)" } }));
  assert.equal(place.image, "https://images.qloo.com/x.jpg");
  assert.equal(place.rating, 4.3);
  assert.equal(place.price, 2);
  assert.equal(place.website, null);
  assert.equal(place.lat, 10.77);
  const film = entity(item(7, "Film", { properties: { image: { url: "http://insecure.example/p.jpg" }, release_year: "1997", genres: ["Animation", "Fantasy", "Drama"] } }));
  assert.equal(film.image, null);
  assert.equal(film.year, 1997);
  assert.deepEqual(film.genres, ["Animation", "Fantasy"]);
});

test("placeDetails builds a map search link from the name and address", () => {
  const d = placeDetails({ name: "Layla", address: "63 Đông Du, Sài Gòn", rating: 4.5, price: 3, website: "https://layla.vn/" });
  assert.equal(d.map, "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Layla, 63 Đông Du, Sài Gòn"));
  assert.equal(d.rating, 4.5);
  assert.equal(d.website, "https://layla.vn/");
});

test("shares turns explainability into percentages that sum to 100", () => {
  assert.deepEqual(shares(entity(explained(5, "x", 0.3, 0.1)), id(1), id(2)), { a: 75, b: 25 });
  assert.equal(shares({ explain: [] }, id(1), id(2)), null);
});

test("bridge ranks places both people share above one-sided favorites", () => {
  const shared = { id: id(10), name: "Shared Cafe" };
  const onlyA = { id: id(11), name: "A Bar" };
  const onlyB = { id: id(12), name: "B Club" };
  const result = bridge([onlyA, shared], [onlyB, shared], []);
  assert.equal(result[0].name, "Shared Cafe");
  assert.equal(result[0].reason, "In both people’s individual Qloo lists.");
  assert.deepEqual(result[0].share, { a: 50, b: 50 });
});

test("bridge pushes places outside the requested city down the list", () => {
  const far = { id: id(13), name: "Niagara Falls", address: "Niagara Falls, NY 14303" };
  const near = { id: id(14), name: "Comedy Cellar", address: "117 MacDougal St, New York, NY" };
  const result = bridge([far, near], [far, near], [], { city: "New York" });
  assert.equal(result[0].name, "Comedy Cellar");
});

test("bridge prefers places whose main category suits the occasion", () => {
  const museumWithBar = { id: id(15), name: "Magic Museum", categories: ["museum", "event_venue", "bar"] };
  const realBar = { id: id(16), name: "Cocktail Corner", categories: ["cocktail_bar", "bar"] };
  const result = bridge([museumWithBar, realBar], [museumWithBar, realBar], [], { fits: OCCASIONS.drinks.fits });
  assert.equal(result[0].name, "Cocktail Corner");
  assert.equal(result[0].category, "cocktail bar");
  assert.equal(occasionFit(["museum"], OCCASIONS.drinks.fits), 0.4);
  assert.equal(occasionFit([], OCCASIONS.drinks.fits), 1);
});

test("bridge never suggests adult entertainment venues", () => {
  const list = [
    { id: id(23), name: "Hunk-O-Mania Male Revue NYC", categories: ["night_club"] },
    { id: id(24), name: "Velvet Club", categories: ["adult_entertainment_club"] },
    { id: id(25), name: "Blue Note", categories: ["jazz_club"] },
  ];
  assert.deepEqual(bridge(list, list, []).map((p) => p.name), ["Blue Note"]);
});

test("bridge drops duplicate venue names Qloo stores as separate records", () => {
  const result = bridge([{ id: id(20), name: "Big Ben" }], [{ id: id(21), name: "Big ben" }], [{ id: id(22), name: "Tower Bridge" }]);
  assert.equal(result.filter((p) => p.name.toLowerCase() === "big ben").length, 1);
});

test("balancedFilms prefers the most evenly shared film and skips the seeds", () => {
  const list = [explained(1, "Seed", 1, 0), explained(40, "Leans A", 0.9, 0.1), explained(41, "Even", 0.5, 0.5)].map(entity);
  const films = balancedFilms(list, [id(1), id(2)], new Set([id(1)]));
  assert.equal(films[0].name, "Even");
  assert.equal(films.some((f) => f.name === "Seed"), false);
});

// A fake Qloo: the first (15 km) place search finds too little, so the agent must widen it.
function fakeQloo() {
  const state = { inFlight: 0, peak: 0, rateLimited: false };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
  state.fetch = async (url) => {
    state.inFlight++; state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((r) => setTimeout(r, 15));
    state.inFlight--;
    const u = new URL(String(url));
    const q = (k) => u.searchParams.get(k);
    if (u.pathname === "/search") {
      const n = q("query") === "Radiohead" ? 1 : 2;
      return reply({ results: [item(n, q("query"), { types: [n === 1 ? "urn:entity:artist" : "urn:entity:movie"] })] });
    }
    if (q("filter.type") === "urn:entity:movie") {
      if (!state.rateLimited) { state.rateLimited = true; return reply({ error_msg: "Rate limit exceeded" }, 429); }
      return reply({ results: { entities: [explained(50, "Leans", 0.95, 0.05), explained(51, "Lady Bird", 0.5, 0.5)] } });
    }
    if (q("filter.location.radius") === "15000") return reply({ results: { entities: [explained(30, "Shared Cafe", 0.5, 0.5)] } });
    return reply({ results: { entities: [explained(30, "Shared Cafe", 0.5, 0.5), explained(31, "Night Market", 0.4, 0.6), explained(32, "Jazz Club", 0.55, 0.45)] } });
  };
  return state;
}

test("plan refines a thin search, keeps at most 3 Qloo calls in flight and retries 429s", async () => {
  const realFetch = globalThis.fetch, fake = fakeQloo();
  globalThis.fetch = fake.fetch;
  const steps = [];
  try {
    const result = await plan({ first: "Radiohead", second: "Lady Bird", city: "Hanoi", occasion: "coffee" }, "test-key", "https://hackathon.api.qloo.com", (s) => steps.push(s));
    assert.equal(result.source, "qloo-live");
    assert.equal(result.occasionLabel, "Coffee");
    assert.equal(result.places.length, 3);
    assert.ok(result.places.every((p) => p.share && p.share.a + p.share.b === 100));
    assert.equal(result.films[0].name, "Lady Bird");
    assert.ok(steps.some((s) => s.id === "refine"), "the agent widened its search");
    assert.equal(steps.at(-1).id, "done");
    assert.deepEqual(result.steps, steps);
    assert.ok(fake.rateLimited, "a 429 was simulated");
    assert.ok(fake.peak <= 3, `peak concurrency ${fake.peak}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("plan swaps a favorite that carries no Qloo taste signal for its next reading", async () => {
  const realFetch = globalThis.fetch;
  // "Harry Potter" first matches an album with no signal; a second reading of the same name has signal.
  globalThis.fetch = async (url) => {
    const u = new URL(String(url)), q = (k) => u.searchParams.get(k);
    const reply = (body) => new Response(JSON.stringify(body));
    if (u.pathname === "/search") {
      if (q("query") === "BLACKPINK") return reply({ results: [item(1, "BLACKPINK", { types: ["urn:entity:artist"] })] });
      return reply({ results: [item(2, "Harry Potter", { types: ["urn:entity:album"] }), item(3, "Harry Potter", { types: ["urn:entity:person"] }), item(4, "Harry Potter Bar", { types: ["urn:entity:place"] })] });
    }
    const [x, y] = q("signal.interests.entities").split(",");
    const silent = y === id(2);
    const make = (n, name, address = "Seoul") => item(n, name, { properties: { address }, query: { explainability: { "signal.interests.entities": [{ entity_id: x, score: 0.5 }, { entity_id: y || x, score: silent ? 0 : 0.5 }] } } });
    if (q("filter.type") === "urn:entity:movie") return reply({ results: { entities: [make(60, "Film One"), make(61, "Film Two")] } });
    return reply({ results: { entities: [make(70, "Cafe A"), make(71, "Cafe B"), make(72, "Cafe C")] } });
  };
  const steps = [];
  try {
    const result = await plan({ first: "BLACKPINK", second: "Harry Potter", city: "Seoul", occasion: "coffee" }, "k", "https://hackathon.api.qloo.com", (s) => steps.push(s));
    assert.equal(result.seeds[1].id, id(3));
    assert.ok(steps.some((s) => /switched to Harry Potter/.test(s.detail)));
    assert.equal(result.warning, "");
    assert.deepEqual(result.films[0].share, { a: 50, b: 50 });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("plan rejects incomplete input before calling Qloo", async () => {
  await assert.rejects(plan({ first: "A", second: "Radiohead", city: "Hanoi" }, "k"), /at least one favorite/);
  await assert.rejects(plan({ first: "Radiohead", second: "Bjork" }, "k"), /Enter a city/);
  await assert.rejects(plan({ favorites: ["a1", "b2", "c3", "d4", "e5"], city: "Hanoi" }, "k"), /up to four/);
});

test("the planning API streams agent steps then the result as NDJSON", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeQloo().fetch;
  try {
    const res = await worker.fetch(new Request("http://x/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson", "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ first: "Radiohead", second: "Lady Bird", city: "Hanoi", occasion: "drinks" }),
    }), { QLOO_API_KEY: "test-key" });
    assert.match(res.headers.get("content-type"), /ndjson/);
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(events[0].event, "step");
    assert.equal(events.at(-1).event, "result");
    assert.equal(events.at(-1).plan.occasion, "drinks");
  } finally {
    globalThis.fetch = realFetch;
  }
});

const rpc = (body, env = { QLOO_API_KEY: "test-key" }) => worker.fetch(new Request("http://x/mcp", {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify(body),
}), env);

test("MCP: initialize, tools/list and notifications", async () => {
  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })).json();
  assert.equal(init.result.serverInfo.name, "tastebridge");
  assert.ok(init.result.capabilities.tools);
  const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.deepEqual(list.result.tools.map((t) => t.name), ["find_common_ground", "plan_evening", "resolve_favorite"]);
  const missing = await (await rpc({ jsonrpc: "2.0", id: 3, method: "nope" })).json();
  assert.equal(missing.error.code, -32601);
});

test("MCP: find_common_ground returns text and structured content", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeQloo().fetch;
  try {
    const res = await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "find_common_ground", arguments: { first: "Radiohead", second: "Lady Bird", city: "Hanoi" } } })).json();
    assert.equal(res.result.isError, undefined);
    assert.match(res.result.content[0].text, /Shared Cafe/);
    assert.equal(res.result.structuredContent.places.length, 3);
    const bad = await (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "find_common_ground", arguments: { first: "A" } } })).json();
    assert.equal(bad.result.isError, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- Tonight mode ----
import { evening, metres, openAt, parseEvening } from "../worker/evening.js";

test("metres and openAt handle walking distance, late closing and unreliable hours", () => {
  assert.equal(Math.round(metres({ lat: 40.757, lon: -73.9866 }, { lat: 40.7536, lon: -73.9832 }) / 10) * 10, 470); // about 378 m north-south and 287 m east-west
  const hours = { friday: [{ opens: "T17:00:00", closes: "T01:00:00", closed: false }], saturday: [{ opens: null, closes: null, closed: true }] };
  assert.equal(openAt(hours, "friday", "18:30"), "open");
  assert.equal(openAt(hours, "friday", "16:00"), "closed");
  assert.equal(openAt(hours, "saturday", "00:30"), "open"); // still Friday's late night
  const allClosed = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ closed: true }]]));
  assert.equal(openAt(allClosed, "friday", "19:00"), "unknown");
  assert.equal(openAt(null, "friday", "19:00"), "unknown");
});

test("parseEvening validates choices and keeps location coarse", () => {
  const q = parseEvening({ first: "Lady Gaga", second: "Stranger Things", lat: 10.776912, lon: 106.700981, cuisine: "sushi", mood: "romantic", budget: "9", start: "19:05" });
  assert.deepEqual(q.near, { lat: 10.7769, lon: 106.701 });
  assert.equal(q.cuisine, null);
  assert.equal(q.mood, "romantic");
  assert.equal(q.budget, null);
  assert.equal(q.start, "19:05");
  assert.throws(() => parseEvening({ first: "Lady Gaga", second: "Stranger Things" }), /city or use your location/);
});

function fakeEveningQloo(rain = 80) {
  const reply = (body) => new Response(JSON.stringify(body));
  const place = (n, name, cats, extra, lat, lon, x, y) => item(n, name, {
    location: { lat, lon },
    tags: cats.map((c) => ({ id: c })),
    properties: { address: "1 Main St, New York", business_rating: 4.5, price_level: 2, image: { url: `https://images.qloo.com/${n}.jpg` }, ...extra },
    query: { explainability: { "signal.interests.entities": [{ entity_id: x, score: 0.5 }, { entity_id: y || x, score: 0.5 }] } },
  });
  return async (url) => {
    const u = new URL(String(url)), q = (k) => u.searchParams.get(k);
    if (u.hostname === "api.open-meteo.com") {
      if (rain == null) return new Response("down", { status: 503 });
      const time = Array.from({ length: 24 }, (_, h) => `2026-10-23T${String(h).padStart(2, "0")}:00`); // a Friday
      return reply({ hourly: { time, temperature_2m: time.map(() => 24), precipitation_probability: time.map(() => rain), weather_code: time.map(() => (rain >= 50 ? 63 : 0)) } });
    }
    if (u.pathname === "/search") return reply({ results: [item(q("query") === "Spirited Away" ? 1 : 2, q("query"), { types: [q("query") === "Spirited Away" ? "urn:entity:movie" : "urn:entity:artist"] })] });
    const [x, y] = q("signal.interests.entities").split(",");
    if (q("filter.type") === "urn:entity:movie") return reply({ results: { entities: [explained(60, "Inception", 0.5, 0.5)] } });
    const tags = q("filter.tags") || "";
    if (tags.includes("restaurant")) return reply({ results: { entities: [
      place(70, "Sushi Place", ["urn:tag:category:place:japanese_restaurant", "urn:tag:genre:place:restaurant:japanese", "urn:tag:ambience:qloo:romantic"], {}, 40.7570, -73.9866, x, y),
      place(71, "Ramen Bar", ["urn:tag:category:place:ramen_restaurant", "urn:tag:genre:place:restaurant:japanese"], {}, 40.7580, -73.9850, x, y),
      place(72, "Steak House", ["urn:tag:category:place:steakhouse"], {}, 40.7590, -73.9840, x, y),
    ] } });
    if (tags.includes("live_music")) return reply({ results: { entities: [
      place(90, "Jazz Room", ["urn:tag:category:place:jazz_club"], { live_music: true }, 40.7600, -73.9870, x, y),
    ] } });
    return reply({ results: { entities: [
      place(79, "Sky Rooftop", ["urn:tag:category:place:rooftop_bar", "urn:tag:amenity:qloo:rooftop"], {}, 40.7571, -73.9865, x, y),
      place(80, "Wine Bar", ["urn:tag:category:place:wine_bar"], {}, 40.7575, -73.9860, x, y),
      place(81, "Far Pub", ["urn:tag:category:place:pub"], {}, 40.7700, -73.9700, x, y),
    ] } });
  };
}

test("evening plans dinner by cuisine and mood, then a nearby stop, a show and a film", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeEveningQloo();
  try {
    const p = await evening({ first: "Spirited Away", second: "Daft Punk", city: "New York", cuisine: "japanese", mood: "romantic", start: "18:30", day: "friday" }, "k", "https://hackathon.api.qloo.com");
    assert.equal(p.mode, "evening");
    assert.deepEqual(p.stops.map((s) => s.slot), ["dinner", "after", "show"]);
    assert.equal(p.stops[0].options[0].name, "Sushi Place"); // matches cuisine and mood
    assert.equal(p.stops[0].options[0].moodMatch, true);
    assert.equal(p.stops[1].time, "20:15");
    assert.equal(p.stops[1].options[0].name, "Wine Bar"); // rain: the indoor bar beats the closer rooftop
    assert.equal(p.weather[1].rain, 80);
    assert.ok(p.steps.some((s) => s.label === "Rain is likely"));
    assert.ok(p.stops[1].options[0].walk.minutes <= 2);
    assert.equal(p.stops[2].options[0].name, "Jazz Room");
    assert.equal(p.stops[2].options[0].liveMusic, true);
    assert.equal(p.films[0].name, "Inception");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("MCP lists plan_evening and the app serves its manifest, worker and icons", async () => {
  const list = await (await rpc({ jsonrpc: "2.0", id: 9, method: "tools/list" })).json();
  assert.ok(list.result.tools.some((t) => t.name === "plan_evening"));
  for (const [path, type] of [["/manifest.webmanifest", /manifest/], ["/sw.js", /javascript/], ["/icon-512.png", /png/], ["/apple-touch-icon.png", /png/]]) {
    const res = await worker.fetch(new Request("http://x" + path), {});
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type"), type);
  }
  const manifest = await (await worker.fetch(new Request("http://x/manifest.webmanifest"), {})).json();
  assert.equal(manifest.display, "standalone");
});

// ---- Accounts and two-phone rooms ----
import { openStore } from "../worker/store.js";

function client(env) {
  let jar = "";
  return async (path, { method = "GET", body, headers = {}, origin = "http://x" } = {}) => {
    const raw = body instanceof Uint8Array;
    const res = await worker.fetch(new Request("http://x" + path, {
      method, body: raw ? body : body && JSON.stringify(body),
      headers: { "content-type": raw ? "image/jpeg" : "application/json", cookie: jar, origin, "x-forwarded-for": "198.51.100." + (Math.random() * 200 | 0), ...headers },
    }), env);
    const set = res.headers.get("set-cookie");
    if (set) jar = set.split(";")[0];
    const type = res.headers.get("content-type") || "";
    if (type.startsWith("image/")) return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
    return { status: res.status, cookie: set, data: type.includes("ndjson") ? (await res.text()).trim().split("\n").map((l) => JSON.parse(l)) : await res.json() };
  };
}

test("accounts: sign up, profile, friends need consent, secure cookie, delete", async () => {
  const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:") };
  const minh = client(env), lan = client(env);
  const up = await minh("/api/account/signup", { method: "POST", body: { username: "minh", password: "correct horse", display: "Minh" } });
  assert.equal(up.status, 200);
  assert.match(up.cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await minh("/api/account/signup", { method: "POST", body: { username: "MINH", password: "another one", display: "x" } })).status, 409);
  assert.equal((await minh("/api/account/signup", { method: "POST", body: { username: "bob", password: "short", display: "x" } })).status, 400);
  await lan("/api/account/signup", { method: "POST", body: { username: "lan", password: "battery staple", display: "Lan" } });
  await lan("/api/account/profile", { method: "PUT", body: { display: "Lan", favorite: "Daft Punk", city: "Hanoi", mood: "cozy", cuisine: "sushi" } });
  assert.equal((await lan("/api/account")).data.user.cuisine, ""); // unknown cuisine dropped
  assert.equal((await minh("/api/account/friends", { method: "POST", body: { username: "lan" } })).data.status, "pending");
  assert.equal((await minh("/api/account")).data.friends[0].favorite, null); // no favorite before Lan accepts
  await lan("/api/account/friends/accept", { method: "POST", body: { username: "minh" } });
  assert.equal((await minh("/api/account")).data.friends[0].favorite, "Daft Punk");
  assert.equal((await minh("/api/account/profile", { method: "PUT", body: { favorite: "x" }, origin: "https://evil.example" })).status, 403);
  assert.equal((await minh("/api/account/login", { method: "POST", body: { username: "minh", password: "wrong password" } })).status, 401);
  assert.equal((await minh("/api/account/delete", { method: "POST", body: { password: "nope" } })).status, 401);
  assert.equal((await minh("/api/account/delete", { method: "POST", body: { password: "correct horse" } })).status, 200);
  assert.equal((await lan("/api/account")).data.friends.length, 0);
});

test("rooms: two phones, favorites hidden until the plan, shared plan and votes", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeEveningQloo();
  try {
    const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:") };
    const host = client(env), friend = client(env), stranger = client(env);
    const made = await host("/api/rooms", { method: "POST", body: { name: "Minh", favorite: "Spirited Away", settings: { mode: "evening", city: "New York", cuisine: "japanese", mood: "romantic", start: "18:30", day: "friday" } } });
    assert.equal(made.status, 200);
    const { id, token } = made.data;
    assert.match(made.data.url, new RegExp("/r/" + id + "$"));
    const seen = await friend("/api/rooms/" + id);
    assert.equal(seen.data.canJoin, true);
    assert.equal(seen.data.members[0].name, "Minh");
    assert.equal(seen.data.members[0].favorite, null); // blind until the plan exists
    assert.equal((await friend("/api/rooms/" + id + "/plan", { method: "POST" })).status, 403);
    const joined = await friend("/api/rooms/" + id + "/join", { method: "POST", body: { name: "Lan", favorite: "Daft Punk" } });
    const friendToken = joined.data.token;
    assert.equal((await stranger("/api/rooms/" + id + "/join", { method: "POST", body: { name: "X", favorite: "Radiohead" } })).status, 409);
    const run = await host("/api/rooms/" + id + "/plan", { method: "POST", headers: { "x-room-token": token } });
    assert.equal(run.data.at(-1).event, "result");
    assert.deepEqual(run.data.at(-1).plan.seeds.map((s) => s.person), ["Minh", "Lan"]);
    const view = await friend("/api/rooms/" + id, { headers: { "x-room-token": friendToken } });
    assert.equal(view.data.you, 1);
    assert.equal(view.data.members[0].favorite, "Spirited Away"); // revealed with the plan
    const option = view.data.plan.stops[0].options[0].id;
    assert.equal((await friend("/api/rooms/" + id + "/vote", { method: "POST", headers: { "x-room-token": friendToken }, body: { option, value: 1 } })).status, 200);
    assert.equal((await friend("/api/rooms/" + id + "/vote", { method: "POST", headers: { "x-room-token": friendToken }, body: { option: "made-up", value: 1 } })).status, 400);
    assert.equal((await stranger("/api/rooms/" + id + "/vote", { method: "POST", body: { option, value: 1 } })).status, 403);
    const after = await host("/api/rooms/" + id, { headers: { "x-room-token": token } });
    assert.deepEqual(after.data.votes[option], { up: 1, down: 0, mine: 0 });
    assert.equal((await host("/api/rooms/nosuchroom1")).status, 404);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("rooms never reveal the host's location and reject oversized bodies", async () => {
  const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:") };
  const host = client(env), friend = client(env);
  const made = await host("/api/rooms", { method: "POST", body: { name: "Minh", favorite: "Spirited Away", settings: { mode: "evening", lat: 10.776912, lon: 106.700981 } } });
  const seen = await friend("/api/rooms/" + made.data.id);
  assert.equal(seen.data.settings.lat, undefined);
  assert.equal(seen.data.settings.lon, undefined);
  assert.equal(seen.data.settings.near, true);
  const big = await host("/api/account/login", { method: "POST", body: { username: "x", password: "y".repeat(9000) } });
  assert.equal(big.status, 413);
});

test("recovery codes reset a forgotten password once; changing a password signs out other devices", async () => {
  const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:") };
  const phone = client(env), laptop = client(env), thief = client(env);
  const up = await phone("/api/account/signup", { method: "POST", body: { username: "hoa", password: "first password", display: "Hoa" } });
  const code = up.data.recoveryCode;
  assert.match(code, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  await laptop("/api/account/login", { method: "POST", body: { username: "hoa", password: "first password" } });
  assert.equal((await thief("/api/account/recover", { method: "POST", body: { username: "hoa", code: "AAAA-BBBB-CCCC-DDDD", password: "stolen pass" } })).status, 401);
  const rec = await phone("/api/account/recover", { method: "POST", body: { username: "hoa", code: code.toLowerCase(), password: "second password" } });
  assert.equal(rec.status, 200);
  assert.notEqual(rec.data.recoveryCode, code);
  assert.equal((await laptop("/api/account")).data.user, null); // signed out everywhere else
  assert.equal((await phone("/api/account/recover", { method: "POST", body: { username: "hoa", code, password: "third password" } })).status, 401); // one use only
  assert.equal((await phone("/api/account/password", { method: "POST", body: { current: "wrong", password: "fourth password" } })).status, 401);
  assert.equal((await phone("/api/account/password", { method: "POST", body: { current: "second password", password: "fourth password" } })).status, 200);
  assert.equal((await phone("/api/account")).data.user.username, "hoa"); // this device stays signed in
});

test("places you have been: marked and moved down, places rated 👎 never come back, plans are saved", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeQloo().fetch;
  try {
    const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:") };
    const me = client(env);
    await me("/api/account/signup", { method: "POST", body: { username: "tuan", password: "a good password", display: "Tuan" } });
    const body = { first: "Radiohead", second: "Lady Bird", city: "Hanoi", occasion: "coffee" };
    const first = await me("/api/plan", { method: "POST", body });
    const [top, second] = first.data.places;
    await me("/api/account/visits", { method: "POST", body: { place: top } });
    await me("/api/account/visits", { method: "POST", body: { place: { ...second, id: "not-a-uuid" } } }); // rejected quietly by validation
    const acct = (await me("/api/account")).data;
    assert.equal(acct.visits.length, 1);
    assert.ok(acct.plans.length >= 1);
    const again = await me("/api/plan", { method: "POST", body });
    assert.equal(again.data.places.find((p) => p.id === top.id)?.been, true);
    await me("/api/account/visits/rate", { method: "POST", body: { id: acct.visits[0].id, rating: -1 } });
    const third = await me("/api/plan", { method: "POST", body });
    assert.equal(third.data.places.some((p) => p.id === top.id), false);
    const saved = await me("/api/account/plans/" + acct.plans[0].id);
    assert.ok(saved.data.plan.places.length);
    assert.equal((await me("/api/account/plans/999")).status, 404);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("how was it: a past plan asks once, and the answer fills your places", async () => {
  let t = 1_800_000_000_000;
  const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:", () => t) };
  const me = client(env);
  await me("/api/account/signup", { method: "POST", body: { username: "linh", password: "a good password", display: "Linh" } });
  const user = env.STORE.userByName("linh");
  const place = { id: "00000000-0000-4000-8000-000000000070", name: "Sushi Place", address: "1 Main St" };
  env.STORE.savePlanFor(user.id, "Tonight · New York", { stops: [{ slot: "dinner", options: [place] }], seeds: [{ person: "Linh" }, { person: "Bao" }] });
  assert.equal((await me("/api/account")).data.review, null);
  t += 4 * 3600000;
  const review = (await me("/api/account")).data.review;
  assert.equal(review.title, "Tonight · New York");
  await me("/api/account/review", { method: "POST", body: { id: review.id, went: [{ id: place.id, rating: 1 }, { id: "00000000-0000-4000-8000-000000000999" }] } });
  const after = (await me("/api/account")).data;
  assert.equal(after.review, null);
  assert.deepEqual(after.visits.map((v) => [v.name, v.withName, v.rating]), [["Sushi Place", "Bao", 1]]);
});

test("weather: a dry evening lets the rooftop win, and no forecast means no weather at all", async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const [rain, top, hasWeather] of [[0, "Sky Rooftop", true], [null, "Sky Rooftop", false]]) {
      globalThis.fetch = fakeEveningQloo(rain);
      const p = await evening({ first: "Spirited Away", second: "Daft Punk", city: "New York", start: "18:30", day: "friday" }, "k", "https://hackathon.api.qloo.com");
      assert.equal(p.stops[1].options[0].name, top);
      assert.equal(!!p.weather, hasWeather);
      assert.equal(p.stops[1].options[0].outdoor, true);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("visits remember how long you stayed without changing when you went", async () => {
  let t = 1_800_000_000_000;
  const store = openStore(":memory:", () => t);
  const { user } = store.createUser({ username: "vy", password: "a good password", display: "Vy" });
  const place = { id: "00000000-0000-4000-8000-000000000080", name: "Wine Bar" };
  store.addVisit(user.id, place, "Bao");
  t += 90 * 60000;
  store.addVisit(user.id, place, "", 85);
  const [v] = store.visitsOf(user.id);
  assert.equal(v.minutes, 85);
  assert.equal(v.withName, "Bao");
  assert.equal(v.visited, 1_800_000_000_000);
});

test("memories: photos lose hidden GPS, friends see only shared check-ins, strangers see nothing", async () => {
  const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:") };
  const ann = client(env), bob = client(env), cat = client(env);
  for (const [c, u] of [[ann, "ann"], [bob, "bob"], [cat, "cat"]]) await c("/api/account/signup", { method: "POST", body: { username: u, password: "a good password", display: u } });
  await ann("/api/account/friends", { method: "POST", body: { username: "bob" } });
  await bob("/api/account/friends/accept", { method: "POST", body: { username: "ann" } });
  const place = { id: "00000000-0000-4000-8000-000000000070", name: "Sushi Place", lat: 40.757, lon: -73.9866 };
  await ann("/api/account/visits", { method: "POST", body: { place } });
  const visit = (await ann("/api/account/memories")).data.mine[0];
  assert.equal(visit.lat, 40.757);
  const gps = new TextEncoder().encode("Exif  GPS 40.7N");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, gps.length + 2, ...gps, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]);
  const up = await ann(`/api/account/visits/${visit.id}/photo`, { method: "POST", body: jpeg });
  assert.equal(up.status, 200);
  assert.equal((await ann(`/api/account/visits/${visit.id}/photo`, { method: "POST", body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })).status, 400);
  assert.equal((await bob(`/api/account/visits/${visit.id}/photo`, { method: "POST", body: jpeg })).status, 400); // not Bob's check-in
  const own = await ann(up.data.photo);
  assert.equal(own.status, 200);
  assert.equal(new TextDecoder().decode(own.bytes).includes("GPS"), false);
  assert.equal((await bob(up.data.photo)).status, 404); // not shared yet
  assert.equal((await bob("/api/account/memories")).data.friends.length, 0);
  await ann(`/api/account/visits/${visit.id}/memory`, { method: "POST", body: { note: "Best omakase", shared: true } });
  assert.equal((await bob(up.data.photo)).status, 200);
  assert.deepEqual((await bob("/api/account/memories")).data.friends.map((x) => [x.friend, x.note]), [["ann", "Best omakase"]]);
  assert.equal((await cat(up.data.photo)).status, 404);
  assert.equal((await cat("/api/account/memories")).data.friends.length, 0);
});

test("a reading picked from the suggestions is used instead of the default one", async () => {
  const realFetch = globalThis.fetch;
  const reply = (body) => new Response(JSON.stringify(body));
  globalThis.fetch = async (url) => {
    const u = new URL(String(url)), q = (k) => u.searchParams.get(k);
    if (u.pathname === "/search") {
      if (q("query") === "Harry Potter") return reply({ results: [item(2, "Harry Potter", { types: ["urn:entity:movie"] }), item(3, "Harry Potter", { types: ["urn:entity:book"] }), item(9, "Harry Potter Shop", { types: ["urn:entity:place"] })] });
      return reply({ results: [item(1, q("query"), { types: ["urn:entity:artist"] })] });
    }
    const [x, y] = q("signal.interests.entities").split(",");
    const ent = (n, name) => item(n, name, { properties: { address: "Hanoi" }, query: { explainability: { "signal.interests.entities": [{ entity_id: x, score: 0.5 }, { entity_id: y || x, score: 0.5 }] } } });
    return reply({ results: { entities: q("filter.type") === "urn:entity:movie" ? [ent(60, "Film")] : [ent(70, "Cafe A"), ent(71, "Cafe B"), ent(72, "Cafe C")] } });
  };
  try {
    const auto = await plan({ first: "Radiohead", second: "Harry Potter", city: "Hanoi" }, "k");
    assert.equal(auto.seeds[1].kind, "film");
    const picked = await plan({ first: "Radiohead", second: "Harry Potter", picks: [null, id(3)], city: "Hanoi" }, "k");
    assert.equal(picked.seeds[1].id, id(3));
    assert.equal(picked.seeds[1].kind, "book");
    const bogus = await plan({ first: "Radiohead", second: "Harry Potter", picks: [null, "not-an-id"], city: "Hanoi" }, "k");
    assert.equal(bogus.seeds[1].kind, "film");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("every language has every message, with the same placeholders as English", async () => {
  const { PAGE } = await import("../worker/i18n-page.js");
  const { SOCIAL } = await import("../worker/i18n-social.js");
  const { MSG } = await import("../worker/i18n-msg.js");
  const { TASTE } = await import("../worker/i18n-taste.js");
  const { MOMENTS } = await import("../worker/i18n-moments.js");
  const { LABELS } = await import("../worker/taste-ui.js");
  for (const l of Object.values(LABELS)) assert.ok(TASTE[l], `missing chip label ${l}`);
  const holes = (s) => (s.match(/\{\w+(?:\|\w+)?\}/g) || []).sort().join();
  for (const [k, v] of Object.entries({ ...PAGE, ...SOCIAL, ...TASTE, ...MOMENTS })) {
    assert.equal(v.length, 9, k);
    for (const t of v) assert.equal(holes(t), holes(k), `${k} → ${t}`);
  }
  for (const [k, v] of Object.entries(MSG)) {
    assert.equal(v.length, 10, k);
    for (const t of v) assert.equal(holes(t), holes(v[0]), `${k} → ${t}`);
  }
  const fs = await import("node:fs");
  const used = ["engine.js", "evening.js"].flatMap((f) => [...fs.readFileSync(new URL(`../worker/${f}`, import.meta.url), "utf8").matchAll(/M\('([\w.-]+)'/g)].map((m) => m[1]));
  for (const k of used) if (!k.endsWith(".")) assert.ok(MSG[k], `missing message ${k}`); // "pref." + p is checked below
  for (const p of ["veg", "thrifty", "fine", "kids"]) assert.ok(MSG["pref." + p]);
  const client = ["page.js", "social-ui.js", "taste-ui.js", "moments-ui.js"].flatMap((f) => [...fs.readFileSync(new URL(`../worker/${f}`, import.meta.url), "utf8").matchAll(/T\((?:'([^']+)'|"([^"]+)")/g)].map((m) => m[1] || m[2]));
  for (const k of client) if (!/\.$/.test(k)) assert.ok(PAGE[k] || SOCIAL[k] || TASTE[k] || MOMENTS[k] || MSG[k], `missing text ${k}`);
});

test("the browser T() fills templates, translates references and falls back to English", async () => {
  const vm = await import("node:vm");
  const { i18nScript, packScript, langPack } = await import("../worker/i18n.js");
  const run = (langs) => {
    const window = {}, written = [];
    const doc = { documentElement: {}, body: {}, title: "", createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [], getElementById: () => null, dispatchEvent() {}, write: (h) => written.push(h) };
    const ctx = { window, document: doc, navigator: { languages: langs }, localStorage: { getItem: () => null, setItem() {} }, NodeFilter: { SHOW_TEXT: 4 }, WeakMap, Event: class {} };
    vm.runInNewContext(i18nScript, ctx);
    // the core asks for its language pack while the page is parsed; load it like the browser would
    const m = /\/i18n\/(\w+)\.js/.exec(written.join(""));
    if (m) vm.runInNewContext(packScript(m[1]), ctx);
    return window;
  };
  const vi = run(["vi-VN", "en"]);
  assert.equal(vi.tbLang, "vi");
  assert.equal(vi.T("{min} min", { min: 5 }), "5 phút");
  assert.equal(vi.T({ k: "s.resolved.d", v: { a: "Amélie", ka: "film", b: "Daft Punk", kb: "artist" } }).includes("phim"), true);
  assert.equal(vi.T({ k: "s.refineStage.d", v: { count: 1, why: { k: "why.walk3", v: {} } } }).includes("{"), false);
  assert.equal(vi.T("Birthday"), "Sinh nhật");
  assert.equal(vi.T("cocktail bar"), "bar cocktail");
  assert.equal(vi.T("A sentence nobody translated."), "A sentence nobody translated.");
  assert.equal(vi.T("cuisine.burmese"), "burmese");
  assert.equal(run(["in-ID"]).tbLang, "id");
  const en = run(["pt-BR"]);
  assert.equal(en.tbLang, "en");
  assert.equal(en.T({ k: "s.weather.l" }), "Checking the weather");
  assert.equal(run(["ja"]).T("Sign in"), "ログイン");
  // a pack holds one language only, so it stays small
  assert.ok(packScript("vi").length < 0.2 * (await import("../worker/i18n.js")).i18nScript.length + 200000);
  assert.equal(langPack("en"), null);
});

test("a taste profile keeps only known genres and real ids, and counts as one person's signal", async () => {
  const { cleanProfile, profileSeed, tasteReport } = await import("../worker/taste.js");
  const { shareList } = await import("../worker/engine.js");
  const p = cleanProfile({
    sections: {
      film: { picks: [{ id: id(1), name: "Spirited Away", kind: "film" }, { id: "nope", name: "x" }], genres: ["urn:tag:genre:media:mystery", "urn:tag:genre:media:evil"] },
      book: { genres: ["urn:tag:genre:media:mystery"] },
      game: { genres: ["urn:tag:genre:media:mystery"] },
    },
    hobbies: ["urn:audience:leisure:coffee", "urn:audience:leisure:hacking"], instruments: ["urn:tag:instrument:qloo:guitar"],
  });
  assert.deepEqual(p.sections.film, { picks: [{ id: id(1), name: "Spirited Away", kind: "film" }], genres: ["urn:tag:genre:media:mystery"] });
  assert.deepEqual(p.sections.book.genres, ["urn:tag:genre:media:mystery"]);
  assert.equal(p.sections.game, undefined); // games have no genre filter
  assert.deepEqual(p.hobbies, ["urn:audience:leisure:coffee"]);
  // a profile person's share follows their best-fitting entity, so more favorites do not mean more weight
  const scored = { explain: [{ id: id(1), score: 0.3 }, { id: id(2), score: 0.3 }, { id: id(3), score: 0.4 }] };
  assert.deepEqual(shareList(scored, [`${id(1)},${id(2)}`, id(3)]), [43, 57]);
  assert.deepEqual(shareList({ explain: [{ id: id(1), score: 0.5 }, { id: id(2), score: 0.1 }, { id: id(3), score: 0.5 }] }, [`${id(1)},${id(2)}`, id(3)]), [50, 50]);

  const realFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url); calls.push(u.pathname + "?" + u.searchParams.toString());
    if (u.pathname === "/entities") return Response.json({ results: [{ entity_id: id(1), name: "Spirited Away", types: ["urn:entity:movie"], tags: [{ tag_id: "urn:tag:theme:qloo:coming_of_age", name: "Coming of age" }, { tag_id: "urn:tag:style:qloo:whimsical", name: "Whimsical" }] }] });
    const type = u.searchParams.get("filter.type");
    if (u.searchParams.get("filter.tags")) return Response.json({ results: { entities: [item(type === "urn:entity:book" ? 40 : 41, type === "urn:entity:book" ? "Gone Girl" : "Seven")] } });
    return Response.json({ results: { entities: [item(50, "Howl's Moving Castle", { types: [type] })] } });
  };
  try {
    const seed = await profileSeed(p, "k");
    assert.equal(seed.id, [id(1), id(41), id(40)].join(","));
    assert.equal(seed.name, "Spirited Away");
    const report = await tasteReport(p, "k");
    assert.deepEqual(report.portrait.themes, [{ name: "Coming of age", from: ["Spirited Away"] }]);
    assert.equal(report.discover.film[0].name, "Howl's Moving Castle");
    assert.ok(calls.some((c) => c.includes("filter.exclude.entities=" + id(1))));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("moments: friends see each other's photos and reactions at once, strangers see nothing", async () => {
  const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:") };
  const ann = client(env), bob = client(env), cat = client(env);
  for (const [c, u] of [[ann, "ann"], [bob, "bob"], [cat, "cat"]]) await c("/api/account/signup", { method: "POST", body: { username: u, password: "a good password", display: u } });
  await ann("/api/account/friends", { method: "POST", body: { username: "bob" } });
  await bob("/api/account/friends/accept", { method: "POST", body: { username: "ann" } });
  assert.equal((await ann("/api/account/moments", { method: "POST", body: {} })).status, 400); // nothing to post
  const place = { id: "00000000-0000-4000-8000-000000000080", name: "Rooftop Bar", lat: 10.77, lon: 106.7 };
  const posted = await ann("/api/account/moments", { method: "POST", body: { caption: "Sunset with Bob", place, photo: true } });
  assert.equal(posted.status, 200);
  const gps = new TextEncoder().encode("Exif\0\0GPS 10.7N");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, gps.length + 2, ...gps, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]);
  assert.equal((await bob(`/api/account/moments/${posted.data.id}/photo`, { method: "POST", body: jpeg })).status, 400); // not Bob's moment
  const up = await ann(`/api/account/moments/${posted.data.id}/photo`, { method: "POST", body: jpeg });
  assert.equal(up.status, 200);
  // posting at a place is also a check-in
  assert.equal((await ann("/api/account/memories")).data.mine[0].name, "Rooftop Bar");
  // Bob sees it straight away, with the photo, and it counts as new for him
  assert.equal((await bob("/api/account")).data.unseenMoments, 1);
  const feed = (await bob("/api/account/moments")).data;
  assert.deepEqual(feed.moments.map((m) => [m.display, m.caption, m.place, m.mine]), [["ann", "Sunset with Bob", "Rooftop Bar", false]]);
  const photo = await bob(feed.moments[0].photo);
  assert.equal(photo.status, 200);
  assert.equal(new TextDecoder().decode(photo.bytes).includes("GPS"), false);
  await bob("/api/account/moments/seen", { method: "POST", body: {} });
  assert.equal((await bob("/api/account")).data.unseenMoments, 0);
  // reactions: one per person, from a fixed set
  assert.equal((await bob(`/api/account/moments/${posted.data.id}/react`, { method: "POST", body: { emoji: "💩" } })).status, 400);
  await bob(`/api/account/moments/${posted.data.id}/react`, { method: "POST", body: { emoji: "🔥" } });
  await bob(`/api/account/moments/${posted.data.id}/react`, { method: "POST", body: { emoji: "❤️" } });
  const mine = (await ann("/api/account/moments")).data.moments[0];
  assert.deepEqual(mine.reactions, [{ emoji: "❤️", count: 1 }]);
  assert.deepEqual(mine.reactedBy, [{ display: "bob", emoji: "❤️" }]);
  // Cat is not a friend: no feed, no photo, no reacting
  assert.equal((await cat("/api/account/moments")).data.moments.length, 0);
  assert.equal((await cat(feed.moments[0].photo)).status, 404);
  assert.equal((await cat(`/api/account/moments/${posted.data.id}/react`, { method: "POST", body: { emoji: "❤️" } })).status, 404);
  // only the author can remove it, and the photo goes with it
  assert.equal((await bob(`/api/account/moments/${posted.data.id}/remove`, { method: "POST", body: {} })).status, 404);
  assert.equal((await ann(`/api/account/moments/${posted.data.id}/remove`, { method: "POST", body: {} })).status, 200);
  assert.equal((await bob(feed.moments[0].photo)).status, 404);
});

test("rooms keep each person's taste profile and plan with it, without showing it to the other phone", async () => {
  const env = { QLOO_API_KEY: "k", STORE: openStore(":memory:") };
  const host = client(env), guest = client(env);
  const profile = { sections: { film: { picks: [{ id: id(1), name: "Spirited Away", kind: "film" }], genres: ["urn:tag:genre:media:mystery"] } }, hobbies: [] };
  const made = await host("/api/rooms", { method: "POST", body: { name: "An", profile, settings: { mode: "evening", city: "Hanoi" } } });
  assert.equal(made.status, 200);
  const room = env.STORE.room(made.data.id);
  assert.equal(room.members[0].favorite, "Spirited Away");
  assert.deepEqual(room.members[0].profile.sections.film.genres, ["urn:tag:genre:media:mystery"]);
  assert.equal(room.members[0].pick, null);
  const view = (await guest(`/api/rooms/${made.data.id}`)).data;
  assert.equal(view.members[0].favorite, null);
  assert.equal("profile" in view.members[0], false);
  const joined = await guest(`/api/rooms/${made.data.id}/join`, { method: "POST", body: { name: "Binh", favorite: "Daft Punk", profile: { sections: { music: { genres: ["urn:tag:genre:music:not_real"] } } } } });
  assert.equal(joined.status, 200);
  assert.equal(env.STORE.room(made.data.id).members[1].profile, null); // nothing valid in it: the typed favorite is used
});

test("family evenings leave out bars by category and by name, but not words that only start the same", async () => {
  const { familyFriendly } = await import("../worker/family.js");
  assert.equal(familyFriendly("event planner", "Zodiac Bar, Club and Karaoke"), false);
  assert.equal(familyFriendly("cocktail bar", "Anything"), false);
  assert.equal(familyFriendly("restaurant", "Barbecue House"), true);
  assert.equal(familyFriendly("restaurant", "Clubhouse Diner"), true);
  assert.equal(familyFriendly("ice cream shop", "Gelato Lab"), true);
});
