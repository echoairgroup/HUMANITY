# HUMANITY — Understand our world

A responsive, multi-section global data explorer built as a static website. It is designed to run on GitHub Pages, Vercel, Netlify or any ordinary static web host.

## What's included

- **Overview:** global snapshot cards, long-range population and life-expectancy charts, and country highlights.
- **Explore:** searchable and sortable country table, region filter, country detail panels and CSV export.
- **Compare:** side-by-side comparison of up to three countries across six indicators.
- **Stories:** editorial context to help visitors think critically about population, wellbeing, connectivity and emissions.
- **About:** indicator definitions, methodology notes and direct source links.
- Responsive layouts, keyboard accessibility, reduced-motion support, metadata, a web app manifest and a small offline shell cache.

## Data and freshness

HUMANITY retrieves public country metadata and indicator values from the World Bank Indicators API v2. It does not require an API key. Data is cached in the visitor's browser for up to 24 hours; older saved data can be used if the API is temporarily unavailable.

The indicators currently used are:

| Topic | World Bank indicator | Code |
|---|---|---|
| Population | Population, total | `SP.POP.TOTL` |
| Life expectancy | Life expectancy at birth, total | `SP.DYN.LE00.IN` |
| Internet access | Individuals using the Internet (% of population) | `IT.NET.USER.ZS` |
| GDP per capita | GDP per capita (current US$) | `NY.GDP.PCAP.CD` |
| CO₂ emissions | CO₂ emissions (metric tons per capita) | `EN.ATM.CO2E.PC` |
| Drinking water | People using at least basic drinking water services | `SH.H2O.BASW.ZS` |

Every displayed observation retains its reporting year. Different indicators and countries may have different latest years. The charts show available global observations from 2000 onward. Missing observations are shown as an em dash rather than estimated or invented.

Primary API documentation: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392

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
