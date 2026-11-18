'use strict';

(() => {
  const API_ROOT = 'https://humanity-api-jyk5.onrender.com/api';
  const CACHE_PREFIX = 'humanity-worldbank-v1:';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const PAGE_SIZE = 18;

  const INDICATORS = [
    { key: 'population', code: 'SP.POP.TOTL', name: 'Population, total', short: 'Population', unit: 'people', category: 'People', description: 'The total resident population, measured as a midyear estimate. The live counter projects this baseline forward using the latest annual population growth rate.', source: 'https://data.worldbank.org/indicator/SP.POP.TOTL', format: 'population' },
    { key: 'population_growth', code: 'SP.POP.GROW', name: 'Population growth (annual %)', short: 'Population growth', unit: '% per year', category: 'People', description: 'The exponential annual growth rate of the midyear population, reflecting births, deaths and net migration.', source: 'https://data.worldbank.org/indicator/SP.POP.GROW', format: 'percent' },
    { key: 'urban_share', code: 'SP.URB.TOTL.IN.ZS', name: 'Urban population (% of total population)', short: 'Urban population', unit: '% of population', category: 'People', description: 'The share of people living in areas classified as urban by national statistical offices.', source: 'https://data.worldbank.org/indicator/SP.URB.TOTL.IN.ZS', format: 'percent' },
    { key: 'rural_share', code: 'SP.RUR.TOTL.ZS', name: 'Rural population (% of total population)', short: 'Rural population', unit: '% of population', category: 'People', description: 'The share of people living in areas classified as rural by national statistical offices.', source: 'https://data.worldbank.org/indicator/SP.RUR.TOTL.ZS', format: 'percent' },
    { key: 'life', code: 'SP.DYN.LE00.IN', name: 'Life expectancy at birth, total (years)', short: 'Life expectancy', unit: 'years', category: 'Health', description: 'The number of years a newborn would live if patterns of mortality at the time of birth stayed the same throughout their life.', source: 'https://data.worldbank.org/indicator/SP.DYN.LE00.IN', format: 'years' },
    { key: 'fertility', code: 'SP.DYN.TFRT.IN', name: 'Fertility rate, total (births per woman)', short: 'Fertility rate', unit: 'births per woman', category: 'People', description: 'The number of children that would be born to a woman if she lived to the end of her childbearing years and bore children at current age-specific fertility rates.', source: 'https://data.worldbank.org/indicator/SP.DYN.TFRT.IN', format: 'fertility' },
    { key: 'birth_rate', code: 'SP.DYN.CBRT.IN', name: 'Birth rate, crude (per 1,000 people)', short: 'Birth rate', unit: 'births per 1,000 people', category: 'People', description: 'The annual number of live births per 1,000 people, based on midyear population.', source: 'https://data.worldbank.org/indicator/SP.DYN.CBRT.IN', format: 'per1000' },
    { key: 'death_rate', code: 'SP.DYN.CDRT.IN', name: 'Death rate, crude (per 1,000 people)', short: 'Death rate', unit: 'deaths per 1,000 people', category: 'Health', description: 'The annual number of deaths per 1,000 people, based on midyear population.', source: 'https://data.worldbank.org/indicator/SP.DYN.CDRT.IN', format: 'per1000' },
    { key: 'infant_mortality', code: 'SP.DYN.IMRT.IN', name: 'Mortality rate, infant (per 1,000 live births)', short: 'Infant mortality', unit: 'per 1,000 live births', category: 'Health', description: 'The probability of a child dying between birth and the first birthday, expressed per 1,000 live births.', source: 'https://data.worldbank.org/indicator/SP.DYN.IMRT.IN', format: 'per1000' },
    { key: 'under5_mortality', code: 'SH.DYN.MORT', name: 'Mortality rate, under-5 (per 1,000 live births)', short: 'Under-5 mortality', unit: 'per 1,000 live births', category: 'Health', description: 'The probability of a child dying before reaching age five, expressed per 1,000 live births.', source: 'https://data.worldbank.org/indicator/SH.DYN.MORT', format: 'per1000' },
    { key: 'health_spend', code: 'SH.XPD.CHEX.PC.CD', name: 'Current health expenditure per capita (current US$)', short: 'Health spending per person', unit: 'current US dollars', category: 'Health', description: 'Current health expenditure divided by the population. This is an average and does not show how spending is distributed.', source: 'https://data.worldbank.org/indicator/SH.XPD.CHEX.PC.CD', format: 'currency' },
    { key: 'literacy', code: 'SE.ADT.LITR.ZS', name: 'Literacy rate, adult total (% of people ages 15 and above)', short: 'Adult literacy', unit: '% of people aged 15+', category: 'Education', description: 'The share of people aged 15 and above who can read and write with understanding a short, simple statement about their everyday life.', source: 'https://data.worldbank.org/indicator/SE.ADT.LITR.ZS', format: 'percent' },
    { key: 'secondary_enrollment', code: 'SE.SEC.ENRR', name: 'School enrollment, secondary (% gross)', short: 'Secondary enrollment', unit: '% gross enrollment', category: 'Education', description: 'The ratio of total secondary enrollment, regardless of age, to the population of the age group that officially corresponds to secondary education.', source: 'https://data.worldbank.org/indicator/SE.SEC.ENRR', format: 'percent' },
    { key: 'unemployment', code: 'SL.UEM.TOTL.ZS', name: 'Unemployment, total (% of total labor force)', short: 'Unemployment', unit: '% of labor force', category: 'Economy', description: 'The share of the labor force without work but available for and seeking employment, using modeled ILO estimates.', source: 'https://data.worldbank.org/indicator/SL.UEM.TOTL.ZS', format: 'percent' },
    { key: 'internet', code: 'IT.NET.USER.ZS', name: 'Individuals using the Internet (% of population)', short: 'Internet use', unit: '% of population', category: 'Connectivity', description: 'The percentage of people who used the Internet from any location in the last three months, as defined by the source.', source: 'https://data.worldbank.org/indicator/IT.NET.USER.ZS', format: 'percent' },
    { key: 'mobile_subscriptions', code: 'IT.CEL.SETS.P2', name: 'Mobile cellular subscriptions (per 100 people)', short: 'Mobile subscriptions', unit: 'subscriptions per 100 people', category: 'Connectivity', description: 'Mobile cellular telephone subscriptions per 100 people. A person may have more than one subscription.', source: 'https://data.worldbank.org/indicator/IT.CEL.SETS.P2', format: 'per100' },
    { key: 'gdp', code: 'NY.GDP.PCAP.CD', name: 'GDP per capita (current US$)', short: 'GDP per person', unit: 'current US dollars', category: 'Economy', description: 'Gross domestic product divided by midyear population. It is an economic average, not a measure of individual income or how wealth is distributed.', source: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.CD', format: 'currency' },
    { key: 'gdp_growth', code: 'NY.GDP.MKTP.KD.ZG', name: 'GDP growth (annual %)', short: 'GDP growth', unit: '% per year', category: 'Economy', description: 'Annual percentage growth rate of GDP at market prices based on constant local currency.', source: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG', format: 'percent' },
    { key: 'inflation', code: 'FP.CPI.TOTL.ZG', name: 'Inflation, consumer prices (annual %)', short: 'Inflation', unit: '% per year', category: 'Economy', description: 'The annual percentage change in the cost to the average consumer of acquiring a basket of goods and services.', source: 'https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG', format: 'percent' },
    { key: 'exports_gdp', code: 'NE.EXP.GNFS.ZS', name: 'Exports of goods and services (% of GDP)', short: 'Exports of GDP', unit: '% of GDP', category: 'Economy', description: 'The value of goods and services sold abroad, expressed as a share of gross domestic product.', source: 'https://data.worldbank.org/indicator/NE.EXP.GNFS.ZS', format: 'percent' },
    { key: 'co2', code: 'EN.GHG.CO2.PC.CE.AR5', name: 'Carbon dioxide (CO₂) emissions excluding LULUCF per capita', short: 'CO₂ per person', unit: 't CO₂e per person', category: 'Environment', description: 'Annual CO₂ emissions from agriculture, energy, waste and industrial sectors, expressed as CO₂-equivalent per person and excluding land-use change and forestry.', source: 'https://data.worldbank.org/indicator/EN.GHG.CO2.PC.CE.AR5', format: 'decimal' },
    { key: 'water', code: 'SH.H2O.BASW.ZS', name: 'People using at least basic drinking water services (% of population)', short: 'Basic drinking water', unit: '% of population', category: 'Health', description: 'The share of people using at least basic drinking-water services. This combines basic service with safely managed service; the latter is included because it also meets the basic-service threshold.', source: 'https://washdata.org/data/api', format: 'percent' },
    { key: 'electricity_access', code: 'EG.ELC.ACCS.ZS', name: 'Access to electricity (% of population)', short: 'Electricity access', unit: '% of population', category: 'Infrastructure', description: 'The share of the population with access to electricity. Access does not by itself measure reliability or affordability.', source: 'https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS', format: 'percent' },
    { key: 'renewables_share', code: 'EG.FEC.RNEW.ZS', name: 'Renewable energy consumption (% of total final energy consumption)', short: 'Renewable energy', unit: '% of final energy', category: 'Environment', description: 'The share of total final energy consumption that comes from renewable sources.', source: 'https://data.worldbank.org/indicator/EG.FEC.RNEW.ZS', format: 'percent' },
    { key: 'pm25', code: 'EN.ATM.PM25.MC.M3', name: 'PM2.5 air pollution, mean annual exposure (micrograms per cubic meter)', short: 'PM2.5 exposure', unit: 'µg/m³', category: 'Environment', description: 'Population-weighted average exposure to fine particulate matter. It is an environmental indicator, not a direct reading from every location.', source: 'https://data.worldbank.org/indicator/EN.ATM.PM25.MC.M3', format: 'pm25' },
    { key: 'forest_area', code: 'AG.LND.FRST.ZS', name: 'Forest area (% of land area)', short: 'Forest area', unit: '% of land area', category: 'Environment', description: 'The share of a country or area covered by forest according to the source definition.', source: 'https://data.worldbank.org/indicator/AG.LND.FRST.ZS', format: 'percent' }
  ];

  const state = {
    countries: [],
    values: Object.fromEntries(INDICATORS.map(item => [item.key, {}])),
    world: {},
    history: {},
    dataReady: false,
    dataSource: 'none',
    meta: {},
    isLoadingData: false,
    lastFetchAt: 0,
    visibleCount: PAGE_SIZE,
    selectedCountry: null,
    toastTimer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const fmt = new Intl.NumberFormat('en-US');
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

  function cacheRead(key) {
    try {
      const item = localStorage.getItem(CACHE_PREFIX + key);
      if (!item) return null;
      const parsed = JSON.parse(item);
      return parsed && parsed.savedAt && parsed.payload ? parsed : null;
    } catch (_) { return null; }
  }

  function cacheWrite(key, payload) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), payload })); }
    catch (_) { /* Storage may be unavailable or full; the live session still works. */ }
  }

  async function requestJSON(path, cacheKey, maxAge = CACHE_TTL) {
    const cached = cacheRead(cacheKey);
    if (cached && Date.now() - cached.savedAt < maxAge) return { payload: cached.payload, cached: true, stale: false };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);
      let response;
      try {
        response = await fetch(`${API_ROOT}${path}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`World Bank returned ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error('Unexpected data format');
      cacheWrite(cacheKey, payload);
      return { payload, cached: false, stale: false };
    } catch (error) {
      if (cached) return { payload: cached.payload, cached: true, stale: true, error };
      throw error;
    }
  }

  function flagEmoji(iso2) {
    if (!iso2 || iso2.length !== 2 || iso2 === '1A') return '🌐';
    const letters = iso2.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...letters);
  }

  function safeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function parseRows(payload) {
    return Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
  }

  function recordSeries(rows) {
    const result = {};
    for (const row of rows) {
      const code = row.countryiso3code || row.country?.id;
      const value = safeNumber(row.value);
      if (!code || value === null) continue;
      const year = Number(row.date);
      if (!result[code] || year > result[code].year) {
        result[code] = { value, year: Number.isFinite(year) ? year : null, footnote: row.obs_status || '' };
      }
    }
    return result;
  }

  async function loadCountries() {
    const result = await requestJSON('/country?format=json&per_page=400', 'countries');
    const rows = parseRows(result.payload);
    return rows
      .filter(country => country.id && country.iso2Code && country.region && country.region.id !== 'NA' && country.region.value !== 'Aggregates')
      .map(country => ({
        code: country.id,
        iso2: country.iso2Code,
        name: country.name,
        region: country.region.value,
        income: country.incomeLevel?.value || 'Not classified',
        capital: country.capitalCity || '',
        longitude: safeNumber(country.longitude),
        latitude: safeNumber(country.latitude)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function loadLatestIndicator(indicator) {
    const result = await requestJSON(`/country/all/indicator/${indicator.code}?format=json&mrnev=1&per_page=500`, `latest-${indicator.key}`);
    const rows = parseRows(result.payload);
    const series = recordSeries(rows);
    state.values[indicator.key] = series;
    if (series.WLD) {
      state.world[indicator.key] = series.WLD;
    } else {
      // Some country-wide API responses omit aggregate rows. Fetch the World
      // aggregate explicitly so the headline cards never rely on country averages.
      const worldResult = await requestJSON(`/country/WLD/indicator/${indicator.code}?format=json&mrnev=1&per_page=20`, `world-latest-${indicator.key}`);
      const worldRow = recordSeries(parseRows(worldResult.payload)).WLD;
      if (worldRow) state.world[indicator.key] = worldRow;
      return { key: indicator.key, cached: result.cached || worldResult.cached, stale: result.stale || worldResult.stale };
    }
    return { key: indicator.key, cached: result.cached, stale: result.stale };
  }

  async function loadWorldHistory(indicator) {
    const result = await requestJSON(`/country/WLD/indicator/${indicator.code}?format=json&date=2000:2026&per_page=100`, `history-${indicator.key}`);
    const rows = parseRows(result.payload)
      .map(row => ({ year: Number(row.date), value: safeNumber(row.value) }))
      .filter(point => Number.isFinite(point.year) && point.value !== null)
      .sort((a, b) => a.year - b.year);
    state.history[indicator.key] = rows;
    if (rows.length) {
      const latest = rows[rows.length - 1];
      if (!state.world[indicator.key] || latest.year > state.world[indicator.key].year) state.world[indicator.key] = latest;
    }
    return { key: indicator.key, cached: result.cached, stale: result.stale };
  }

  async function loadData() {
    if (state.isLoadingData) return;
    state.isLoadingData = true;
    if (!state.dataReady) setDataStatus('loading', 'Connecting to HUMANITY');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      let response;
      try {
        response = await fetch(API_ROOT + '/bootstrap', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || ('HUMANITY API returned HTTP ' + response.status));
      }

      const payload = await response.json();
      if (!payload.ok || !payload.data || !Array.isArray(payload.data.countries)) {
        throw new Error('The HUMANITY API returned an incomplete data package.');
      }

      state.countries = payload.data.countries;
      state.values = payload.data.values || {};
      state.world = payload.data.world || {};
      state.history = payload.data.history || {};
      state.meta = payload.meta || {};
      state.dataReady = true;
      state.dataSource = payload.meta && payload.meta.cacheStatus === 'stale' ? 'cached' : 'live';

      try {
        localStorage.setItem('humanity-bootstrap-cache', JSON.stringify({
          savedAt: Date.now(),
          payload
        }));
      } catch (_) { /* Browser storage can be disabled or full. */ }

      const datasets = payload.meta && payload.meta.cachedDatasets
        ? payload.meta.cachedDatasets
        : 0;
      const expected = payload.meta && payload.meta.expectedDatasets
        ? payload.meta.expectedDatasets
        : (1 + INDICATORS.length + 2);

      if (payload.meta && payload.meta.cacheStatus === 'stale') {
        setDataStatus('ok', 'Cached snapshot · ' + (payload.meta.availableIndicators || 0) + '/' + INDICATORS.length + ' indicators');
      } else if (datasets < expected) {
        setDataStatus('ok', 'Live feed · ' + (payload.meta.availableIndicators || 0) + '/' + INDICATORS.length + ' indicators');
      } else {
        setDataStatus('ok', 'Live feed · ' + (payload.meta.availableIndicators || INDICATORS.length) + ' indicators');
      }

      renderAll();
      if (datasets < expected) {
        showToast('Some indicators are still being refreshed. Available observations are shown with their reporting years.');
      }
    } catch (error) {
      console.error('HUMANITY data load failed:', error);

      let restored = false;
      try {
        const cached = JSON.parse(localStorage.getItem('humanity-bootstrap-cache') || 'null');
        if (cached && cached.payload && cached.payload.data &&
            Array.isArray(cached.payload.data.countries) &&
            cached.payload.data.countries.length) {
          state.countries = cached.payload.data.countries;
          state.values = cached.payload.data.values || {};
          state.world = cached.payload.data.world || {};
          state.history = cached.payload.data.history || {};
          state.meta = cached.payload.meta || {};
          state.dataReady = true;
          state.dataSource = 'cached';
          restored = true;
        }
      } catch (_) { /* Ignore corrupt or unavailable browser cache. */ }

      if (restored) {
        setDataStatus('ok', 'Offline · saved data');
        showToast('The live data service could not be reached. Showing the last saved dataset.');
        renderAll();
      } else {
        setDataStatus('error', 'Data service unavailable');
        showToast('HUMANITY could not connect to its data service. Please reload in a moment.');
        renderAll();
      }
    } finally {
      state.isLoadingData = false;
      state.lastFetchAt = Date.now();
      updateLivePopulationDisplays();
    }
  }

  function setDataStatus(kind, label) {
    const node = $('#data-status');
    node.className = `data-status ${kind === 'ok' ? 'ok' : kind === 'error' ? 'error' : ''}`;
    const text = node.querySelector('span:last-child');
    if (text) text.textContent = label;
  }

  function valueFor(countryCode, key) {
    return state.values[key]?.[countryCode] || null;
  }

  function worldValue(key) {
    return state.world[key] || valueFor('WLD', key);
  }

  function formatValue(value, key, compactMode = false) {
    if (!value || value.value === null || value.value === undefined) return '—';
    const number = value.value;
    const indicator = INDICATORS.find(item => item.key === key);
    switch (indicator?.format) {
      case 'population': return compactMode ? compact.format(number) : fmt.format(Math.round(number));
      case 'years': return number.toFixed(1) + ' yrs';
      case 'percent': return number.toFixed(1) + '%';
      case 'currency': return money.format(number);
      case 'decimal': return number.toFixed(2) + ' t';
      case 'fertility': return number.toFixed(2) + ' births/woman';
      case 'per1000': return number.toFixed(1) + ' / 1,000';
      case 'per100': return number.toFixed(1) + ' / 100 people';
      case 'pm25': return number.toFixed(1) + ' µg/m³';
      default: return fmt.format(number);
    }
  }

  function formatCell(value, key) {
    if (!value) return '<span class="muted-value">—</span>';
    return formatValue(value, key) + '<span class="year-mini">' + (value.year ?? '') + '</span>';
  }

  function estimatedPopulation(code, now = Date.now()) {
    const baseline = valueFor(code, 'population');
    if (!baseline || !Number.isFinite(baseline.value) || !Number.isFinite(baseline.year)) return null;

    const growth = valueFor(code, 'population_growth');
    const compatibleGrowth = growth &&
      Number.isFinite(growth.value) &&
      Number.isFinite(growth.year) &&
      Math.abs(growth.year - baseline.year) <= 2;

    if (!compatibleGrowth) {
      return { value: baseline.value, year: baseline.year, growthRate: null, isProjected: false };
    }

    // World Bank population totals are midyear (1 July) estimates.
    // SP.POP.GROW is an exponential annual growth rate, so use P(t)=P0*e^(r*t).
    const referenceTime = Date.UTC(baseline.year, 6, 1);
    const elapsedYears = (now - referenceTime) / 31557600000;
    const annualRate = growth.value / 100;
    const projected = baseline.value * Math.exp(annualRate * elapsedYears);

    if (!Number.isFinite(projected) || projected <= 0) {
      return { value: baseline.value, year: baseline.year, growthRate: null, isProjected: false };
    }

    return {
      value: projected,
      year: baseline.year,
      growthRate: growth.value,
      growthYear: growth.year,
      isProjected: elapsedYears > 0
    };
  }

  function updateLivePopulationDisplays() {
    const now = Date.now();
    $$('[data-live-population]').forEach(node => {
      const estimate = estimatedPopulation(node.dataset.livePopulation, now);
      node.textContent = estimate ? fmt.format(Math.round(estimate.value)) : '—';
      if (estimate?.isProjected) {
        node.setAttribute('aria-label', fmt.format(Math.round(estimate.value)) + ' estimated inhabitants');
      }
    });

    const world = estimatedPopulation('WLD', now);
    const globe = $('#globe-population');
    if (globe) globe.textContent = world ? compact.format(world.value) : 'DATA UNAVAILABLE';

    const story = $('#story-population');
    if (story) story.textContent = world ? compact.format(world.value) : '—';

    if (state.selectedCountry) {
      const selected = estimatedPopulation(state.selectedCountry, now);
      const detail = $('#country-live-population');
      if (detail) detail.textContent = selected ? fmt.format(Math.round(selected.value)) : '—';
    }
  }

  function renderWorldMetrics() {
    const specs = [
      { key: 'population', label: 'LIVE WORLD POPULATION', sub: 'Estimated inhabitants · updates every second', icon: '◎', primary: true, live: true },
      { key: 'population_growth', label: 'POPULATION GROWTH', sub: 'Annual change', icon: '↗' },
      { key: 'life', label: 'LIFE EXPECTANCY', sub: 'Years at birth', icon: '⌁' },
      { key: 'internet', label: 'INTERNET ACCESS', sub: 'Of world population', icon: '⌘' },
      { key: 'gdp', label: 'GDP PER PERSON', sub: 'Current US dollars', icon: '↗' },
      { key: 'co2', label: 'CO₂ PER PERSON', sub: 'Tonnes CO₂e per person', icon: '◌' },
      { key: 'water', label: 'BASIC DRINKING WATER', sub: 'At least basic service', icon: '≈' },
      { key: 'electricity_access', label: 'ELECTRICITY ACCESS', sub: 'Of world population', icon: 'ϟ' }
    ];
    const container = $('#world-metrics');
    container.innerHTML = specs.map(spec => {
      const estimate = spec.live ? estimatedPopulation('WLD') : null;
      const value = spec.live ? estimate : worldValue(spec.key);
      const display = spec.live
        ? (estimate ? fmt.format(Math.round(estimate.value)) : '—')
        : formatValue(value, spec.key, true);
      const yearLabel = value ? (spec.live ? 'BASE ' + value.year : value.year) : '—';
      return '<article class="metric-card ' + (spec.primary ? 'metric-card-main' : '') + '">' +
        '<div class="metric-top"><span>' + spec.label + '</span><span class="metric-icon">' + spec.icon + '</span></div>' +
        '<div class="metric-value" ' + (spec.live ? 'data-live-population="WLD"' : '') + '>' + display + '</div>' +
        '<div class="metric-bottom"><span>' + spec.sub + '</span><span class="metric-year">' + yearLabel + '</span></div>' +
      '</article>';
    }).join('');

    const population = worldValue('population');
    const growth = worldValue('population_growth');
    $('#story-population-year').textContent = population
      ? 'Midyear baseline · ' + population.year + (growth ? ' · annual growth ' + growth.value.toFixed(2) + '%' : '')
      : 'Latest available observation';

    const years = INDICATORS.map(indicator => worldValue(indicator.key)?.year).filter(Boolean);
    const synced = state.meta?.updatedAt ? new Date(state.meta.updatedAt) : null;
    const syncLabel = synced && !Number.isNaN(synced.getTime())
      ? synced.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
      : 'waiting for first sync';
    $('#updated-note').textContent = INDICATORS.length + ' indicators · cache checked ' + syncLabel +
      (years.length ? ' · years ' + Math.min(...years) + '–' + Math.max(...years) : '');

    const story = $('#story-population');
    if (story) story.setAttribute('data-live-population', 'WLD');
    updateLivePopulationDisplays();
  }

  function chartMarkup(points, key, id) {
    if (!points || points.length < 2) return '<div class="chart-loading">Timeline data is not available yet.</div>';
    const width = 640, height = 210, left = 48, right = 12, top = 12, bottom = 30;
    const values = points.map(item => item.value);
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;
    const x = i => left + (i / (points.length - 1)) * (width - left - right);
    const y = value => top + (1 - (value - min) / range) * (height - top - bottom);
    const d = points.map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
    const area = `${d} L ${x(points.length - 1)} ${height - bottom} L ${x(0)} ${height - bottom} Z`;
    const yearIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    const grid = [0, 1, 2, 3].map(i => {
      const yy = top + i * (height - top - bottom) / 3;
      const val = max - i * range / 3;
      const label = key === 'population' ? compact.format(val) : val.toFixed(0);
      return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="#e8ece4" stroke-width="1"/><text x="0" y="${yy + 3}" fill="#9aa49b" font-size="9" font-family="DM Mono, monospace">${label}</text>`;
    }).join('');
    const xLabels = yearIndexes.map(i => `<text x="${x(i)}" y="${height - 5}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" fill="#9aa49b" font-size="9" font-family="DM Mono, monospace">${points[i].year}</text>`).join('');
    const dots = points.map((point, i) => `<circle cx="${x(i)}" cy="${y(point.value)}" r="3.5" fill="#d97859" stroke="#fffefa" stroke-width="2"><title>${point.year}: ${key === 'population' ? fmt.format(Math.round(point.value)) : point.value.toFixed(2)}</title></circle>`).join('');
    const latest = points[points.length - 1];
    const gradientId = `fill-${id}`;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${key === 'population' ? 'World population' : 'World life expectancy'} trend from ${points[0].year} to ${latest.year}"><defs><linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#9eb99c" stop-opacity=".32"/><stop offset="1" stop-color="#9eb99c" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#${gradientId})"/><path d="${d}" fill="none" stroke="#496d58" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${dots}${xLabels}</svg>`;
  }

  function renderCharts() {
    const population = state.history.population || [];
    const life = state.history.life || [];
    $('#chart-population').innerHTML = chartMarkup(population, 'population', 'population');
    $('#chart-life').innerHTML = chartMarkup(life, 'life', 'life');
    if (population.length) $('#chart-population-range').textContent = `${population[0].year}–${population[population.length - 1].year}`;
    if (life.length) $('#chart-life-range').textContent = `${life[0].year}–${life[life.length - 1].year}`;
  }

  function renderCountrySortOptions() {
    const select = $('#country-sort');
    if (!select) return;
    const current = select.value || 'population';
    const options = [
      '<option value="population">Live population estimate</option>',
      ...INDICATORS.filter(indicator => indicator.key !== 'population')
        .map(indicator => '<option value="' + indicator.key + '">' + escapeHTML(indicator.short) + '</option>'),
      '<option value="name">Country name</option>'
    ];
    select.innerHTML = options.join('');
    select.value = INDICATORS.some(indicator => indicator.key === current) || current === 'name'
      ? current
      : 'population';
  }

  function getCountriesSorted(key = 'population') {
    const metricKey = key === 'name' ? null : key;
    const countries = [...state.countries];
    if (metricKey) {
      countries.sort((a, b) => {
        const aValue = metricKey === 'population'
          ? estimatedPopulation(a.code)?.value
          : valueFor(a.code, metricKey)?.value;
        const bValue = metricKey === 'population'
          ? estimatedPopulation(b.code)?.value
          : valueFor(b.code, metricKey)?.value;
        return (bValue ?? -Infinity) - (aValue ?? -Infinity);
      });
    } else {
      countries.sort((a, b) => a.name.localeCompare(b.name));
    }
    return countries;
  }


  function renderPreview() {
    const best = getCountriesSorted('population').filter(country => valueFor(country.code, 'population')).slice(0, 4);
    const container = $('#country-preview');
    if (!best.length) {
      container.innerHTML = '<div class="preview-placeholder">Country snapshots will appear when the data is ready.</div>';
      return;
    }
    container.innerHTML = best.map(country => {
      const estimate = estimatedPopulation(country.code);
      return '<a class="country-preview-card" href="#explore" data-preview-country="' + country.code + '">' +
        '<div class="preview-top"><span class="flag">' + flagEmoji(country.iso2) + '</span><span class="preview-region">' + escapeHTML(country.region) + '</span></div>' +
        '<div class="preview-name">' + escapeHTML(country.name) + '</div>' +
        '<div class="preview-pop"><span data-live-population="' + country.code + '">' + (estimate ? fmt.format(Math.round(estimate.value)) : '—') + '</span> estimated people</div>' +
      '</a>';
    }).join('');
    updateLivePopulationDisplays();
  }


  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function getFilteredCountries() {
    const query = ($('#country-search')?.value || '').trim().toLowerCase();
    const region = $('#region-filter')?.value || 'all';
    const sort = $('#country-sort')?.value || 'population';
    let countries = getCountriesSorted(sort);
    if (region !== 'all') countries = countries.filter(country => country.region === region);
    if (query) countries = countries.filter(country => country.name.toLowerCase().includes(query) || country.code.toLowerCase().includes(query) || country.region.toLowerCase().includes(query));
    return countries;
  }

  function renderCountryTable() {
    const tbody = $('#country-table-body');
    if (!state.countries.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-message">Country data is not available. Check your connection and reload the page.</td></tr>';
      $('#country-count').textContent = 'No country data';
      $('#table-range').textContent = 'Data unavailable';
      $('#load-more').hidden = true;
      return;
    }
    const filtered = getFilteredCountries();
    const visible = filtered.slice(0, state.visibleCount);
    $('#country-count').textContent = fmt.format(filtered.length) + ' economies · ' + INDICATORS.length + ' indicators';
    $('#table-range').textContent = 'Showing ' + visible.length + ' of ' + filtered.length;
    $('#load-more').hidden = visible.length >= filtered.length;
    if (!visible.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-message">No countries match that search. Try another name or region.</td></tr>';
      return;
    }
    tbody.innerHTML = visible.map(country => {
      const population = estimatedPopulation(country.code);
      const growth = valueFor(country.code, 'population_growth');
      return '<tr>' +
        '<td><button class="country-name-button" data-country="' + country.code + '"><span class="table-flag">' + flagEmoji(country.iso2) + '</span>' + escapeHTML(country.name) + '</button></td>' +
        '<td>' + escapeHTML(country.region) + '</td>' +
        '<td class="numeric live-population-cell" data-live-population="' + country.code + '" title="Estimated population based on the latest midyear baseline and annual growth rate">' + (population ? fmt.format(Math.round(population.value)) : '—') + '</td>' +
        '<td class="numeric">' + (growth ? growth.value.toFixed(2) + '%<span class="year-mini">' + growth.year + '</span>' : '<span class="muted-value">—</span>') + '</td>' +
        '<td class="numeric">' + formatCell(valueFor(country.code, 'life'), 'life') + '</td>' +
        '<td class="numeric">' + formatCell(valueFor(country.code, 'internet'), 'internet') + '</td>' +
        '<td class="numeric">' + formatCell(valueFor(country.code, 'gdp'), 'gdp') + '</td>' +
        '<td><button class="table-action" data-compare-country="' + country.code + '" aria-label="Add ' + escapeHTML(country.name) + ' to comparison">Compare +</button></td>' +
      '</tr>';
    }).join('');
    updateLivePopulationDisplays();
  }


  function renderCompareSelectors() {
    if (!state.countries.length) return;
    const sorted = [...state.countries].sort((a, b) => a.name.localeCompare(b.name));
    const defaults = ['USA', 'IND', 'BRA'];
    ['compare-a', 'compare-b', 'compare-c'].forEach((id, index) => {
      const select = $('#' + id);
      const current = select.value || defaults[index];
      select.innerHTML = sorted.map(country => `<option value="${country.code}">${escapeHTML(country.name)}</option>`).join('');
      select.value = sorted.some(country => country.code === current) ? current : (sorted.some(country => country.code === defaults[index]) ? defaults[index] : sorted[index]?.code);
    });
    renderCompareResults();
  }

  function renderCompareResults() {
    const codes = ['compare-a', 'compare-b', 'compare-c'].map(id => $('#' + id)?.value).filter(Boolean);
    const countries = codes.map(code => state.countries.find(country => country.code === code)).filter(Boolean);
    if (!countries.length) return;

    const head = '<thead><tr><th>INDICATOR</th>' +
      countries.map(country => '<th class="compare-country-head">' + flagEmoji(country.iso2) + ' ' + escapeHTML(country.name) + '<small>' + escapeHTML(country.region) + '</small></th>').join('') +
      '</tr></thead>';

    const body = INDICATORS.map(indicator => {
      return '<tr><td>' + escapeHTML(indicator.short) + '</td>' + countries.map(country => {
        const value = valueFor(country.code, indicator.key);
        if (indicator.key === 'population') {
          const estimate = estimatedPopulation(country.code);
          return '<td><span class="compare-value">' + (estimate ? fmt.format(Math.round(estimate.value)) : '—') + '</span><span class="compare-year">' +
            (estimate ? 'Live estimate · baseline ' + estimate.year : 'No population estimate') + '</span></td>';
        }
        return '<td><span class="compare-value">' +
          (value ? formatValue(value, indicator.key, indicator.format === 'currency') : '—') +
          '</span><span class="compare-year">' + (value ? 'Reported ' + value.year : 'No observation available') + '</span></td>';
      }).join('') + '</tr>';
    }).join('');

    $('#compare-results').innerHTML = '<table class="compare-table">' + head + '<tbody>' + body + '</tbody></table>';
  }


  function openCountry(code) {
    const country = state.countries.find(item => item.code === code);
    if (!country) return;
    state.selectedCountry = code;

    const population = valueFor(code, 'population');
    const growth = valueFor(code, 'population_growth');
    const estimate = estimatedPopulation(code);
    const livePanel = '<section class="live-population-panel">' +
      '<div class="live-population-heading"><span class="live-indicator-dot"></span><span>LIVE POPULATION ESTIMATE</span><span class="live-update-label">UPDATES EVERY SECOND</span></div>' +
      '<strong id="country-live-population">' + (estimate ? fmt.format(Math.round(estimate.value)) : '—') + '</strong>' +
      '<small>' + (population ? 'Based on the ' + population.year + ' midyear population estimate' : 'Population baseline unavailable') +
      (growth ? ' and ' + growth.value.toFixed(2) + '% annual growth (' + growth.year + ')' : '') + '</small></section>';

    const statCards = INDICATORS.map(indicator => {
      const value = valueFor(code, indicator.key);
      if (indicator.key === 'population') {
        return '<div class="detail-stat"><span>' + escapeHTML(indicator.short.toUpperCase()) + '</span><strong>' +
          (population ? fmt.format(Math.round(population.value)) : '—') + '</strong><small>' +
          (population ? 'Official midyear baseline · ' + population.year : 'No observation available') + '</small></div>';
      }
      return '<div class="detail-stat"><span>' + escapeHTML(indicator.short.toUpperCase()) + '</span><strong>' +
        (value ? formatValue(value, indicator.key, indicator.format === 'currency') : '—') + '</strong><small>' +
        (value ? 'Reported ' + value.year : 'No observation available') + '</small></div>';
    }).join('');

    const worldPop = estimatedPopulation('WLD');
    let context = 'Country-level averages are a starting point. They can hide substantial differences within a country.';
    if (estimate && worldPop && worldPop.value > 0) {
      const share = estimate.value / worldPop.value * 100;
      context = escapeHTML(country.name) + ' represents approximately ' + share.toFixed(2) +
        '% of the estimated global population. The live figure is a projection from published midyear population and growth-rate data, not a real-time census.';
    }

    $('#country-detail-content').innerHTML = '<div class="detail-flag">' + flagEmoji(country.iso2) + '</div>' +
      '<h2>' + escapeHTML(country.name) + '</h2>' +
      '<div class="detail-subtitle">' + escapeHTML(country.region) + ' · ' + escapeHTML(country.income) + '</div>' +
      livePanel + '<div class="detail-stat-grid">' + statCards + '</div>' +
      '<p class="detail-note">' + context + '</p>' +
      '<div class="detail-actions"><button class="button button-primary" id="detail-compare">Compare this country ↗</button>' +
      '<a class="button button-outline" href="https://data.worldbank.org/country/' + country.code.toLowerCase() + '" target="_blank" rel="noopener noreferrer">More from World Bank ↗</a></div>' +
      '<div class="detail-source">Sources: World Bank Indicators API and WHO/UNICEF JMP. Published indicators have different reporting years. The population counter is an estimate, not a live census.</div>';

    $('#country-detail').hidden = false;
    document.body.style.overflow = 'hidden';
    updateLivePopulationDisplays();

    $('#detail-compare').addEventListener('click', () => {
      const target = ['compare-a', 'compare-b', 'compare-c'].find(id => ![...$$('#compare-selectors select')].some(select => select.value === code && select.id !== id));
      const chosen = target || 'compare-a';
      $('#' + chosen).value = code;
      renderCompareResults();
      closeCountry();
      navigate('compare');
    });
  }


  function closeCountry() {
    $('#country-detail').hidden = true;
    document.body.style.overflow = '';
  }

  function renderIndicatorDirectory() {
    const categories = [...new Set(INDICATORS.map(indicator => indicator.category))];
    $('#indicator-directory').innerHTML = categories.map(category => {
      const cards = INDICATORS.filter(indicator => indicator.category === category).map(indicator =>
        '<article class="indicator-item"><span class="indicator-code">' + indicator.code + '</span>' +
        '<strong>' + escapeHTML(indicator.short) + '</strong><p>' + escapeHTML(indicator.description) + '</p>' +
        '<a href="' + indicator.source + '" target="_blank" rel="noopener noreferrer">View source definition ↗</a></article>'
      ).join('');
      return '<section class="indicator-category"><h3>' + escapeHTML(category) + '</h3><div class="indicator-category-grid">' + cards + '</div></section>';
    }).join('');
  }


  const GAME_MODES = {
    population: { title: 'Population Guess', description: 'Can you estimate how many people live in a country?', icon: '◎', scoreLabel: 'Up to 1,000 points per guess' },
    duel: { title: 'Population Duel', description: 'Two countries. One has more people. Pick the bigger population.', icon: '⚖', scoreLabel: '150 points per correct answer' },
    flags: { title: 'Flag Finder', description: 'Recognise a national flag and pick the right country.', icon: '⚑', scoreLabel: '150 points per correct answer' },
    capitals: { title: 'Capital Cities', description: 'Match capital cities to the countries they belong to.', icon: '⌖', scoreLabel: '150 points per correct answer' },
    data: { title: 'Data Detective', description: 'Use HUMANITY statistics to find the right country.', icon: '⌁', scoreLabel: '150 points per correct answer' }
  };

  const gameState = {
    mode: null,
    score: 0,
    streak: 0,
    bestStreak: 0,
    round: 1,
    totalRounds: 10,
    question: null,
    answered: false,
    finished: false,
    bestScores: {}
  };

  function readGameBests() {
    try {
      const value = JSON.parse(localStorage.getItem('humanity-game-bests') || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function saveGameBest(mode, score) {
    const bests = readGameBests();
    const previous = Number(bests[mode]) || 0;
    const best = Math.max(previous, score);
    bests[mode] = best;
    try { localStorage.setItem('humanity-game-bests', JSON.stringify(bests)); }
    catch (_) { /* Scores still work for this session if storage is unavailable. */ }
    gameState.bestScores = bests;
    return { best, isNew: score > previous };
  }

  function renderGameModes() {
    gameState.bestScores = readGameBests();
    const grid = $('#game-mode-grid');
    if (!grid) return;
    grid.innerHTML = Object.entries(GAME_MODES).map(([key, mode]) =>
      '<button class="game-mode-card" type="button" data-game-mode="' + key + '">' +
        '<span class="game-mode-icon" aria-hidden="true">' + mode.icon + '</span>' +
        '<span class="game-mode-title">' + escapeHTML(mode.title) + '</span>' +
        '<span class="game-mode-description">' + escapeHTML(mode.description) + '</span>' +
        '<span class="game-mode-footer"><span>' + escapeHTML(mode.scoreLabel) + '</span><strong>PLAY ↗</strong></span>' +
        '<span class="game-mode-best">PERSONAL BEST <b>' + (Number(gameState.bestScores[key]) || 0).toLocaleString('en-US') + '</b></span>' +
      '</button>'
    ).join('');
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function shuffled(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function countryPopulationPool() {
    return state.countries.filter(country =>
      valueFor(country.code, 'population') &&
      estimatedPopulation(country.code) &&
      estimatedPopulation(country.code).value > 1000
    );
  }

  function countriesWithIndicator(key) {
    return state.countries.filter(country => {
      const value = valueFor(country.code, key);
      return value && Number.isFinite(value.value);
    });
  }

  function makeOptions(correct, pool, count = 4) {
    const alternatives = shuffled(pool.filter(item => item.code !== correct.code)).slice(0, count - 1);
    return shuffled([correct, ...alternatives]);
  }

  function createGameQuestion(mode) {
    const populationPool = countryPopulationPool();
    if (mode === 'population') {
      if (!populationPool.length) throw new Error('Population data is not available yet.');
      const country = randomItem(populationPool);
      return { type: mode, country, estimate: estimatedPopulation(country.code) };
    }

    if (mode === 'duel') {
      if (populationPool.length < 2) throw new Error('Not enough population data for this game.');
      const choices = shuffled(populationPool).slice(0, 2);
      const estimates = choices.map(country => ({ country, estimate: estimatedPopulation(country.code) }));
      const correctCode = estimates[0].estimate.value >= estimates[1].estimate.value
        ? estimates[0].country.code
        : estimates[1].country.code;
      return { type: mode, choices: estimates, correctCode };
    }

    if (mode === 'flags') {
      if (populationPool.length < 4) throw new Error('Not enough country data for this game.');
      const correct = randomItem(populationPool);
      return { type: mode, correct, options: makeOptions(correct, populationPool) };
    }

    if (mode === 'capitals') {
      const pool = state.countries.filter(country =>
        country.capital && country.capital.trim() &&
        country.capital.trim() !== '-' &&
        country.capital.trim().toLowerCase() !== 'n/a'
      );
      if (pool.length < 4) throw new Error('Capital-city data is not available yet.');
      const correct = randomItem(pool);
      return { type: mode, correct, options: makeOptions(correct, pool) };
    }

    if (mode === 'data') {
      const metricKeys = ['life', 'internet', 'gdp', 'population_growth', 'fertility', 'unemployment', 'co2', 'water', 'electricity_access', 'literacy', 'renewables_share', 'pm25'];
      const available = metricKeys.filter(key => countriesWithIndicator(key).length >= 4);
      if (!available.length) throw new Error('There are not enough published statistics for the data quiz yet.');
      const key = randomItem(available);
      const indicator = INDICATORS.find(item => item.key === key);
      const pool = countriesWithIndicator(key);
      const options = shuffled(pool).slice(0, 4);
      const correct = options.reduce((best, country) =>
        valueFor(country.code, key).value > valueFor(best.code, key).value ? country : best
      );
      return { type: mode, key, indicator, options, correct, correctCode: correct.code };
    }

    throw new Error('Unknown game mode.');
  }

  function updateGameHud() {
    $('#game-score').textContent = gameState.score.toLocaleString('en-US');
    $('#game-streak').textContent = gameState.streak;
    $('#game-round').textContent = gameState.round + ' / ' + gameState.totalRounds;
    $('#game-progress-fill').style.width = (gameState.round / gameState.totalRounds * 100) + '%';
  }

  function startGame(mode) {
    if (!GAME_MODES[mode]) return;
    if (!state.dataReady || !state.countries.length) {
      showToast('Connect to the HUMANITY data service before starting a game.');
      return;
    }
    gameState.mode = mode;
    gameState.score = 0;
    gameState.streak = 0;
    gameState.bestStreak = 0;
    gameState.round = 1;
    gameState.answered = false;
    gameState.finished = false;
    $('#game-mode-grid').hidden = true;
    $('#game-session').hidden = false;
    $('#game-session-title').textContent = GAME_MODES[mode].title;
    updateGameHud();
    renderGameQuestion();
    $('#game-session').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderGameQuestion() {
    const area = $('#game-play-area');
    gameState.answered = false;
    try {
      gameState.question = createGameQuestion(gameState.mode);
    } catch (error) {
      area.innerHTML = '<div class="game-empty"><h2>Not enough data yet</h2><p>' +
        escapeHTML(error.message) + '</p><button class="button button-outline" type="button" data-game-back>Choose another game</button></div>';
      return;
    }

    updateGameHud();
    const q = gameState.question;
    if (q.type === 'population') {
      const baseline = valueFor(q.country.code, 'population');
      const growth = valueFor(q.country.code, 'population_growth');
      area.innerHTML = '<div class="game-question-eyebrow">ROUND ' + gameState.round + ' · POPULATION ESTIMATION</div>' +
        '<div class="game-country-heading"><span class="game-country-flag">' + flagEmoji(q.country.iso2) + '</span><div><h2>' + escapeHTML(q.country.name) + '</h2><p>' + escapeHTML(q.country.region) + '</p></div></div>' +
        '<p class="game-question-text">How many people live in <strong>' + escapeHTML(q.country.name) + '</strong>?</p>' +
        '<p class="game-question-note">Enter your best estimate. You can be close without getting the exact number.</p>' +
        '<form id="population-guess-form" class="population-guess-form">' +
          '<label for="population-guess-input">YOUR ESTIMATE</label>' +
          '<div class="population-input-row"><input id="population-guess-input" name="guess" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 12,500,000" required><button class="button button-primary" type="submit">Lock in guess ↗</button></div>' +
        '</form>' +
        '<div class="game-source-note">Population baseline: ' + baseline.year + (growth ? ' · annual growth: ' + growth.value.toFixed(2) + '% (' + growth.year + ')' : '') +
        ' · estimate model updates while this game is open.</div>';
      $('#population-guess-input').focus();
      return;
    }

    if (q.type === 'duel') {
      area.innerHTML = '<div class="game-question-eyebrow">ROUND ' + gameState.round + ' · POPULATION DUEL</div>' +
        '<h2 class="game-question-text">Which country has the <em>larger population?</em></h2>' +
        '<div class="duel-options">' + q.choices.map(item =>
          '<button class="duel-country" type="button" data-game-choice="' + item.country.code + '">' +
            '<span class="game-country-flag">' + flagEmoji(item.country.iso2) + '</span>' +
            '<strong>' + escapeHTML(item.country.name) + '</strong>' +
            '<small>' + escapeHTML(item.country.region) + '</small><span class="duel-reveal"></span>' +
          '</button>'
        ).join('') + '</div>' +
        '<p class="game-question-note">Choose the country with more estimated inhabitants.</p>';
      return;
    }

    if (q.type === 'flags') {
      area.innerHTML = '<div class="game-question-eyebrow">ROUND ' + gameState.round + ' · FLAG FINDER</div>' +
        '<h2 class="game-question-text">Which country does this flag belong to?</h2>' +
        '<div class="flag-question">' + flagEmoji(q.correct.iso2) + '</div>' +
        '<div class="game-choice-grid">' + q.options.map(country =>
          '<button class="game-choice" type="button" data-game-choice="' + country.code + '">' + escapeHTML(country.name) + '</button>'
        ).join('') + '</div>';
      return;
    }

    if (q.type === 'capitals') {
      area.innerHTML = '<div class="game-question-eyebrow">ROUND ' + gameState.round + ' · CAPITAL CITIES</div>' +
        '<h2 class="game-question-text">Which country has this capital?</h2>' +
        '<div class="capital-question">' + escapeHTML(q.correct.capital) + '</div>' +
        '<div class="game-choice-grid">' + q.options.map(country =>
          '<button class="game-choice" type="button" data-game-choice="' + country.code + '">' +
            flagEmoji(country.iso2) + ' ' + escapeHTML(country.name) + '</button>'
        ).join('') + '</div>';
      return;
    }

    if (q.type === 'data') {
      area.innerHTML = '<div class="game-question-eyebrow">ROUND ' + gameState.round + ' · DATA DETECTIVE</div>' +
        '<h2 class="game-question-text">Which of these countries has the <em>highest</em> ' + escapeHTML(q.indicator.short.toLowerCase()) + '?</h2>' +
        '<p class="game-question-note">Compare the latest available observation for each country.</p>' +
        '<div class="game-choice-grid">' + q.options.map(country =>
          '<button class="game-choice" type="button" data-game-choice="' + country.code + '">' +
            flagEmoji(country.iso2) + ' ' + escapeHTML(country.name) +
            '<small>' + escapeHTML(q.indicator.unit) + '</small></button>'
        ).join('') + '</div>';
    }
  }

  function answerGameChoice(code) {
    if (gameState.answered || !gameState.question) return;
    const q = gameState.question;
    const correctCode = q.type === 'duel' ? q.correctCode : q.correctCode || q.correct.code;
    const correct = code === correctCode;
    scoreGameAnswer(correct, q);
    const area = $('#game-play-area');

    $$('[data-game-choice]', area).forEach(button => {
      button.disabled = true;
      const choiceCode = button.dataset.gameChoice;
      if (choiceCode === correctCode) button.classList.add('is-correct');
      else if (choiceCode === code && !correct) button.classList.add('is-incorrect');
      if (q.type === 'duel') {
        const item = q.choices.find(entry => entry.country.code === choiceCode);
        const reveal = button.querySelector('.duel-reveal');
        if (reveal && item) reveal.textContent = fmt.format(Math.round(item.estimate.value)) + ' estimated people';
      }
    });

    let explanation = 'The correct answer is ' + (q.type === 'duel'
      ? q.choices.find(item => item.country.code === correctCode).country.name
      : q.correct.name) + '.';

    if (q.type === 'capitals') explanation = q.correct.capital + ' is the capital of ' + q.correct.name + '.';
    if (q.type === 'data') {
      const value = valueFor(q.correct.code, q.key);
      explanation = q.correct.name + ' has the highest ' + q.indicator.short.toLowerCase() +
        ' in this round: ' + formatValue(value, q.key) + ' (reported ' + value.year + ').';
    }
    if (q.type === 'duel') {
      const winner = q.choices.find(item => item.country.code === correctCode);
      explanation = winner.country.name + ' has the larger estimated population: ' + fmt.format(Math.round(winner.estimate.value)) + '.';
    }
    showGameFeedback(correct, correct ? 150 : 0, explanation);
  }

  function scoreGameAnswer(correct, q, points = null) {
    gameState.answered = true;
    const earned = points === null ? (correct ? 150 : 0) : points;
    gameState.score += earned;
    gameState.streak = correct ? gameState.streak + 1 : 0;
    gameState.bestStreak = Math.max(gameState.bestStreak, gameState.streak);
    updateGameHud();
  }

  function showGameFeedback(correct, points, explanation) {
    const area = $('#game-play-area');
    const feedback = document.createElement('div');
    feedback.className = 'game-feedback ' + (correct ? 'correct' : 'incorrect');
    feedback.innerHTML = '<div class="game-feedback-top"><strong>' + (correct ? 'Correct!' : 'Not quite') +
      '</strong><span>' + (points ? '+' + points.toLocaleString('en-US') + ' points' : 'No points this round') + '</span></div>' +
      '<p>' + escapeHTML(explanation) + '</p>' +
      '<button class="button button-primary" type="button" data-game-next>' +
      (gameState.round >= gameState.totalRounds ? 'See results ↗' : 'Next round ↗') + '</button>';
    area.appendChild(feedback);
  }

  function submitPopulationGuess(form) {
    if (gameState.answered || gameState.mode !== 'population' || !gameState.question) return;
    const input = $('#population-guess-input', form);
    const raw = String(input.value || '').trim();
    const guess = Number(raw.replace(/[,\s]/g, ''));
    if (!Number.isFinite(guess) || guess <= 0) {
      input.setCustomValidity('Enter a population estimate greater than zero.');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');

    const q = gameState.question;
    const target = q.estimate.value;
    const errorRate = Math.abs(guess - target) / target;
    const points = Math.max(0, Math.round(1000 * (1 - Math.min(errorRate, 1))));
    const correct = errorRate <= 0.05;
    scoreGameAnswer(correct, q, points);

    form.querySelector('input').disabled = true;
    form.querySelector('button[type="submit"]').disabled = true;

    const difference = Math.abs(guess - target);
    const direction = guess > target ? 'too high' : 'too low';
    const explanation = 'The estimate is ' + fmt.format(Math.round(target)) +
      ' people, based on the ' + q.estimate.year + ' midyear baseline and annual growth data. Your guess was ' +
      fmt.format(Math.round(difference)) + ' people ' + direction + '.';
    showGameFeedback(correct, points, explanation);
  }

  function finishGame() {
    gameState.finished = true;
    const result = saveGameBest(gameState.mode, gameState.score);
    $('#game-play-area').innerHTML =
      '<div class="game-finish"><div class="game-question-eyebrow">CHALLENGE COMPLETE</div>' +
      '<div class="game-finish-score">' + gameState.score.toLocaleString('en-US') + '</div>' +
      '<h2>' + (result.isNew ? 'A new personal best.' : 'Challenge complete.') + '</h2>' +
      '<p>You finished ' + gameState.totalRounds + ' rounds with a best streak of ' + gameState.bestStreak + '.</p>' +
      '<div class="game-finish-actions"><button class="button button-primary" type="button" data-game-replay>Play again ↗</button>' +
      '<button class="button button-outline" type="button" data-game-back>All games</button></div></div>';
    renderGameModes();
  }

  function advanceGame() {
    if (!gameState.answered) return;
    if (gameState.round >= gameState.totalRounds) {
      finishGame();
      return;
    }
    gameState.round += 1;
    renderGameQuestion();
  }

  function backToGameModes() {
    $('#game-session').hidden = true;
    $('#game-mode-grid').hidden = false;
    gameState.mode = null;
    gameState.question = null;
    gameState.answered = false;
    gameState.finished = false;
    renderGameModes();
    $('#game-mode-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function initGameInteractions() {
    $('#game-mode-grid').addEventListener('click', event => {
      const button = event.target.closest('[data-game-mode]');
      if (button) startGame(button.dataset.gameMode);
    });

    $('#game-back').addEventListener('click', backToGameModes);

    $('#game-play-area').addEventListener('submit', event => {
      if (event.target.id !== 'population-guess-form') return;
      event.preventDefault();
      submitPopulationGuess(event.target);
    });

    $('#game-play-area').addEventListener('click', event => {
      const choice = event.target.closest('[data-game-choice]');
      const next = event.target.closest('[data-game-next]');
      const back = event.target.closest('[data-game-back]');
      const replay = event.target.closest('[data-game-replay]');
      if (choice) answerGameChoice(choice.dataset.gameChoice);
      else if (next) advanceGame();
      else if (back) backToGameModes();
      else if (replay) startGame(gameState.mode);
    });

    renderGameModes();
  }

  function exportCSV() {
    if (!state.countries.length) { showToast('Country data is not available yet.'); return; }
    const headers = ['Country', 'ISO3', 'Region', ...INDICATORS.flatMap(indicator => [indicator.short, `${indicator.short} year`])];
    const rows = getFilteredCountries().map(country => [country.name, country.code, country.region, ...INDICATORS.flatMap(indicator => {
      const value = valueFor(country.code, indicator.key);
      return [value?.value ?? '', value?.year ?? ''];
    })]);
    const csv = [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `humanity-country-data-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast('Your country data export is ready.');
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function navigate(page) {
    const valid = ['overview', 'explore', 'compare', 'stories', 'games', 'about'];
    if (!valid.includes(page)) page = 'overview';
    if (location.hash !== `#${page}`) history.pushState(null, '', `#${page}`);
    activatePage(page);
  }

  function activatePage(page) {
    const valid = ['overview', 'explore', 'compare', 'stories', 'about'];
    if (!valid.includes(page)) page = 'overview';
    $$('.page').forEach(section => {
      const active = section.dataset.page === page;
      section.hidden = !active;
      section.classList.toggle('active', active);
    });
    $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.nav === page));
    $('#main-nav')?.classList.remove('open');
    $('#mobile-menu-toggle').setAttribute('aria-expanded', 'false');
    if (page === 'explore') renderCountryTable();
    if (page === 'compare') renderCompareResults();
    if (page === 'games') renderGameModes();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAll() {
    renderWorldMetrics();
    renderCharts();
    renderPreview();
    renderCountryTable();
    renderCompareSelectors();
    renderCountrySortOptions();
    renderIndicatorDirectory();
    $('#current-year').textContent = new Date().getFullYear();
  }

  function initNavigation() {
    const nav = $('.main-nav');
    nav.id = 'main-nav';
    $$('.nav-link').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      navigate(link.dataset.nav);
    }));
    $('#mobile-menu-toggle').addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      $('#mobile-menu-toggle').setAttribute('aria-expanded', String(open));
    });
    window.addEventListener('hashchange', () => activatePage(location.hash.slice(1)));
    window.addEventListener('popstate', () => activatePage(location.hash.slice(1)));
    const initial = location.hash.slice(1);
    activatePage(initial || 'overview');
  }

  function initInteractions() {
    $('#country-search').addEventListener('input', () => { state.visibleCount = PAGE_SIZE; renderCountryTable(); });
    $('#region-filter').addEventListener('change', () => { state.visibleCount = PAGE_SIZE; renderCountryTable(); });
    $('#country-sort').addEventListener('change', () => { state.visibleCount = PAGE_SIZE; renderCountryTable(); });
    $('#load-more').addEventListener('click', () => { state.visibleCount += PAGE_SIZE; renderCountryTable(); });
    $('#export-csv').addEventListener('click', exportCSV);
    ['compare-a', 'compare-b', 'compare-c'].forEach(id => $('#' + id).addEventListener('change', renderCompareResults));
    $('#country-table-body').addEventListener('click', event => {
      const countryButton = event.target.closest('[data-country]');
      const compareButton = event.target.closest('[data-compare-country]');
      if (countryButton) openCountry(countryButton.dataset.country);
      if (compareButton) {
        const code = compareButton.dataset.compareCountry;
        const selects = ['compare-a', 'compare-b', 'compare-c'].map(id => $('#' + id));
        const alreadySelected = selects.some(select => select.value === code);
        if (!alreadySelected) selects[2].value = code;
        renderCompareResults();
        showToast(alreadySelected ? 'This country is already in the comparison.' : 'Country added to the third comparison slot.');
      }
    });
    $('#country-preview').addEventListener('click', event => {
      const card = event.target.closest('[data-preview-country]');
      if (card) {
        event.preventDefault();
        navigate('explore');
        openCountry(card.dataset.previewCountry);
      }
    });
    $('#detail-close').addEventListener('click', closeCountry);
    $('#detail-backdrop').addEventListener('click', closeCountry);
    initGameInteractions();
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeCountry();
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        event.preventDefault();
        navigate('explore');
        setTimeout(() => $('#country-search').focus(), 50);
      }
    });
  }

  function initPWA() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.info('Offline cache is unavailable:', error)));
    }
  }

  function initLiveUpdates() {
    updateLivePopulationDisplays();
    window.setInterval(updateLivePopulationDisplays, 1000);
    window.setInterval(() => {
      if (!document.hidden) loadData();
    }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      updateLivePopulationDisplays();
      if (!document.hidden && Date.now() - state.lastFetchAt > 2 * 60 * 1000) loadData();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initInteractions();
    renderIndicatorDirectory();
    $('#current-year').textContent = new Date().getFullYear();
    initPWA();
    initLiveUpdates();
    loadData();
  });
})();
