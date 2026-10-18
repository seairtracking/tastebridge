# TasteBridge

**A Qloo-powered group discovery agent: different tastes, better plans.**

One friend loves arthouse films, another lives for electronic music. TasteBridge takes one cultural
favorite from each person plus a city, and finds a **fair compromise**: places to go together and films
to watch, ranked by how well they serve *both* people, not just the louder taste.

- **Live demo:** https://tastebridge.trackingport.com
- Built for the **Qloo Agentic Hackathon** (2026)

## Why it needs Qloo

A generic LLM can only guess what "a Taylor Swift fan and a Radiohead fan" might both enjoy in
Ho Chi Minh City. TasteBridge grounds every suggestion in Qloo's taste graph:

1. **Qloo Search** resolves each free-text favorite to a real Qloo entity.
2. **Qloo Insights** is asked three times for places in the chosen city: once for person A's taste,
   once for person B's, and once for the **combined** taste signal.
3. **Qloo Insights** is asked for films from the combined signal.
4. TasteBridge's agent step ranks every candidate with a **fairness-weighted reciprocal-rank** rule.
   It rewards places that rank well for *both* people
   (`min(scoreA, scoreB) * 6 + (scoreA + scoreB) * 0.8 + jointScore * 1.3`, where `score = 1 / (4 + rank)`).
   Each result says why it was chosen ("appears in both individual Qloo lists", "appears in Qloo's
   combined-taste list", or "an alternative favored by one person").

Without Qloo the app has nothing to rank: no live data means no plan. The UI only offers a clearly
labeled static sample.

Example (live): *Beyoncé + Coldplay in London* → Tower Bridge, Big Ben, The Lion King London Musical,
Palace of Westminster; films: The Fault in Our Stars, The Theory of Everything, Begin Again.

## Reliability

The hackathon key allows only a few requests in flight. TasteBridge queues Qloo calls (at most 2 at a
time), retries `429 Rate limit exceeded` with backoff, removes duplicate venues that Qloo stores as
separate records, and caches identical plans for 10 minutes.

## Privacy

Only the two public cultural favorites and the city you type are sent to the server for that request.
No accounts, no stored profiles. Qloo returns aggregate cultural associations; TasteBridge does not
infer anyone's identity or sensitive traits.

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

## API

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | The web app |
| `/api/plan` | POST | `{"first": "...", "second": "...", "city": "..."}` → `{ source, city, seeds, places[], films[], method }` |
| `/api/status` | GET | `{"live": true}` when a Qloo key is configured |
| `/health` | GET | Health check |

## Project layout

```
worker/index.js     The app: web page, API routes, Qloo client, fairness ranking (Workers-style fetch handler)
local-server.mjs    Node.js HTTP adapter that serves the worker on a normal server
tests/              node:test unit tests with a mocked Qloo API
wrangler.toml       Optional Cloudflare Workers config
```

## License

[MIT](LICENSE)
