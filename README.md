# TasteBridge

**A Qloo-powered planning agent for people with different tastes: fair plans, with evidence.**

Two people finish work. One loves Studio Ghibli, the other lives for Daft Punk. Where do they eat, where
do they go after, and what do they watch at home? TasteBridge takes one cultural favorite from each
person and plans **a whole evening that is fair to both**: dinner by cuisine and mood, a second stop a
short walk away, a live music or show venue, and a film for home. Every pick shows **how much it is
driven by each person**, using Qloo explainability, so nobody's taste quietly wins.

Two ways to use it:

- **Tonight's plan:** a timeline for the evening. Pick a start time, what to eat, a mood (romantic,
  cozy, lively, quiet, chill) and a budget, and type a city or tap **Use my location**.
- **Quick shortlist:** four fair places for one occasion (dinner, drinks, coffee, culture or a night out).
- **Special occasions:** birthday, anniversary, first date, date night, celebration, friends reunion,
  family or business dinner. Each one uses Qloo's own "good for" and ambience tags (for example
  `good_for:anniversary_dinners`, `ambience:family_friendly`), sets a default mood, raises the quality bar
  for upscale occasions, picks the right kind of second stop, and keeps family evenings away from bars.
- **Plan on two phones:** one person creates an invite and sends the link. The friend opens it on their
  own phone and adds their favorite; **neither sees the other's pick until the plan is ready**, so nobody
  adjusts to the other. Both phones see the same plan and can vote 👍/👎 on every option.
- **Optional accounts:** keep your favorite, city and usual food and mood in a profile, add friends by
  username (they must accept), and plan with a friend in one tap: their profile fills their side, and
  the plan shows up on their phone too. Everything still works without an account.
- **Map, directions and weather:** Tonight's plan shows the stops on a map (OpenStreetMap data, tiles from
  openstreetmap.de) with a walking-directions link through all of them, starting from you when you shared
  your location. The agent checks the hourly forecast (Open-Meteo, no key) at the dinner spot: when rain
  is likely it keeps the next stops a short walk away and prefers indoor places over rooftops and
  terraces; on a dry, mild evening it favours them.
- **Notice where I go (opt-in):** while the app is open, it can ask "Are you at …?" when you are at a place
  from your plan and note how long you stay. Location is compared on the phone; only the place you
  confirm is saved. Background tracking would need a native app and is not done.
- **Places you've been:** tap **Been here ✓** on a place, or answer **How was it?** the next time you open
  the app after a plan. Your history (with date, who you went with, ❤️ or 👎) shapes the next plan: places
  you have been are marked and move down so somewhere new comes first, and places you rated 👎 are never
  suggested again. Signed-in plans are saved (the latest 30) and can be reopened.
- **Memories:** every place you have been on one map, each with an optional photo and note. Share a
  memory with friends who accepted you and see theirs on the same map. Photos are re-encoded on the
  phone and stripped of EXIF/XMP metadata (including GPS) on the server, stored outside the code folder,
  and served only to their owner and, for shared memories, to accepted friends.
- **Account recovery without email:** sign-up shows a one-time recovery code; **Forgot password?** uses it
  to set a new password, and **Change password** is in your profile. Both sign out your other devices.
- **Taste profile ("What do I really like?"):** instead of one favorite, name up to 3 works per section (films, series, music,
  books, games, sports, travel, brands) and pick genres; genres alone work when you cannot remember titles. TasteBridge
  reads the Qloo tags your favorites share (themes, feel, kind of fan, interests) and suggests films, series, artists,
  books and destinations that fit the whole profile. Genres stand in as their best-known works (mystery books →
  *Gone Girl*, *The Silent Patient*). Instruments and hobbies describe you but never steer places: Qloo's hobby
  audiences proved too loose. In a plan, the profile is one person's signal, and their share follows their best-fitting
  favorite, so naming five things does not outweigh a friend who named one.
- **10 languages:** English, Tiếng Việt, 日本語, 한국어, 中文, ไทย, Bahasa Indonesia, Español, Français and
  Deutsch. The app follows the phone's language and has a picker in the header. The agent's steps, reasons,
  tips and errors are sent as message keys, so a finished plan switches language without asking Qloo again.

It runs in the browser and **installs like an app** on iPhone (Share → Add to Home Screen) and Android
(Install app).

- **Live demo:** https://tastebridge.trackingport.com
- **Demo video (1:46):** https://youtu.be/K_mPx7ufQa4
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
7. **Plan the evening stop by stop** (Tonight's plan). Dinner is filtered by cuisine and mood; if too
   few places fit, the agent lets the mood guide the ranking instead of filtering, then widens the area.
   The second stop and the show are searched **around the dinner spot** with walking time, and every stop
   prefers places that are open at that hour (when Qloo lists hours) and within budget. Qloo has no event
   listings, so show venues link to their own programme. Adult entertainment venues are never suggested.
8. **Show what you need to decide.** Every place card has a photo, Qloo rating, price level, a map link and
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
| `plan_evening` | `first`, `second`, `city` or `lat`/`lon`, optional `start`, `day`, `cuisine`, `mood`, `budget` | A timeline (dinner, second stop with walking time, show, film) plus the full plan as `structuredContent` |
| `resolve_favorite` | `name` | The top Qloo readings of a favorite with their types |

Try: *"My partner loves Wes Anderson films, I love Arctic Monkeys. Plan us a cozy evening in London from
6 pm, Italian food, not too expensive."*

## Accounts, rooms and security

Accounts and two-phone rooms are stored in SQLite (`node:sqlite`) in a folder outside the code
(`TASTEBRIDGE_DB`), so deploys never touch them.

- Passwords are hashed with scrypt and a random salt and compared in constant time; unknown usernames
  take the same time to reject.
- Sessions are random 256-bit tokens stored only as SHA-256 hashes, sent in an `HttpOnly; Secure;
  SameSite=Lax` cookie, and expire after 30 days. Requests that change data must come from the same
  origin.
- A friend's favorite is visible only after they accept the friend request. In a room, each person's
  favorite stays hidden from the other until the plan is made, and the host's location never leaves the
  server.
- Recovery codes are shown once, stored only as scrypt hashes, work once, and are rate limited.
- Rooms expire after 48 hours. Deleting an account (password required) removes the profile, friendships,
  sessions and the rooms it hosted.
- Sign-up, sign-in, friend requests and invites are rate limited per connection; request bodies are
  capped at 4 KB.

## Reliability

The hackathon key allows only a few requests in flight. TasteBridge queues Qloo calls (at most 3 at a
time), retries `429 Rate limit exceeded` with backoff, tolerates a failing side list, removes duplicate
venues that Qloo stores as separate records, caches identical plans for 10 minutes, and limits each
client to 20 fresh plans per 10 minutes in the web app (120 for MCP, because Claude and ChatGPT calls
arrive from a few shared provider addresses).

## Privacy

Only the two public cultural favorites, the city or location, and the evening choices are sent to the
server for that request. **Use my location** is optional, asks the browser's permission, is rounded to
about 10 m in the browser before it is sent, and is not stored. No accounts, no stored profiles. Qloo returns aggregate cultural associations; TasteBridge does
not infer anyone's identity or sensitive traits.

## Run it

Requirements: Node.js 22.5 or newer (for `node:sqlite`). No npm dependencies.

```bash
cp .env.example .env      # then put your Qloo hackathon key in .env
npm start                 # http://127.0.0.1:8787
npm test                  # unit tests (mocked Qloo, no key needed)
```

### Deploy

- **Any server (what the live demo uses):** run `node local-server.mjs` behind a reverse proxy
  (the demo uses Caddy for HTTPS and systemd with `QLOO_API_KEY` / `QLOO_API_URL` in an environment file).
- **Cloudflare Workers:** `npx wrangler secret put QLOO_API_KEY`, then `npm run deploy:cloudflare`. The
  guest planner and MCP work there; accounts and two-phone rooms need the Node server and its SQLite file.

## HTTP API

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | The web app |
| `/api/plan` | POST | `{"first", "second", "city", "occasion"}` → the plan as JSON. With `Accept: application/x-ndjson` it streams `{"event":"step"}` lines as the agent works, then `{"event":"result"}` |
| `/api/evening` | POST | `{"first", "second", "city" or "lat"/"lon", "start", "day", "cuisine", "mood", "budget"}` → the evening plan, streamed the same way |
| `/api/rooms` | POST | Create a two-phone plan: `{"name", "favorite", "settings"}` → `{id, token, url}` |
| `/api/rooms/:id` | GET | Room state for the `x-room-token` holder (favorites hidden until the plan exists) |
| `/api/rooms/:id/join`, `/plan`, `/vote` | POST | Join with your own favorite, run the plan (streamed), vote on an option |
| `/api/account/memories`, `/api/account/visits/:id/memory`, `/api/account/visits/:id/photo`, `/api/photos/:name` | GET / POST | Memories map, notes, sharing and photos (JPEG, up to 3 MB) |
| `/api/account`, `/api/account/signup`, `/login`, `/logout`, `/profile`, `/friends`, `/friends/accept`, `/friends/remove`, `/delete` | GET / POST / PUT | Optional accounts, profile and friends |
| `/mcp` | POST | MCP endpoint (JSON-RPC: `initialize`, `tools/list`, `tools/call`, `ping`) |
| `/api/status` | GET | `{"live": true, ...}` when a Qloo key is configured |
| `/health` | GET | Health check |
| `/manifest.webmanifest`, `/sw.js`, `/icon-*.png` | GET | Installable app (PWA) |

## Project layout

```
worker/index.js     Routes, NDJSON streaming, cache and per-client rate limit (Workers-style fetch handler)
worker/engine.js    The planning agent: signal check, search rounds, refinement, fairness ranking, films
worker/evening.js   Tonight's plan: dinner, a nearby second stop, a show, walking time and opening hours
worker/app.js       Installable app: manifest, service worker and icons
worker/store.js     SQLite storage: accounts, sessions, friends, two-phone rooms and votes
worker/social.js    Account and room API (optional; the guest planner never needs it)
worker/social-ui.js Browser script for sign-in, profile, friends, invites, rooms and votes
worker/qloo.js      Qloo client: entity parsing, explainability, request queue and 429 retries
worker/mcp.js       MCP server: tool definitions and JSON-RPC handling
worker/page.js      The web app (single page, no build step)
worker/taste.js     Taste profile: checked Qloo genre ids, portrait from shared tags, discoveries per domain
worker/taste-ui.js  Browser script for the taste profile sheet
worker/i18n*.js     Translations (page, accounts, agent messages) and the browser T() helper
local-server.mjs    Node.js HTTP adapter that serves the worker on a normal server, with streaming
tests/              node:test unit tests with a mocked Qloo API
wrangler.toml       Optional Cloudflare Workers config
```

## License

[MIT](LICENSE)
