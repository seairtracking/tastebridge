# TasteBridge

**A Qloo-powered planning agent for people with different tastes: fair plans, with evidence.**

One friend loves Studio Ghibli, the other lives for Daft Punk. TasteBridge takes one cultural favorite
from each person, a city and an occasion (dinner, drinks, coffee, culture or a night out), and finds a
**fair compromise**: places to go together and films to watch. Every pick shows **how much it is driven
by each person**, using Qloo explainability, so nobody's taste quietly wins.

- **Live demo:** https://tastebridge.trackingport.com
- **Demo video (1:44):** https://youtu.be/WYHLv6PQkuU
- **MCP server for AI assistants:** `https://tastebridge.trackingport.com/mcp`
- Built for the **Qloo Agentic Hackathon** (2026)

## What the agent does

TasteBridge is not a single API call. It plans, checks its evidence and changes course, and the web
app streams each step live:

1. **Understand both tastes.** Qloo Search resolves each favorite. When a name has several readings
   (an album, a TV show and a book all called "Harry Potter"), they are ranked by the types that carry
   the most taste signal.
2. **Check the signal.** The agent asks Qloo Insights for films that fit both people, with
   `feature.explainability`. If one favorite barely shapes the results (some Qloo entities carry almost
   no taste data), it **switches to the next reading** of that favorite, or tells the user honestly when
   none works.
3. **Search places for the occasion.** Three Insights calls per round (person A, person B, both
   together), filtered by occasion tag, city and radius.
4. **Refine when there is too little common ground.** If fewer than three strong places are found, the
   agent widens the radius to 40 km and relaxes the quality filter, then drops the occasion filter, and
   keeps whichever round gave the best result.
5. **Rank for fairness.** A fairness-weighted reciprocal-rank rule rewards places that rank well for
   *both* people (`min(a, b) * 6 + (a + b) * 0.8 + joint * 1.3`, with `score = 1 / (4 + rank)`), and
   down-weights places outside the requested city, places whose main Qloo category does not suit the
   occasion (a museum that happens to have a bar is not a drinks spot), and the most generic landmarks.
6. **Show each person's share.** Each place and film carries an A/B split from Qloo explainability.
   Films are the combined-taste results closest to an even split; when there is almost no shared film
   taste, the agent picks one film for each person instead of pretending there is overlap.
7. **Show what you need to decide.** Every place card has a photo, Qloo rating, price level, a map link and
   the website; every film has its poster, year and genres. All of it comes from Qloo's entity data.

Without Qloo the app has nothing to rank: no live data means no plan. The UI only offers a clearly
labeled illustrative sample.

Live examples:

| Pair | Plan |
|---|---|
| Spirited Away + Daft Punk, dinner in New York | La Grande Boucherie 49/51, Katz's Delicatessen 48/52; films Inception 50/50, Blade Runner 50/50 |
| Wes Anderson + Arctic Monkeys, drinks in London | The Thin White Duke 50/50, Cavalry & Guards Club 49/51, MAP Maison 47/53; films The Lobster 50/50, Frank 51/49 |
| Taylor Swift + Radiohead, drinks in Hanoi | MK Rooftop Bar 51/49, Skyline Hanoi 52/48; films 500 Days of Summer 52/48, Lady Bird 53/47 |
| Lady Gaga + Stranger Things, coffee in Melbourne | "Stranger Things" first matched a film with almost no taste data, so the agent switched to the TV show, then widened the search; Ample Cafe & Bar 49/51, Krispy Kreme Swanston St 50/50; films It 51/49, Get Out 50/50 |
| Studio Ghibli + Christopher Nolan, culture in Tokyo | Museums 61/39; Qloo has almost no film signal for Nolan as a person, so the agent tries each reading and then warns the user instead of faking a fair film pick |

## Use it from Claude, ChatGPT or any MCP client

TasteBridge is a remote MCP server (Streamable HTTP, stateless JSON responses):

- **Claude:** Settings → Connectors → Add custom connector → `https://tastebridge.trackingport.com/mcp`
- **ChatGPT:** Settings → Connectors → Create (developer mode) → the same URL

Tools:

| Tool | Input | Output |
|---|---|---|
| `find_common_ground` | `first`, `second`, `city`, `occasion` (`dinner`, `drinks`, `coffee`, `culture`, `night-out`) | A readable summary plus the full plan as `structuredContent` (places with shares, films, the agent's steps) |
| `resolve_favorite` | `name` | The top Qloo readings of a favorite with their types |

Try: *"My partner loves Wes Anderson films, I love Arctic Monkeys. Find us somewhere for drinks in London
that is fair to both."*

## Reliability

The hackathon key allows only a few requests in flight. TasteBridge queues Qloo calls (at most 3 at a
time), retries `429 Rate limit exceeded` with backoff, tolerates a failing side list, removes duplicate
venues that Qloo stores as separate records, caches identical plans for 10 minutes, and limits each
client to 20 fresh plans per 10 minutes in the web app (120 for MCP, because Claude and ChatGPT calls
arrive from a few shared provider addresses).

## Privacy

Only the two public cultural favorites, the city and the occasion are sent to the server for that
request. No accounts, no stored profiles. Qloo returns aggregate cultural associations; TasteBridge does
not infer anyone's identity or sensitive traits.

## Run it

Requirements: Node.js 20.6 or newer. No npm dependencies.

```bash
cp .env.example .env      # then put your Qloo hackathon key in .env
npm start                 # http://127.0.0.1:8787
npm test                  # unit tests (mocked Qloo, no key needed)
```

### Deploy

- **Any server (what the live demo uses):** run `node local-server.mjs` behind a reverse proxy
  (the demo uses Caddy for HTTPS and systemd with `QLOO_API_KEY` / `QLOO_API_URL` in an environment file).
- **Cloudflare Workers:** `npx wrangler secret put QLOO_API_KEY`, then `npm run deploy:cloudflare`.

## HTTP API

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | The web app |
| `/api/plan` | POST | `{"first", "second", "city", "occasion"}` → the plan as JSON. With `Accept: application/x-ndjson` it streams `{"event":"step"}` lines as the agent works, then `{"event":"result"}` |
| `/mcp` | POST | MCP endpoint (JSON-RPC: `initialize`, `tools/list`, `tools/call`, `ping`) |
| `/api/status` | GET | `{"live": true, ...}` when a Qloo key is configured |
| `/health` | GET | Health check |

## Project layout

```
worker/index.js     Routes, NDJSON streaming, cache and per-client rate limit (Workers-style fetch handler)
worker/engine.js    The planning agent: signal check, search rounds, refinement, fairness ranking, films
worker/qloo.js      Qloo client: entity parsing, explainability, request queue and 429 retries
worker/mcp.js       MCP server: tool definitions and JSON-RPC handling
worker/page.js      The web app (single page, no build step)
local-server.mjs    Node.js HTTP adapter that serves the worker on a normal server, with streaming
tests/              node:test unit tests with a mocked Qloo API
wrangler.toml       Optional Cloudflare Workers config
```

## License

[MIT](LICENSE)
