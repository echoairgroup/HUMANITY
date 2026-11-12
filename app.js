'use strict';

(() => {
  const API_ROOT = 'https://humanity-api-jyk5.onrender.com/api';
  const CACHE_PREFIX = 'humanity-worldbank-v1:';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const PAGE_SIZE = 18;

  const INDICATORS = [
    { key: 'population', code: 'SP.POP.TOTL', name: 'Population, total', short: 'Population', unit: 'people', description: 'The total number of people living in a country or area. Population estimates and census methods can vary by country.', source: 'https://data.worldbank.org/indicator/SP.POP.TOTL', format: 'population' },
    { key: 'life', code: 'SP.DYN.LE00.IN', name: 'Life expectancy at birth, total (years)', short: 'Life expectancy', unit: 'years', description: 'The number of years a newborn would live if patterns of mortality at the time of birth stayed the same throughout their life.', source: 'https://data.worldbank.org/indicator/SP.DYN.LE00.IN', format: 'years' },
    { key: 'internet', code: 'IT.NET.USER.ZS', name: 'Individuals using the Internet (% of population)', short: 'Internet use', unit: '% of population', description: 'The percentage of people who used the Internet from any location in the last three months, as defined by the source.', source: 'https://data.worldbank.org/indicator/IT.NET.USER.ZS', format: 'percent' },
    { key: 'gdp', code: 'NY.GDP.PCAP.CD', name: 'GDP per capita (current US$)', short: 'GDP per person', unit: 'current US dollars', description: 'Gross domestic product divided by midyear population. It is an economic average, not a measure of individual income or how wealth is distributed.', source: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.CD', format: 'currency' },
    { key: 'co2', code: 'EN.ATM.CO2E.PC', name: 'CO₂ emissions (metric tons per capita)', short: 'CO₂ per person', unit: 'metric tons per person', description: 'Territorial carbon dioxide emissions divided by population. This is not a full measure of a person’s or country’s climate footprint.', source: 'https://data.worldbank.org/indicator/EN.ATM.CO2E.PC', format: 'decimal' },
    { key: 'water', code: 'SH.H2O.BASW.ZS', name: 'People using at least basic drinking water services (% of population)', short: 'Basic drinking water', unit: '% of population', description: 'The share of people using an improved drinking-water source with a collection time of no more than 30 minutes for a round trip.', source: 'https://data.worldbank.org/indicator/SH.H2O.BASW.ZS', format: 'percent' }
  ];

  const state = {
    countries: [],
    values: Object.fromEntries(INDICATORS.map(item => [item.key, {}])),
    world: {},
    history: {},
    dataReady: false,
    dataSource: 'none',
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
    setDataStatus('loading', 'Connecting to HUMANITY');
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
        : 9;

      if (payload.meta && payload.meta.cacheStatus === 'stale') {
        setDataStatus('ok', 'Saved data · updating');
      } else if (datasets < expected) {
        setDataStatus('ok', 'Live data · partial coverage');
      } else {
        setDataStatus('ok', 'World data connected');
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
      case 'years': return `${number.toFixed(1)} yrs`;
      case 'percent': return `${number.toFixed(1)}%`;
      case 'currency': return compactMode ? money.format(number) : money.format(number);
      case 'decimal': return `${number.toFixed(2)} t`;
      default: return fmt.format(number);
    }
  }

  function formatCell(value, key) {
    if (!value) return '<span class="muted-value">—</span>';
    const number = value.value;
    const indicator = INDICATORS.find(item => item.key === key);
    let formatted = '—';
    if (indicator?.format === 'population') formatted = compact.format(number);
    else if (indicator?.format === 'years') formatted = `${number.toFixed(1)} yrs`;
    else if (indicator?.format === 'percent') formatted = `${number.toFixed(1)}%`;
    else if (indicator?.format === 'currency') formatted = money.format(number);
    else if (indicator?.format === 'decimal') formatted = `${number.toFixed(2)} t`;
    return `${formatted}<span class="year-mini">${value.year ?? ''}</span>`;
  }

  function renderWorldMetrics() {
    const specs = [
      { key: 'population', label: 'WORLD POPULATION', sub: 'People on Earth', icon: '◎', primary: true },
      { key: 'life', label: 'LIFE EXPECTANCY', sub: 'Years at birth', icon: '⌁' },
      { key: 'internet', label: 'INTERNET ACCESS', sub: 'Of world population', icon: '⌘' },
      { key: 'gdp', label: 'GDP PER PERSON', sub: 'Current US dollars', icon: '↗' }
    ];
    const container = $('#world-metrics');
    container.innerHTML = specs.map(spec => {
      const value = worldValue(spec.key);
      let display = formatValue(value, spec.key, true);
      if (spec.key === 'life' && value) display = `${value.value.toFixed(1)} years`;
      return `<article class="metric-card ${spec.primary ? 'metric-card-main' : ''}"><div class="metric-top"><span>${spec.label}</span><span class="metric-icon">${spec.icon}</span></div><div class="metric-value">${display}</div><div class="metric-bottom"><span>${spec.sub}</span><span class="metric-year">${value?.year ?? '—'}</span></div></article>`;
    }).join('');
    const population = worldValue('population');
    $('#globe-population').textContent = population ? compact.format(population.value) : 'DATA LOADING';
    $('#story-population').textContent = population ? compact.format(population.value) : '—';
    $('#story-population-year').textContent = population ? `World Bank observation · ${population.year}` : 'Latest available observation';
    const yearValues = specs.map(spec => worldValue(spec.key)?.year).filter(Boolean);
    $('#updated-note').textContent = yearValues.length ? `Latest observations · ${Math.min(...yearValues)}–${Math.max(...yearValues)}` : 'Latest available observations';
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

  function getCountriesSorted(key = 'population') {
    const metricKey = key === 'name' ? null : key;
    const countries = [...state.countries];
    if (metricKey) countries.sort((a, b) => (valueFor(b.code, metricKey)?.value ?? -Infinity) - (valueFor(a.code, metricKey)?.value ?? -Infinity));
    else countries.sort((a, b) => a.name.localeCompare(b.name));
    return countries;
  }

  function renderPreview() {
    const best = getCountriesSorted('population').filter(country => valueFor(country.code, 'population')).slice(0, 4);
    const container = $('#country-preview');
    if (!best.length) { container.innerHTML = '<div class="preview-placeholder">Country snapshots will appear when the data is ready.</div>'; return; }
    container.innerHTML = best.map(country => `<a class="country-preview-card" href="#explore" data-preview-country="${country.code}"><div class="preview-top"><span class="flag">${flagEmoji(country.iso2)}</span><span class="preview-region">${escapeHTML(country.region)}</span></div><div class="preview-name">${escapeHTML(country.name)}</div><div class="preview-pop">${formatValue(valueFor(country.code, 'population'), 'population', true)} people</div></a>`).join('');
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
      tbody.innerHTML = '<tr><td colspan="7" class="table-message">Country data is not available. Check your connection and reload the page.</td></tr>';
      $('#country-count').textContent = 'No country data';
      $('#table-range').textContent = 'Data unavailable';
      $('#load-more').hidden = true;
      return;
    }
    const filtered = getFilteredCountries();
    const visible = filtered.slice(0, state.visibleCount);
    $('#country-count').textContent = `${fmt.format(filtered.length)} economies found`;
    $('#table-range').textContent = `Showing ${visible.length} of ${filtered.length}`;
    $('#load-more').hidden = visible.length >= filtered.length;
    if (!visible.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-message">No countries match that search. Try another name or region.</td></tr>';
      return;
    }
    tbody.innerHTML = visible.map(country => `<tr><td><button class="country-name-button" data-country="${country.code}"><span class="table-flag">${flagEmoji(country.iso2)}</span>${escapeHTML(country.name)}</button></td><td>${escapeHTML(country.region)}</td><td class="numeric">${formatCell(valueFor(country.code, 'population'), 'population')}</td><td class="numeric">${formatCell(valueFor(country.code, 'life'), 'life')}</td><td class="numeric">${formatCell(valueFor(country.code, 'internet'), 'internet')}</td><td class="numeric">${formatCell(valueFor(country.code, 'gdp'), 'gdp')}</td><td><button class="table-action" data-compare-country="${country.code}" aria-label="Add ${escapeHTML(country.name)} to comparison">Compare +</button></td></tr>`).join('');
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
    const metrics = ['population', 'life', 'internet', 'gdp', 'co2', 'water'];
    const head = `<thead><tr><th>INDICATOR</th>${countries.map(country => `<th class="compare-country-head">${flagEmoji(country.iso2)} ${escapeHTML(country.name)}<small>${escapeHTML(country.region)}</small></th>`).join('')}</tr></thead>`;
    const body = metrics.map(key => {
      const indicator = INDICATORS.find(item => item.key === key);
      return `<tr><td>${escapeHTML(indicator.short)}</td>${countries.map(country => {
        const value = valueFor(country.code, key);
        return `<td><span class="compare-value">${value ? formatValue(value, key, key === 'population' || key === 'gdp') : '—'}</span><span class="compare-year">${value ? `Reported ${value.year}` : 'No observation available'}</span></td>`;
      }).join('')}</tr>`;
    }).join('');
    $('#compare-results').innerHTML = `<table class="compare-table">${head}<tbody>${body}</tbody></table>`;
  }

  function openCountry(code) {
    const country = state.countries.find(item => item.code === code);
    if (!country) return;
    state.selectedCountry = code;
    const metrics = ['population', 'life', 'internet', 'gdp', 'co2', 'water'];
    const statCards = metrics.map(key => {
      const indicator = INDICATORS.find(item => item.key === key);
      const value = valueFor(code, key);
      return `<div class="detail-stat"><span>${escapeHTML(indicator.short.toUpperCase())}</span><strong>${value ? formatValue(value, key, key === 'population' || key === 'gdp') : '—'}</strong><small>${value ? `Reported ${value.year}` : 'No observation available'}</small></div>`;
    }).join('');
    const worldPop = worldValue('population');
    const pop = valueFor(code, 'population');
    let context = 'Country-level averages are a starting point. They can hide substantial differences within a country.';
    if (pop && worldPop) {
      const share = pop.value / worldPop.value * 100;
      context = `${escapeHTML(country.name)} represents approximately ${share.toFixed(2)}% of the global population, using the latest available population observations (${pop.year} for this country; ${worldPop.year} for the world). Country-level averages can hide substantial differences within a country.`;
    }
    $('#country-detail-content').innerHTML = `<div class="detail-flag">${flagEmoji(country.iso2)}</div><h2>${escapeHTML(country.name)}</h2><div class="detail-subtitle">${escapeHTML(country.region)} · ${escapeHTML(country.income)}</div><div class="detail-stat-grid">${statCards}</div><p class="detail-note">${context}</p><div class="detail-actions"><button class="button button-primary" id="detail-compare">Compare this country ↗</button><a class="button button-outline" href="https://data.worldbank.org/country/${country.code.toLowerCase()}" target="_blank" rel="noopener noreferrer">More from World Bank ↗</a></div><div class="detail-source">Source: World Bank Indicators API. Values are the latest available observations for each indicator, not necessarily the same year.</div>`;
    $('#country-detail').hidden = false;
    document.body.style.overflow = 'hidden';
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
    $('#indicator-directory').innerHTML = INDICATORS.map(indicator => `<article class="indicator-item"><span class="indicator-code">${indicator.code}</span><strong>${escapeHTML(indicator.short)}</strong><p>${escapeHTML(indicator.description)}</p><a href="${indicator.source}" target="_blank" rel="noopener noreferrer">View source definition ↗</a></article>`).join('');
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
    const valid = ['overview', 'explore', 'compare', 'stories', 'about'];
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAll() {
    renderWorldMetrics();
    renderCharts();
    renderPreview();
    renderCountryTable();
    renderCompareSelectors();
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

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initInteractions();
    renderIndicatorDirectory();
    $('#current-year').textContent = new Date().getFullYear();
    initPWA();
    loadData();
  });
})();
