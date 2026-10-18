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
  await assert.rejects(plan({ first: "A", second: "Radiohead", city: "Hanoi" }, "k"), /two favorites and a city/);
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
  assert.deepEqual(list.result.tools.map((t) => t.name), ["find_common_ground", "resolve_favorite"]);
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
