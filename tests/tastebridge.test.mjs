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

function fakeEveningQloo() {
  const reply = (body) => new Response(JSON.stringify(body));
  const place = (n, name, cats, extra, lat, lon, x, y) => item(n, name, {
    location: { lat, lon },
    tags: cats.map((c) => ({ id: c })),
    properties: { address: "1 Main St, New York", business_rating: 4.5, price_level: 2, image: { url: `https://images.qloo.com/${n}.jpg` }, ...extra },
    query: { explainability: { "signal.interests.entities": [{ entity_id: x, score: 0.5 }, { entity_id: y || x, score: 0.5 }] } },
  });
  return async (url) => {
    const u = new URL(String(url)), q = (k) => u.searchParams.get(k);
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
    assert.equal(p.stops[1].options[0].name, "Wine Bar"); // the closer stop wins
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
    const res = await worker.fetch(new Request("http://x" + path, {
      method, body: body && JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: jar, origin, "x-forwarded-for": "198.51.100." + (Math.random() * 200 | 0), ...headers },
    }), env);
    const set = res.headers.get("set-cookie");
    if (set) jar = set.split(";")[0];
    const type = res.headers.get("content-type") || "";
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
  const big = await host("/api/account/login", { method: "POST", body: { username: "x", password: "y".repeat(5000) } });
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
