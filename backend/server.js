'use strict';

const http = require('node:http');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const API_BASE = 'https://api.worldbank.org/v2';
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
  { key: 'co2', code: 'EN.ATM.CO2E.PC' },
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
  connectionTimeoutMillis: 10000
});

let refreshPromise = null;
let lastRefresh = null;
let lastRefreshError = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRows(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
    const message = Array.isArray(payload) && payload[0] && payload[0].message
      ? payload[0].message[0] && payload[0].message[0].value
      : 'Unexpected World Bank API response';
    throw new Error(message || 'Unexpected World Bank API response');
  }
  return payload[1];
}

async function fetchWorldBank(path) {
  const url = API_BASE + path;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'HUMANITY-Global-Data-Platform/1.0'
        },
        signal: AbortSignal.timeout(25000)
      });

      if (!response.ok) {
        throw new Error('World Bank API returned HTTP ' + response.status);
      }

      const payload = await response.json();
      parseRows(payload);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(600 * attempt);
    }
  }

  throw lastError || new Error('World Bank API request failed');
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
    if (!output[code] || (year && year > (output[code].year || 0))) {
      output[code] = observation;
    }
  }
  return output;
}

function mapAllLatestValues(payload) {
  const keyByCode = Object.fromEntries(INDICATORS.map(item => [item.code, item.key]));
  const output = Object.fromEntries(INDICATORS.map(item => [item.key, {}]));

  for (const row of parseRows(payload)) {
    const indicatorCode = row.indicator && row.indicator.id;
    const key = keyByCode[indicatorCode];
    const countryCode = row.countryiso3code || (row.country && row.country.id);
    const value = toNumber(row.value);
    if (!key || !countryCode || value === null) continue;

    const year = Number(row.date);
    const observation = {
      value,
      year: Number.isFinite(year) ? year : null,
      footnote: row.obs_status || ''
    };

    if (!output[key][countryCode] ||
        (year && year > (output[key][countryCode].year || 0))) {
      output[key][countryCode] = observation;
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

function mapAllHistory(payload) {
  const keyByCode = Object.fromEntries(INDICATORS.map(item => [item.code, item.key]));
  const output = { population: [], life: [] };

  for (const row of parseRows(payload)) {
    const code = row.indicator && row.indicator.id;
    const key = keyByCode[code];
    if (key !== 'population' && key !== 'life') continue;

    const year = Number(row.date);
    const value = toNumber(row.value);
    if (!Number.isFinite(year) || value === null) continue;
    output[key].push({ year, value });
  }

  for (const key of Object.keys(output)) {
    output[key].sort((a, b) => a.year - b.year);
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

async function saveCache(key, payload) {
  const sql = 'INSERT INTO humanity_cache (cache_key, payload, fetched_at, source_url) ' +
    'VALUES ($1, $2::jsonb, NOW(), $3) ' +
    'ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, ' +
    'fetched_at = NOW(), source_url = EXCLUDED.source_url';
  await pool.query(sql, [key, JSON.stringify(payload), API_BASE]);
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

async function refreshAll() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const startedAt = new Date().toISOString();
    const codes = INDICATORS.map(item => item.code).join(';');
    const jobs = [
      fetchWorldBank('/country?format=json&per_page=400').then(async payload => {
        const countries = mapCountries(payload);
        if (!countries.length) throw new Error('World Bank returned no country records');
        await saveCache('countries', countries);
        return 'countries';
      }),
      fetchWorldBank(
        '/country/all/indicator/' + codes +
        '?format=json&mrnev=1&per_page=10000&source=2'
      ).then(async payload => {
        const grouped = mapAllLatestValues(payload);

        // Keep the multi-indicator request as the normal fast path. If a provider
        // omits one series, retry only that series rather than discarding the rest.
        for (const indicator of INDICATORS) {
          if (Object.keys(grouped[indicator.key]).length > 0) continue;
          try {
            const fallback = await fetchWorldBank(
              '/country/all/indicator/' + indicator.code +
              '?format=json&mrnev=1&per_page=2000&source=2'
            );
            grouped[indicator.key] = mapLatestValues(fallback);
          } catch (error) {
            console.warn('Indicator fallback failed for ' + indicator.key + ': ' + error.message);
          }
        }

        for (const indicator of INDICATORS) {
          const values = grouped[indicator.key] || {};
          await saveCache('values_' + indicator.key, values);
          if (!values.WLD && Object.keys(values).length > 0) {
            try {
              const worldPayload = await fetchWorldBank(
                '/country/WLD/indicator/' + indicator.code +
                '?format=json&mrnev=1&per_page=20&source=2'
              );
              const world = mapLatestValues(worldPayload).WLD;
              if (world) values.WLD = world;
              await saveCache('values_' + indicator.key, values);
            } catch (error) {
              console.warn('World aggregate fallback failed for ' + indicator.key + ': ' + error.message);
            }
          }
        }

        return 'indicators';
      }),
      fetchWorldBank(
        '/country/WLD/indicator/' + INDICATORS[0].code + ';' + INDICATORS[1].code +
        '?format=json&date=2000:2026&per_page=200&source=2'
      ).then(async payload => {
        const grouped = mapAllHistory(payload);

        for (const key of ['population', 'life']) {
          if (grouped[key].length > 0) continue;
          const indicator = INDICATORS.find(item => item.key === key);
          try {
            const fallback = await fetchWorldBank(
              '/country/WLD/indicator/' + indicator.code +
              '?format=json&date=2000:2026&per_page=100&source=2'
            );
            grouped[key] = mapHistory(fallback);
          } catch (error) {
            console.warn('History fallback failed for ' + key + ': ' + error.message);
          }
        }

        for (const key of ['population', 'life']) {
          await saveCache('history_' + key, grouped[key]);
        }
        return 'history';
      })
    ];

    const results = await Promise.allSettled(jobs);
    const successful = results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    const failed = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason && result.reason.message
        ? result.reason.message
        : 'Unknown upstream error');

    lastRefresh = new Date().toISOString();
    lastRefreshError = failed.length ? failed.join('; ').slice(0, 1000) : null;

    console.log(JSON.stringify({
      event: 'data_refresh',
      startedAt,
      finishedAt: lastRefresh,
      successful,
      failed
    }));

    if (!successful.includes('countries')) {
      throw new Error('Country metadata refresh failed: ' + (failed[0] || 'unknown error'));
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
    if (values[indicator.key] && values[indicator.key].WLD) {
      world[indicator.key] = values[indicator.key].WLD;
    }
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

  return {
    data: { countries, values, world, history },
    meta: {
      provider: 'World Bank Indicators API v2',
      cacheStatus: cacheIsStale(records) ? 'stale' : 'fresh',
      updatedAt,
      cachedDatasets: Object.keys(records).length,
      expectedDatasets: 9,
      lastRefresh,
      lastRefreshError
    }
  };
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (origin && (ALLOWED_ORIGINS.has(origin) || origin.startsWith('http://localhost:'))) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
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
      sendJSON(response, 200, {
        ok: true,
        service: 'HUMANITY Data API',
        database: 'connected',
        cachedDatasets: Object.keys(records).length,
        expectedDatasets: 9,
        updatedAt: lastRefresh,
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
      const missingCoreData = !records.countries ||
        !INDICATORS.some(indicator => records['values_' + indicator.key]);

      if (missingCoreData) {
        try {
          await refreshAll();
          records = await readCache();
        } catch (error) {
          console.error('Initial data load failed:', error.message);
        }
      } else if (cacheIsStale(records) && !refreshPromise) {
        refreshAll().catch(error => console.error('Background refresh failed:', error.message));
      }

      const result = buildBootstrap(records);
      if (!result.data.countries.length ||
          !Object.values(result.data.values).some(series => Object.keys(series || {}).length)) {
        sendJSON(response, 503, {
          ok: false,
          error: 'No cached data is available yet. The upstream data source could not be reached.',
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
    refreshAll().catch(error => console.error('Startup refresh failed:', error.message));
    setInterval(() => {
      refreshAll().catch(error => console.error('Scheduled refresh failed:', error.message));
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
