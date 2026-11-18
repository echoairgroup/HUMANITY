# HUMANITY — Understand our world

A responsive, multi-section global data explorer built as a static website. It is designed to run on GitHub Pages, Vercel, Netlify or any ordinary static web host.

## What's included

- **Overview:** global snapshot cards, long-range population and life-expectancy charts, and country highlights.
- **Explore:** searchable and sortable country table, region filter, country detail panels and CSV export.
- **Compare:** side-by-side comparison of up to three countries across the full 26-indicator catalogue.
- **Stories:** editorial context to help visitors think critically about population, wellbeing, connectivity and emissions.
- **Games / HUMANITY Arcade:** Atlas Expedition (shared daily five-clue world-map challenge plus unlimited practice), Mystery Country (daily and practice clue ladder), Atlas Party (live public/private rooms with up to eight players, nickname-only guest entry, three lives, timed turns, rematches and a shared party leaderboard), **Nation Builder** (choose a country, inherit its published statistics, set taxes and two yearly policy priorities, manage a simplified game treasury and debt, and advance through simulated years with scenario events and browser-saved campaigns), plus Population Guess, Population Duel, Flag Finder, Capital Cities and Data Detective.
- **About:** 26 indicator definitions, methodology notes and direct source links.
- Responsive layouts, keyboard accessibility, reduced-motion support, softly animated page transitions, real Natural Earth continent outlines on both illustrated globes, metadata, a web app manifest and a small offline shell cache.

## Data and freshness

HUMANITY's backend synchronizes its public data sources every six hours and stores the latest successful datasets in Neon PostgreSQL. The website checks the backend every five minutes while it is open.

The 26-indicator catalogue covers population and growth, urban/rural distribution, health, education, employment, economic activity, connectivity, electricity access and environmental measures. Most series come from the World Bank Indicators API v2. Drinking-water coverage comes from the WHO/UNICEF Joint Monitoring Programme.

Every published observation retains its reporting year. Different indicators and countries can have different latest years, and missing observations are displayed as unavailable rather than invented.

### Population estimate

The country population counter updates its display every second. It is a projection, not a live census: it starts from the latest published midyear population total and applies the latest available annual population growth rate using an exponential growth model. The underlying source observations update when the providers publish new data and the backend next synchronizes.

### Games

The Arcade combines solo geography and live multiplayer. Atlas Expedition gives everyone the same five geography clues each UTC day; players select countries on a world map, with less obvious correct answers awarding more distance. Unlimited practice expeditions are separate from the daily leaderboard. Mystery Country reveals up to three clues for a daily or random country. Atlas Party provides public rooms and private six-character invite codes, up to eight nickname-only guests, three lives each, a timed pass-the-atlas turn, unique valid country answers per category, host-controlled starts, rematches and a 30-day party leaderboard. Daily expedition scores and completed party results are stored in Neon PostgreSQL. Party rooms themselves are in-memory live sessions and reset when the API process restarts. Player identities are guest nicknames, not verified accounts. The five original quick games remain available: Population Guess, Population Duel, Flag Finder, Capital Cities and Data Detective.

Primary sources:

- World Bank Indicators API v2: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
- WHO/UNICEF Joint Monitoring Programme: https://washdata.org/data/api

## Run locally

No build step or package installation is required. Open `index.html` in a browser for a quick visual check. For full data access and service-worker support, serve the folder over HTTP, for example:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

1. Put the contents of this folder in the root of a GitHub repository (or the configured Pages publishing folder).
2. In the repository, open **Settings → Pages**.
3. Select **Deploy from a branch**, choose the branch (usually `main`) and folder (`/ (root)`), then save.
4. Open the published URL over HTTPS. No environment variables or secrets are required.

## Notes

- The World Bank is the upstream data provider; HUMANITY is an independent project and is not affiliated with or endorsed by the World Bank.
- GDP per capita is an average, not a measure of personal income or inequality.
- Territorial CO₂ emissions per capita are not a complete measure of climate impact or consumption-based responsibility.
- National averages can hide large within-country differences. Use the data as a starting point for questions, not as a ranking of human worth.
- A network connection is required for first-time data retrieval. The cached app shell and the most recently saved API responses can make later visits more resilient.

## Project structure

```text
HUMANITY_FINAL_RELEASE/
├── index.html
├── styles.css
├── app.js
├── sw.js
├── manifest.webmanifest
├── favicon.svg
└── README.md
```
