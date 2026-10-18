// Run with: npm test  (node --test, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { plan, bridge, entity } from "../worker/index.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n, name) => ({ entity_id: id(n), name });

test("entity keeps only Qloo records with a UUID and a name", () => {
  assert.deepEqual(entity(item(1, "Radiohead")), { id: id(1), name: "Radiohead", address: "" });
  assert.equal(entity({ entity_id: "not-a-uuid", name: "x" }), null);
  assert.equal(entity({ entity_id: id(2) }), null);
});

test("bridge ranks places both people share above one-sided favorites", () => {
  const shared = { id: id(10), name: "Shared Cafe" };
  const onlyA = { id: id(11), name: "A Bar" };
  const onlyB = { id: id(12), name: "B Club" };
  const result = bridge([onlyA, shared], [onlyB, shared], []);
  assert.equal(result[0].name, "Shared Cafe");
  assert.equal(result[0].reason, "Appears in both individual Qloo lists.");
});

test("bridge drops duplicate venue names Qloo stores as separate records", () => {
  const result = bridge([{ id: id(20), name: "Big Ben" }], [{ id: id(21), name: "Big ben" }], [{ id: id(22), name: "Tower Bridge" }]);
  assert.equal(result.filter((p) => p.name.toLowerCase() === "big ben").length, 1);
});

test("plan uses Qloo Search then Insights, keeps at most 2 calls in flight and retries 429s", async () => {
  const realFetch = globalThis.fetch;
  let inFlight = 0, peak = 0, rateLimited = false;
  globalThis.fetch = async (url) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    const u = new URL(String(url));
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (u.pathname === "/search") {
      return reply({ results: [item(u.searchParams.get("query") === "Radiohead" ? 1 : 2, u.searchParams.get("query"))] });
    }
    if (!rateLimited && u.searchParams.get("filter.type") === "urn:entity:movie") {
      rateLimited = true; // first movie call is rate limited once
      return reply({ error_msg: "Rate limit exceeded" }, 429);
    }
    if (u.searchParams.get("filter.type") === "urn:entity:movie") return reply({ results: { entities: [item(50, "Lady Bird")] } });
    return reply({ results: { entities: [item(30, "Shared Cafe"), item(31, "Night Market")] } });
  };
  try {
    const result = await plan({ first: "Radiohead", second: "Taylor Swift", city: "Hanoi" }, "test-key", "https://hackathon.api.qloo.com");
    assert.equal(result.source, "qloo-live");
    assert.equal(result.places[0].name, "Shared Cafe");
    assert.equal(result.films[0].name, "Lady Bird");
    assert.ok(rateLimited, "a 429 was simulated");
    assert.ok(peak <= 2, `peak concurrency ${peak}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("plan rejects incomplete input before calling Qloo", async () => {
  await assert.rejects(plan({ first: "A", second: "Radiohead", city: "Hanoi" }, "k"), /two favorites and a city/);
});
