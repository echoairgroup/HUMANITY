# HUMANITY — Understand our world

A responsive, multi-section global data explorer built as a static website. It is designed to run on GitHub Pages, Vercel, Netlify or any ordinary static web host.

## What's included

- **Overview:** global snapshot cards, long-range population and life-expectancy charts, and country highlights.
- **Explore:** searchable and sortable country table, region filter, country detail panels and CSV export.
- **Compare:** side-by-side comparison of up to three countries across the full 26-indicator catalogue.
- **Stories:** editorial context to help visitors think critically about population, wellbeing, connectivity and emissions.
- **Games:** five playable modes — Population Guess, Population Duel, Flag Finder, Capital Cities and Data Detective. Ten rounds per challenge, scoring, streaks and device-local personal bests.
- **About:** 26 indicator definitions, methodology notes and direct source links.
- Responsive layouts, keyboard accessibility, reduced-motion support, metadata, a web app manifest and a small offline shell cache.

## Data and freshness

HUMANITY's backend synchronizes its public data sources every six hours and stores the latest successful datasets in Neon PostgreSQL. The website checks the backend every five minutes while it is open.

The 26-indicator catalogue covers population and growth, urban/rural distribution, health, education, employment, economic activity, connectivity, electricity access and environmental measures. Most series come from the World Bank Indicators API v2. Drinking-water coverage comes from the WHO/UNICEF Joint Monitoring Programme.

Every published observation retains its reporting year. Different indicators and countries can have different latest years, and missing observations are displayed as unavailable rather than invented.

### Population estimate

The country population counter updates its display every second. It is a projection, not a live census: it starts from the latest published midyear population total and applies the latest available annual population growth rate using an exponential growth model. The underlying source observations update when the providers publish new data and the backend next synchronizes.

### Games

The Games page contains five ten-round challenges: Population Guess, Population Duel, Flag Finder, Capital Cities and Data Detective. Scores, streaks and personal bests are saved in the current browser only; there is no global leaderboard or account system.

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
