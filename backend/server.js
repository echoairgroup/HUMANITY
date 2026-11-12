'use strict';

const http = require('node:http');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const API_BASE = 'https://api.worldbank.org/v2';
const JMP_BASE = 'https://api.washdata.org/v1';
const CURRENT_YEAR = new Date().getUTCFullYear();
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 4;
const MISSING_DATA_RETRY_MS = 15 * 60 * 1000;
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://echoairgroup.github.io')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

const INDICATORS = [
  { key: 'population', code: 'SP.POP.TOTL' },
  { key: 'life', code: 'SP.DYN.LE00.IN' },
  { key: 'internet', code: 'IT.NET.USER.ZS' },
  { key: 'gdp', code: 'NY.GDP.PCAP.CD' },
  { key: 'co2', code: 'EN.GHG.CO2.PC.CE.AR5' },
  { key: 'water', code: 'SH.H2O.BASW.ZS' }
];

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

let refreshPromise = null;
let lastRefreshAttemptAt = 0;
let lastRefresh = null;
let lastRefreshError = null;
let lastRefreshResults = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRows(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
    const message = Array.isArray(payload) && payload[0] && payload[0].message
      ? payload[0].message.map(item => item.value).filter(Boolean).join('; ')
      : 'Unexpected World Bank API response';
    throw new Error(message || 'Unexpected World Bank API response');
  }
  return payload[1];
}

async function fetchWorldBank(path) {
  const url = API_BASE + path;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; HUMANITY-Global-Data-Platform/1.2; +https://echoairgroup.github.io/HUMANITY/)'
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(
          'World Bank API returned HTTP ' + response.status +
          ' for ' + path +
          (detail ? ': ' + detail.replace(/\s+/g, ' ').slice(0, 120) : '')
        );
        error.status = response.status;
        throw error;
      }

      const payload = await response.json();
      parseRows(payload);
      return payload;
    } catch (error) {
      lastError = error;
      const retryable = !error.status || [408, 425, 429, 500, 502, 503, 504].includes(error.status);
      if (!retryable || attempt === MAX_RETRIES) break;
      const delay = [1800, 4500, 9000, 15000][attempt - 1] || 15000;
      console.warn('World Bank request retry ' + attempt + '/' + MAX_RETRIES + ': ' + error.message);
      await sleep(delay);
    }
  }

  throw lastError || new Error('World Bank API request failed');
}

async function fetchJMP(path) {
  const url = JMP_BASE + path;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'HUMANITY-Global-Data-Platform/1.2'
        },
        signal: AbortSignal.timeout(45000)
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(
          'WHO/UNICEF JMP API returned HTTP ' + response.status +
          (detail ? ': ' + detail.replace(/\s+/g, ' ').slice(0, 120) : '')
        );
        error.status = response.status;
        throw error;
      }

      const payload = await response.json();
      if (!payload || !Array.isArray(payload.results)) {
        throw new Error('WHO/UNICEF JMP API returned an unexpected response');
      }
      return payload;
    } catch (error) {
      lastError = error;
      const retryable = !error.status || [408, 425, 429, 500, 502, 503, 504].includes(error.status);
      if (!retryable || attempt === MAX_RETRIES) break;
      const delay = [2000, 5000, 10000, 15000][attempt - 1] || 15000;
      console.warn('JMP request retry ' + attempt + '/' + MAX_RETRIES + ': ' + error.message);
      await sleep(delay);
    }
  }

  throw lastError || new Error('WHO/UNICEF JMP API request failed');
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  cells.push(value);
  return cells;
}

function parseWorldBankDownload(buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find(item =>
    item.entryName.toLowerCase().endsWith('.csv') &&
    !item.entryName.toLowerCase().includes('metadata')
  );

  if (!entry) throw new Error('World Bank CSV download did not contain a data file');

  const csv = entry.getData().toString('utf8').replace(/^\uFEFF/, '');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('World Bank CSV download was empty');

  const header = parseCsvLine(lines[0]);
  const yearColumns = [];
  for (let index = 4; index < header.length; index += 1) {
    if (/^\d{4}$/.test(header[index])) {
      yearColumns.push({ index, year: Number(header[index]) });
    }
  }

  const values = {};
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const row = parseCsvLine(lines[lineIndex]);
    const code = (row[1] || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;

    for (let columnIndex = yearColumns.length - 1; columnIndex >= 0; columnIndex -= 1) {
      const column = yearColumns[columnIndex];
      const value = toNumber(row[column.index]);
      if (value === null) continue;
      values[code] = { value, year: column.year, footnote: '' };
      break;
    }
  }

  if (!Object.keys(values).length) {
    throw new Error('World Bank CSV download contained no country observations');
  }

  return values;
}

async function fetchWorldBankDownload(indicatorCode) {
  // Official zipped CSV export linked from the World Bank Open Data indicator page.
  const path = '/en/indicator/' + indicatorCode + '?downloadformat=csv';
  const url = API_BASE + path;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/zip, application/octet-stream, */*',
          'User-Agent': 'Mozilla/5.0 (compatible; HUMANITY-Global-Data-Platform/1.2)'
        },
        signal: AbortSignal.timeout(45000)
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error('World Bank CSV export returned HTTP ' + response.status +
          (detail ? ': ' + detail.replace(/\s+/g, ' ').slice(0, 100) : ''));
        error.status = response.status;
        throw error;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 100 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        throw new Error('World Bank CSV export did not return a ZIP archive');
      }
      return { values: parseWorldBankDownload(buffer), url };
    } catch (error) {
      lastError = error;
      const retryable = !error.status || [408, 425, 429, 500, 502, 503, 504].includes(error.status);
      if (!retryable || attempt === MAX_RETRIES) break;
      await sleep([2000, 5000, 10000, 15000][attempt - 1] || 15000);
    }
  }

  throw lastError || new Error('World Bank CSV export failed');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapCountries(payload) {
  return parseRows(payload)
    .filter(country =>
      country.id &&
      country.iso2Code &&
      country.region &&
      country.region.id !== 'NA' &&
      country.region.value !== 'Aggregates'
    )
    .map(country => ({
      code: country.id,
      iso2: country.iso2Code,
      name: country.name,
      region: country.region.value,
      income: country.incomeLevel && country.incomeLevel.value
        ? country.incomeLevel.value
        : 'Not classified',
      capital: country.capitalCity || '',
      longitude: toNumber(country.longitude),
      latitude: toNumber(country.latitude)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapLatestValues(payload) {
  const output = {};
  for (const row of parseRows(payload)) {
    const code = row.countryiso3code || (row.country && row.country.id);
    const value = toNumber(row.value);
    if (!code || value === null) continue;
    const year = Number(row.date);
    const observation = {
      value,
      year: Number.isFinite(year) ? year : null,
      footnote: row.obs_status || ''
    };
    if (!output[code] || (Number.isFinite(year) && year > (output[code].year || 0))) {
      output[code] = observation;
    }
  }
  return output;
}

function mapHistory(payload) {
  return parseRows(payload)
    .map(row => ({
      year: Number(row.date),
      value: toNumber(row.value)
    }))
    .filter(point => Number.isFinite(point.year) && point.value !== null)
    .sort((a, b) => a.year - b.year);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

async function saveCache(key, payload, sourceUrl = API_BASE) {
  const sql = 'INSERT INTO humanity_cache (cache_key, payload, fetched_at, source_url) ' +
    'VALUES ($1, $2::jsonb, NOW(), $3) ' +
    'ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, ' +
    'fetched_at = NOW(), source_url = EXCLUDED.source_url';
  await pool.query(sql, [key, JSON.stringify(payload), sourceUrl]);
}

async function readCache() {
  const result = await pool.query(
    'SELECT cache_key, payload, fetched_at FROM humanity_cache'
  );
  const records = {};
  for (const row of result.rows) {
    records[row.cache_key] = {
      payload: row.payload,
      fetchedAt: row.fetched_at
    };
  }
  return records;
}

async function refreshWaterIndicator() {
  const params = new URLSearchParams();
  params.append('service_type[]', 'Drinking water');
  params.append('service_level[]', 'Basic service');
  params.append('residence[]', 'total');
  params.set('year_from', '2000');
  params.set('year_to', String(CURRENT_YEAR));
  params.set('format', 'json');
  params.set('limit', '50000');

  const countryPath = '/household/estimates/country?' + params.toString();
  const countryPayload = await fetchJMP(countryPath);
  const values = {};

  for (const row of countryPayload.results) {
    const code = String(row.country || '').toUpperCase();
    const year = Number(row.year);
    const value = toNumber(row.value);
    if (!/^[A-Z]{3}$/.test(code) || value === null || !Number.isFinite(year)) continue;
    if (!values[code] || year > values[code].year) {
      values[code] = { value, year, footnote: '' };
    }
  }

  if (!Object.keys(values).length) {
    throw new Error('WHO/UNICEF JMP returned no national drinking-water observations');
  }

  const worldParams = new URLSearchParams();
  worldParams.append('region_type[]', 'world');
  worldParams.append('service_type[]', 'Drinking water');
  worldParams.append('service_level[]', 'Basic service');
  worldParams.set('year_from', '2000');
  worldParams.set('year_to', String(CURRENT_YEAR));
  worldParams.set('format', 'json');
  worldParams.set('limit', '1000');

  try {
    const worldPath = '/household/estimates/region?' + worldParams.toString();
    const worldPayload = await fetchJMP(worldPath);
    const worldRows = worldPayload.results
      .filter(row => row.region_type === 'world' && row.residence_type === 'total')
      .sort((a, b) => Number(b.year) - Number(a.year));
    if (worldRows.length) {
      const latest = worldRows[0];
      const value = toNumber(latest.value);
      const year = Number(latest.year);
      if (value !== null && Number.isFinite(year)) {
        values.WLD = { value, year, footnote: '' };
      }
    }
  } catch (error) {
    console.warn('World drinking-water aggregate unavailable: ' + error.message);
  }

  await saveCache('values_water', values, JMP_BASE + countryPath);
  return {
    key: 'water',
    observations: Object.keys(values).length,
    world: Boolean(values.WLD),
    provider: 'WHO/UNICEF Joint Monitoring Programme'
  };
}

async function refreshOneIndicator(indicator) {
  if (indicator.key === 'water') {
    return refreshWaterIndicator();
  }

  const path = '/country/all/indicator/' + indicator.code +
    '?format=json&mrnev=1&per_page=1000';

  let values;
  let sourceUrl = API_BASE + path;

  try {
    const payload = await fetchWorldBank(path);
    values = mapLatestValues(payload);
  } catch (error) {
    if (indicator.key !== 'co2') throw error;
    console.warn('World Bank CO2 JSON endpoint failed; trying official CSV export: ' + error.message);
    const downloaded = await fetchWorldBankDownload(indicator.code);
    values = downloaded.values;
    sourceUrl = downloaded.url;
  }

  if (!Object.keys(values).length) {
    throw new Error('World Bank returned no observations for ' + indicator.key);
  }

  if (!values.WLD && sourceUrl.startsWith(API_BASE)) {
    try {
      const worldPayload = await fetchWorldBank(
        '/country/WLD/indicator/' + indicator.code +
        '?format=json&mrnev=1&per_page=100'
      );
      const world = mapLatestValues(worldPayload).WLD;
      if (world) values.WLD = world;
    } catch (error) {
      console.warn('World aggregate unavailable for ' + indicator.key + ': ' + error.message);
    }
  }

  await saveCache('values_' + indicator.key, values, sourceUrl);
  return {
    key: indicator.key,
    observations: Object.keys(values).length,
    world: Boolean(values.WLD),
    provider: indicator.key === 'co2'
      ? 'World Bank WDI · EDGAR / JRC and IEA'
      : 'World Bank Indicators API v2'
  };
}

async function refreshOneHistory(indicator) {
  const path = '/country/WLD/indicator/' + indicator.code +
    '?format=json&date=2000:' + CURRENT_YEAR + '&per_page=100';
  const payload = await fetchWorldBank(path);
  const points = mapHistory(payload);
  await saveCache('history_' + indicator.key, points, API_BASE + path);
  return { key: 'history_' + indicator.key, observations: points.length };
}

async function refreshAll(options = {}) {
  if (refreshPromise) return refreshPromise;
  if (!options.force && Date.now() - lastRefreshAttemptAt < MISSING_DATA_RETRY_MS) {
    return { skipped: true, reason: 'refresh cooldown is active' };
  }
  lastRefreshAttemptAt = Date.now();

  refreshPromise = (async () => {
    const startedAt = new Date().toISOString();
    const jobs = [
      {
        name: 'countries',
        run: async () => {
          const path = '/country?format=json&per_page=400';
          const countries = mapCountries(await fetchWorldBank(path));
          if (!countries.length) throw new Error('World Bank returned no country records');
          await saveCache('countries', countries, API_BASE + path);
          return { key: 'countries', observations: countries.length };
        }
      },
      ...INDICATORS.map(indicator => ({
        name: indicator.key,
        run: () => refreshOneIndicator(indicator)
      })),
      ...['population', 'life'].map(key => ({
        name: 'history_' + key,
        run: () => refreshOneHistory(INDICATORS.find(item => item.key === key))
      }))
    ];

    const results = await mapWithConcurrency(jobs, 2, job => job.run());
    const successful = [];
    const failed = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        failed.push({
          dataset: jobs[index].name,
          error: result.reason && result.reason.message
            ? result.reason.message
            : 'Unknown upstream error'
        });
      }
    });

    lastRefresh = new Date().toISOString();
    lastRefreshResults = successful;
    lastRefreshError = failed.length ? failed : null;

    console.log(JSON.stringify({
      event: 'data_refresh',
      startedAt,
      finishedAt: lastRefresh,
      successful,
      failed
    }));

    if (!successful.some(item => item.key === 'countries')) {
      throw new Error('Country metadata refresh failed.');
    }

    return { successful, failed, finishedAt: lastRefresh };
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function cacheIsStale(records) {
  const latest = Object.values(records)
    .map(record => new Date(record.fetchedAt).getTime())
    .filter(Number.isFinite);
  if (!latest.length) return true;
  return Date.now() - Math.min(...latest) > CACHE_TTL_MS;
}

function buildBootstrap(records) {
  const countries = records.countries ? records.countries.payload : [];
  const values = {};

  for (const indicator of INDICATORS) {
    const record = records['values_' + indicator.key];
    values[indicator.key] = record ? record.payload : {};
  }

  const world = {};
  for (const indicator of INDICATORS) {
    const observation = values[indicator.key] && values[indicator.key].WLD;
    if (observation) world[indicator.key] = observation;
  }

  const history = {
    population: records.history_population ? records.history_population.payload : [],
    life: records.history_life ? records.history_life.payload : []
  };

  const timestamps = Object.values(records)
    .map(record => new Date(record.fetchedAt).getTime())
    .filter(Number.isFinite);
  const updatedAt = timestamps.length
    ? new Date(Math.min(...timestamps)).toISOString()
    : null;

  const indicatorCount = INDICATORS.filter(indicator =>
    records['values_' + indicator.key] &&
    Object.keys(records['values_' + indicator.key].payload || {}).length > 0
  ).length;

  return {
    data: { countries, values, world, history },
    meta: {
      provider: 'World Bank Indicators API v2',
      cacheStatus: cacheIsStale(records) ? 'stale' : 'fresh',
      updatedAt,
      cachedDatasets: Object.keys(records).length,
      expectedDatasets: 9,
      availableIndicators: indicatorCount,
      totalIndicators: INDICATORS.length,
      lastRefresh,
      lastRefreshError
    }
  };
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (origin && (
    ALLOWED_ORIGINS.has(origin) ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  )) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    response.setHeader('Access-Control-Max-Age', '86400');
  }
}

function sendJSON(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

async function handleRequest(request, response) {
  setCorsHeaders(request, response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, 'http://localhost');

  if (request.method !== 'GET') {
    sendJSON(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/api/health' || url.pathname === '/health') {
    try {
      const db = await pool.query('SELECT NOW() AS database_time');
      const records = await readCache();
      const summary = buildBootstrap(records).meta;
      sendJSON(response, 200, {
        ok: true,
        service: 'HUMANITY Data API',
        database: 'connected',
        cachedDatasets: summary.cachedDatasets,
        expectedDatasets: summary.expectedDatasets,
        availableIndicators: summary.availableIndicators,
        totalIndicators: summary.totalIndicators,
        cacheStatus: summary.cacheStatus,
        lastRefresh,
        lastRefreshError,
        databaseTime: db.rows[0].database_time,
        upstream: 'World Bank Indicators API v2'
      });
    } catch (error) {
      sendJSON(response, 503, {
        ok: false,
        service: 'HUMANITY Data API',
        database: 'disconnected',
        error: error.message
      });
    }
    return;
  }

  if (url.pathname === '/api/bootstrap') {
    try {
      let records = await readCache();
      const missingIndicators = !records.countries ||
        INDICATORS.some(indicator => !records['values_' + indicator.key]);
      const hasUsableData = Boolean(records.countries) &&
        INDICATORS.some(indicator => records['values_' + indicator.key] &&
          Object.keys(records['values_' + indicator.key].payload || {}).length > 0);

      if (!hasUsableData) {
        try {
          if (refreshPromise) await refreshPromise;
          else await refreshAll();
          records = await readCache();
        } catch (error) {
          console.error('Initial data refresh failed:', error.message);
          records = await readCache();
        }
      } else if ((missingIndicators || cacheIsStale(records)) && !refreshPromise) {
        refreshAll().catch(error =>
          console.error('Background refresh failed:', error.message)
        );
      }

      const result = buildBootstrap(records);
      const hasIndicatorData = result.meta.availableIndicators > 0;

      if (!result.data.countries.length || !hasIndicatorData) {
        sendJSON(response, 503, {
          ok: false,
          error: 'Global indicator data is not available yet. The data service is retrying the source.',
          meta: result.meta
        });
        return;
      }

      sendJSON(response, 200, {
        ok: true,
        service: 'HUMANITY Data API',
        data: result.data,
        meta: result.meta
      });
    } catch (error) {
      console.error('Bootstrap request failed:', error);
      sendJSON(response, 503, {
        ok: false,
        error: 'The data service is temporarily unavailable.',
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    return;
  }

  if (url.pathname === '/') {
    sendJSON(response, 200, {
      service: 'HUMANITY Data API',
      endpoints: ['/api/health', '/api/bootstrap']
    });
    return;
  }

  sendJSON(response, 404, { ok: false, error: 'Not found' });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    console.error('Unhandled request error:', error);
    if (!response.headersSent) {
      sendJSON(response, 500, { ok: false, error: 'Internal server error' });
    } else {
      response.end();
    }
  });
});

async function start() {
  await pool.query('SELECT 1');
  server.listen(PORT, '0.0.0.0', () => {
    console.log('HUMANITY Data API listening on port ' + PORT);
    refreshAll({ force: true }).catch(error => console.error('Startup refresh failed:', error.message));
    setInterval(() => {
      refreshAll({ force: true }).catch(error => console.error('Scheduled refresh failed:', error.message));
    }, REFRESH_INTERVAL_MS).unref();
  });
}

start().catch(error => {
  console.error('Could not start HUMANITY Data API:', error);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(signal + ' received. Shutting down.');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
