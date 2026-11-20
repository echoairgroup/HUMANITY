# HUMANITY — Geography, every day

HUMANITY is a geography game platform with two core games:

- **Atlas Daily** — seven shared questions each UTC day, 25 seconds per question, one uninterrupted official attempt, optional hint, approved multilingual answer aliases, Discovery Levels and a global daily ranking.
- **Globe Rush** — live multiplayer geography rounds. Players pass the Atlas Orb by submitting a valid unused answer before the shared fuse expires. Includes Quick Play, Ranked, private rooms and quarterly seasons.

The website is a static GitHub Pages frontend. The API and live WebSocket rooms run on Render with Neon PostgreSQL.

All globe illustrations use actual country polygon geometry from Natural Earth rather than hand-drawn continent shapes. The country data is bundled with the site and projected onto spherical SVG globes using D3's geographic projection tools. The bundled map is Natural Earth's 1:110m country layer, intended for global-scale displays. Globe Rush has its own original stone-archipelago waiting hub with real Earth globes and individual explorer platforms; it is not a pixel-for-pixel copy of another game's interface.

## Project layout

```text
/
  index.html
  styles.css
  app.js
  favicon.svg
  manifest.webmanifest
  sw.js
  backend/
    game-server.js
    party-server.js
    geography-engine.js
    schema-geography.sql
    game-engine.test.js
    package.json
```

## Current game rules

### Atlas Daily

- A new edition is keyed to the UTC date and is shared worldwide.
- Seven questions are assembled deterministically for that date: six geography questions and one wider culture/world question.
- Each question has a server-enforced 25-second answer window.
- Players can try as many answers as they like while the timer is active. Only an answer already in the approved answer set is accepted.
- One official attempt is allowed per account or persistent guest ID per UTC day. The run is not resumable.
- One optional hint returns three approved example answers.
- The approved answer set is shown after each question.
- Scores are provisional during the UTC day. At rollover, the API uses the actual answer frequencies to finalise Discovery Points.
- Guests can play, but only completed account runs appear in official rankings.

### Globe Rush

- Quick Play and Ranked support 1v1, 3-player, 4–6-player and 8–10-player matchmaking groups.
- Private rooms support 2–10 players.
- A round uses one geography category; answers cannot be repeated during that category.
- Every player receives a personal 12-second clock when the Orb reaches them. The full 12 seconds reset for the next player after every accepted answer and for the next category.
- Invalid and duplicate answers do not reset the current player's clock; the player can keep trying while their own time is running.
- A category changes for the whole room after **2 incorrect answers** (not necessarily consecutive) or **10 accepted turns**, whichever happens first. Both counters reset when the category changes.
- The timer and category counters are controlled by the server and shown to everyone, with the active player clearly highlighted.
- An overload costs the current holder one Stability Point. A new category then begins with a fresh 12-second turn.
- The live player list tracks each explorer's turns taken, approved answers, Stability Points and score.
- The last active player wins.
- Ranked requires an account. A player's rating is soft-reset toward 1000 between quarterly seasons.

The starting number of Stability Points and rarity-to-extra-heart balance are configuration choices in `backend/party-server.js`; tune these against real playtests before treating them as a final competitive balance.

## Local development

Requires Node.js 20 or newer and a PostgreSQL database.

```bash
cd backend
npm install
DATABASE_URL="postgresql://..." npm start
```

The static frontend can be served from the repository root with any static file server. The default frontend API URL is the existing Render service:

`https://humanity-api-jyk5.onrender.com/api`

For local development, update the `API` and `SOCKET_URL` constants at the top of `app.js` to your local API host.

Run backend tests:

```bash
cd backend
npm test
node --check game-server.js
node --check party-server.js
node --check geography-engine.js
```

## Render deployment

Use the existing HUMANITY Render API service, whose public origin is:

`https://humanity-api-jyk5.onrender.com`

Recommended service settings:

- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Runtime:** Node 20 or newer
- **Health Check Path:** `/api/health`

Required environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Existing Neon PostgreSQL connection string |
| `ALLOWED_ORIGINS` | `https://echoairgroup.github.io` |
| `SITE_URL` | `https://echoairgroup.github.io/HUMANITY/` |
| `PUBLIC_API_URL` | `https://humanity-api-jyk5.onrender.com` |
| `ADMIN_EMAILS` | Comma-separated email addresses allowed into the admin dashboard |
| `ENGINE_CRON_SECRET` | Long random secret used by the scheduled publisher |

Optional OAuth variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` — `https://humanity-api-jyk5.onrender.com/api/auth/google/callback`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` — `https://humanity-api-jyk5.onrender.com/api/auth/discord/callback`

Google and Discord OAuth are unavailable until their client credentials and callback URLs are configured in their respective developer consoles and added to Render.

On startup, the API runs the additive statements in `schema-geography.sql`. It creates HUMANITY game tables and adds the season-rating column if needed; it does not drop or rewrite the existing legacy cache tables.

## GitHub Pages

Publish the repository root using GitHub Pages. The default site URL expected by the OAuth redirect is:

`https://echoairgroup.github.io/HUMANITY/`

The frontend is intentionally independent of Render deployment, so the current live website remains unchanged until the rebuild is merged into the Pages publishing branch.

## Daily challenge scheduling

No external cron secret or GitHub Actions schedule is required. The API creates the current UTC edition on startup and checks the active edition on requests. The daily challenge is deterministic for its UTC date, so every player receives the same seven questions even when the free Render service has been idle and wakes on the next request.

## Geography and answer engine

The first release ships with a curated, reviewed seed bank that covers countries, capitals, cities, rivers, mountains, islands, lakes, seas, deserts, landmarks, languages and selected global food/culture topics. Each question includes approved names and aliases. Matching is Unicode-aware, so non-Latin scripts can be matched when those aliases are present.

Unknown answers are never accepted during a live attempt. They are added to the review queue. Exact Wikidata entity-label/type matches for supported geography topics can be auto-approved for future editions; uncertain and cultural answers remain in the Admin Dashboard queue.

The daily engine automatically assembles a new shared combination from this approved question bank. It is not an unrestricted generative AI system and cannot guarantee every possible place name, local term or snack on Earth is already present. Expand the curated data and review queue over time; never auto-accept an unverified answer inside an active ranked game.

## Important release notes

- Configure Render environment variables before switching the Render service to this branch.
- Configure GitHub Actions secrets before relying on the scheduled publisher.
- Configure Google/Discord OAuth before advertising those sign-in options as active.
- Add the owner email to `ADMIN_EMAILS` to enable the admin dashboard.
- The first stability-point and rarity-hearts balance should be playtested before a public ranked launch.
