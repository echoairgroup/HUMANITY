(function (root) {
  'use strict';

  const SAVE_KEY = 'humanity-nation-campaign-v1';
  const API_ROOT = 'https://humanity-api-jyk5.onrender.com/api';

  const POLICIES = [
    { id: 'education', name: 'Education & skills', group: 'People', cost: 1.25, growth: 0.08, literacy: 0.75, secondary_enrollment: 1.15, unemployment: -0.08, support: 1.2, note: 'Improve schools, teacher training and access to practical skills.' },
    { id: 'healthcare', name: 'Healthcare access', group: 'People', cost: 1.35, growth: 0.04, life: 0.16, infant_mortality: -0.65, under5_mortality: -0.8, support: 1.6, note: 'Strengthen primary care, prevention and regional health services.' },
    { id: 'infrastructure', name: 'Digital & transport links', group: 'Infrastructure', cost: 1.45, growth: 0.12, internet: 1.55, electricity_access: 0.8, mobile_subscriptions: 1.2, support: 0.4, note: 'Connect communities and make essential infrastructure more reliable.' },
    { id: 'clean_energy', name: 'Clean energy transition', group: 'Environment', cost: 1.2, growth: 0.05, renewables_share: 2.15, co2: -0.24, pm25: -0.18, support: 0.7, note: 'Modernise energy systems and reduce pollution over time.' },
    { id: 'jobs_innovation', name: 'Jobs & innovation', group: 'Economy', cost: 1.15, growth: 0.24, unemployment: -0.38, internet: 0.25, support: 0.8, note: 'Support small businesses, research and productive employment.' },
    { id: 'water_sanitation', name: 'Clean water & sanitation', group: 'Infrastructure', cost: 0.95, growth: 0.03, water: 2.1, life: 0.055, infant_mortality: -0.3, support: 1.0, note: 'Expand safe water services and modern sanitation systems.' },
    { id: 'housing', name: 'Housing & living costs', group: 'People', cost: 1.05, growth: 0.05, inflation: -0.16, life: 0.025, support: 1.1, note: 'Improve housing availability and ease pressure on household budgets.' }
  ];

  const EVENTS = [
    { title: 'Stronger export demand', text: 'Demand for the country’s products and services rises in this simulated year.', growth: 0.35, inflation: 0.02, unemployment: -0.12 },
    { title: 'Global supply delays', text: 'Longer delivery times put pressure on businesses and prices.', growth: -0.3, inflation: 0.48, unemployment: 0.12 },
    { title: 'Favourable harvest', text: 'A good agricultural season eases food-price pressure in this scenario.', growth: 0.12, inflation: -0.24, unemployment: -0.04 },
    { title: 'Energy price pressure', text: 'Higher energy costs make production and transport more expensive.', growth: -0.18, inflation: 0.58, unemployment: 0.08 },
    { title: 'Technology spillover', text: 'New tools spread through businesses and public services.', growth: 0.24, inflation: -0.04, unemployment: -0.08, internet: 0.4 },
    { title: 'Public-health innovation', text: 'A new prevention approach improves health outcomes in this scenario.', growth: 0.08, inflation: 0, life: 0.06, infant_mortality: -0.22 },
    { title: 'Severe weather disruption', text: 'Extreme weather disrupts transport and supply chains this simulated year.', growth: -0.25, inflation: 0.3, unemployment: 0.12 },
    { title: 'Regional tourism boost', text: 'More visitors support local services and employment.', growth: 0.2, inflation: 0.08, unemployment: -0.16 }
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeStat(record, fallback) {
    if (record && record.value !== null && record.value !== undefined && Number.isFinite(Number(record.value))) {
      return { value: Number(record.value), year: Number(record.year) || null, estimated: false, simulated: false };
    }
    return { value: fallback, year: null, estimated: true, simulated: false };
  }

  function incomeFallback(income) {
    const value = String(income || '').toLowerCase();
    if (value.includes('high')) return 28000;
    if (value.includes('upper')) return 11000;
    if (value.includes('lower')) return 3500;
    if (value.includes('low')) return 1100;
    return 6500;
  }

  function createCampaign(country, values, startYear) {
    const data = values || {};
    const code = String(country.code || '').toUpperCase();
    const get = function (key, fallback) {
      return makeStat(data[key] && data[key][code], fallback);
    };
    const stats = {
      population: get('population', 500000),
      population_growth: get('population_growth', 1.0),
      gdp: get('gdp', incomeFallback(country.income)),
      gdp_growth: get('gdp_growth', 2.2),
      inflation: get('inflation', 3.0),
      unemployment: get('unemployment', 7.0),
      life: get('life', 70),
      internet: get('internet', 50),
      literacy: get('literacy', 82),
      secondary_enrollment: get('secondary_enrollment', 75),
      electricity_access: get('electricity_access', 85),
      renewables_share: get('renewables_share', 18),
      co2: get('co2', 3.2),
      water: get('water', 85),
      infant_mortality: get('infant_mortality', 18),
      under5_mortality: get('under5_mortality', 25),
      pm25: get('pm25', 18)
    };
    const sourceYears = Object.values(stats).map(item => item.year).filter(Number.isFinite);
    const year = Number(startYear) || new Date().getFullYear();
    const gdpTotal = stats.population.value * stats.gdp.value;
    return {
      version: 1,
      code: code,
      name: country.name,
      iso2: country.iso2 || '',
      region: country.region || 'Not classified',
      income: country.income || 'Not classified',
      capital: country.capital || '',
      startYear: year,
      sourceYear: sourceYears.length ? Math.max.apply(null, sourceYears) : null,
      year: year + 1,
      turn: 0,
      taxRate: 20,
      treasury: gdpTotal * 0.025,
      debt: gdpTotal * 0.48,
      support: 60,
      stats: stats,
      baseline: copy(stats),
      history: [],
      lastResult: null,
      createdAt: Date.now()
    };
  }

  function currentGDP(campaign) {
    return Math.max(1, campaign.stats.population.value * campaign.stats.gdp.value);
  }

  function selectedPolicies(ids) {
    const wanted = Array.isArray(ids) ? ids : [];
    return wanted.slice(0, 2).map(id => POLICIES.find(policy => policy.id === id)).filter(Boolean);
  }

  function budgetProjection(campaign, ids, taxRate) {
    const gdp = currentGDP(campaign);
    const rate = clamp(Number(taxRate) || campaign.taxRate || 20, 14, 27);
    const policies = selectedPolicies(ids);
    const revenue = gdp * rate / 100;
    const services = gdp * 0.18;
    const interest = Math.max(0, campaign.debt) * 0.035;
    const programmes = policies.reduce((sum, policy) => sum + gdp * policy.cost / 100, 0);
    const balance = revenue - services - interest - programmes;
    return {
      gdp: gdp,
      taxRate: rate,
      revenue: revenue,
      services: services,
      interest: interest,
      programmes: programmes,
      balance: balance,
      available: campaign.treasury + balance,
      policies: policies
    };
  }

  function updateStat(stats, key, change, year, minimum, maximum) {
    if (!stats[key]) return;
    const nextValue = clamp(stats[key].value + change, minimum === undefined ? -Infinity : minimum, maximum === undefined ? Infinity : maximum);
    stats[key] = { value: nextValue, year: year, estimated: stats[key].estimated, simulated: true };
  }

  function progress(campaign) {
    const now = campaign.stats;
    const before = campaign.baseline;
    const ratio = function (key, multiplier) {
      const base = Math.max(0.01, before[key].value);
      return clamp(50 + ((now[key].value / base) - 1) * multiplier, 0, 100);
    };
    const delta = function (key, multiplier) {
      return clamp(50 + (now[key].value - before[key].value) * multiplier, 0, 100);
    };
    const scores = {
      economy: ratio('gdp', 65),
      health: delta('life', 7),
      education: delta('literacy', 1.35),
      connectivity: delta('internet', 1.25),
      environment: delta('renewables_share', 1.35)
    };
    const total = Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length;
    return { scores: scores, total: total };
  }

  function advanceYear(campaign, policyIds, taxRate, eventIndex) {
    const next = copy(campaign);
    const policies = selectedPolicies(policyIds);
    const projection = budgetProjection(next, policies.map(policy => policy.id), taxRate);
    const event = Number.isInteger(eventIndex)
      ? EVENTS[((eventIndex % EVENTS.length) + EVENTS.length) % EVENTS.length]
      : EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const oldGDP = projection.gdp;
    const year = next.year;
    let cash = next.treasury + projection.balance;
    if (cash >= 0) {
      const cashCap = oldGDP * 0.2;
      const excess = Math.max(0, cash - cashCap);
      next.treasury = Math.min(cash, cashCap);
      next.debt = Math.max(0, next.debt - excess);
    } else {
      next.treasury = 0;
      next.debt += Math.abs(cash);
    }

    const policyGrowth = policies.reduce((sum, policy) => sum + (policy.growth || 0), 0);
    const taxGrowth = -(projection.taxRate - 20) * 0.11;
    const growth = clamp(next.stats.gdp_growth.value + policyGrowth + taxGrowth + event.growth, -8, 10);
    const populationGrowth = clamp(next.stats.population_growth.value, -3, 5);
    const population = next.stats.population.value * (1 + populationGrowth / 100);
    const gdpPerPerson = next.stats.gdp.value * (1 + (growth - populationGrowth) / 100);

    next.stats.population = { value: population, year: year, estimated: next.stats.population.estimated, simulated: true };
    next.stats.gdp = { value: Math.max(100, gdpPerPerson), year: year, estimated: next.stats.gdp.estimated, simulated: true };
    next.stats.gdp_growth = { value: growth, year: year, estimated: next.stats.gdp_growth.estimated, simulated: true };

    const sumEffect = function (key) {
      return policies.reduce((sum, policy) => sum + (Number(policy[key]) || 0), 0);
    };
    updateStat(next.stats, 'inflation', event.inflation + (projection.taxRate - 20) * 0.025 + sumEffect('inflation'), year, -2, 60);
    updateStat(next.stats, 'unemployment', (event.unemployment || 0) - (growth - 2) * 0.025 + sumEffect('unemployment'), year, 0, 45);
    updateStat(next.stats, 'life', 0.035 + sumEffect('life') + (event.life || 0), year, 35, 90);
    updateStat(next.stats, 'internet', (event.internet || 0) + sumEffect('internet'), year, 0, 100);
    updateStat(next.stats, 'literacy', sumEffect('literacy'), year, 0, 100);
    updateStat(next.stats, 'secondary_enrollment', sumEffect('secondary_enrollment'), year, 0, 120);
    updateStat(next.stats, 'electricity_access', sumEffect('electricity_access'), year, 0, 100);
    updateStat(next.stats, 'renewables_share', sumEffect('renewables_share'), year, 0, 100);
    updateStat(next.stats, 'co2', sumEffect('co2'), year, 0, 100);
    updateStat(next.stats, 'water', sumEffect('water'), year, 0, 100);
    updateStat(next.stats, 'infant_mortality', (event.infant_mortality || 0) + sumEffect('infant_mortality'), year, 0, 250);
    updateStat(next.stats, 'under5_mortality', sumEffect('under5_mortality'), year, 0, 300);
    updateStat(next.stats, 'pm25', sumEffect('pm25'), year, 0, 500);
    next.support = clamp(next.support - (projection.taxRate - 20) * 0.55 + sumEffect('support'), 0, 100);
    next.taxRate = projection.taxRate;
    next.lastResult = {
      year: year,
      event: event.title,
      eventText: event.text,
      growth: growth,
      taxRate: projection.taxRate,
      revenue: projection.revenue,
      services: projection.services,
      interest: projection.interest,
      programmes: projection.programmes,
      balance: projection.balance,
      policies: policies.map(policy => policy.name)
    };
    next.history.push({
      year: year,
      event: event.title,
      policies: policies.map(policy => policy.name),
      growth: growth,
      balance: projection.balance
    });
    if (next.history.length > 20) next.history.shift();
    next.turn += 1;
    next.year = year + 1;
    return next;
  }

  const Engine = {
    policies: POLICIES,
    events: EVENTS,
    createCampaign: createCampaign,
    currentGDP: currentGDP,
    budgetProjection: budgetProjection,
    advanceYear: advanceYear,
    progress: progress
  };

  root.HUMANITYNationEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  if (typeof document === 'undefined') return;

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const shortMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
  let dataset = null;
  let campaign = null;
  let selectedPoliciesSet = new Set();
  let selectedTax = 20;
  let dataLoading = false;

  function flag(iso2) {
    const code = String(iso2 || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '🌐';
    return String.fromCodePoint.apply(null, Array.from(code).map(char => 127397 + char.charCodeAt(0)));
  }

  function formatValue(key, item) {
    if (!item) return '—';
    const value = item.value;
    if (key === 'population') return compact.format(Math.round(value));
    if (key === 'gdp') return money.format(value);
    if (key === 'life') return number.format(value) + ' yrs';
    if (key === 'inflation' || key === 'unemployment' || key === 'gdp_growth' || key === 'population_growth' || key === 'internet' || key === 'literacy' || key === 'electricity_access' || key === 'renewables_share') return number.format(value) + '%';
    if (key === 'co2') return number.format(value) + ' t';
    return number.format(value);
  }

  function statSource(item) {
    if (item.simulated) return 'SIMULATED ' + item.year;
    if (item.estimated) return 'GAME ESTIMATE';
    return 'SOURCE ' + (item.year || 'YEAR N/A');
  }

  function readSaved() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      return saved && saved.campaign && saved.campaign.version === 1 ? saved.campaign : null;
    } catch (_) {
      return null;
    }
  }

  function saveCurrent() {
    if (!campaign) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ campaign: campaign, savedAt: Date.now() }));
      const status = $('#nation-save-status');
      if (status) status.textContent = 'Saved on this browser';
    } catch (_) {
      const status = $('#nation-save-status');
      if (status) status.textContent = 'Browser storage unavailable';
    }
  }

  async function loadDataset() {
    if (dataset || dataLoading) return dataset;
    dataLoading = true;
    const status = $('#nation-data-status');
    if (status) status.textContent = 'Loading country indicators…';
    let cached = null;
    try {
      const local = localStorage.getItem('humanity-bootstrap-cache');
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed && parsed.payload && parsed.payload.ok) cached = parsed.payload;
      }
    } catch (_) { /* Storage may be unavailable. */ }
    try {
      const response = await fetch(API_ROOT + '/bootstrap', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (!payload.ok || !payload.data || !Array.isArray(payload.data.countries)) throw new Error('Incomplete country data');
      dataset = payload.data;
      try { localStorage.setItem('humanity-bootstrap-cache', JSON.stringify({ savedAt: Date.now(), payload: payload })); } catch (_) {}
    } catch (error) {
      if (cached && cached.data && Array.isArray(cached.data.countries)) dataset = cached.data;
      else {
        if (status) status.textContent = 'Country data could not be reached. Please try again.';
        const retry = $('#nation-retry-data');
        if (retry) retry.hidden = false;
        dataLoading = false;
        return null;
      }
    }
    dataLoading = false;
    populateCountries();
    if (status) status.textContent = 'Country data ready · World Bank and partner datasets';
    return dataset;
  }

  function populateCountries() {
    const select = $('#nation-country-select');
    if (!select || !dataset) return;
    const countries = dataset.countries.filter(country => country && country.code && country.name)
      .slice().sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = '<option value="">Choose a country…</option>' + countries.map(country =>
      '<option value="' + esc(country.code) + '">' + esc(flag(country.iso2) + '  ' + country.name) + '</option>'
    ).join('');
    const saved = readSaved();
    const startButton = $('#nation-start');
    if (startButton) startButton.disabled = false;
    if (saved) {
      const resume = $('#nation-continue');
      if (resume) {
        resume.hidden = false;
        resume.textContent = 'Continue as ' + saved.name + ' · Year ' + (saved.turn + 1);
      }
      const saveInfo = $('#nation-existing-save');
      if (saveInfo) saveInfo.textContent = saved.name + ' · ' + saved.region + ' · Year ' + (saved.turn + 1);
    } else {
      const resume = $('#nation-continue');
      if (resume) resume.hidden = true;
    }
    updateStartPreview();
  }

  function getCountry(code) {
    return dataset && dataset.countries.find(country => country.code === code);
  }

  function rawStat(countryCode, key) {
    const item = dataset && dataset.values && dataset.values[key] && dataset.values[key][countryCode];
    return item && item.value !== null && item.value !== undefined ? item : null;
  }

  function previewValue(country, key, fallback) {
    const item = rawStat(country.code, key);
    return item ? formatValue(key, { value: Number(item.value) }) + ' · ' + item.year : formatValue(key, { value: fallback }) + ' · game estimate';
  }

  function updateStartPreview() {
    const preview = $('#nation-start-preview');
    const select = $('#nation-country-select');
    if (!preview || !select || !dataset) return;
    const country = getCountry(select.value);
    if (!country) {
      preview.innerHTML = '<div class="nation-preview-empty">Choose a country to see its starting snapshot.</div>';
      return;
    }
    const fallbacks = { population: 500000, gdp: incomeFallback(country.income), life: 70, gdp_growth: 2.2, inflation: 3, internet: 50 };
    const entries = [
      ['Population', previewValue(country, 'population', fallbacks.population)],
      ['GDP per person', previewValue(country, 'gdp', fallbacks.gdp)],
      ['Life expectancy', previewValue(country, 'life', fallbacks.life)],
      ['GDP growth', previewValue(country, 'gdp_growth', fallbacks.gdp_growth)],
      ['Inflation', previewValue(country, 'inflation', fallbacks.inflation)],
      ['Internet access', previewValue(country, 'internet', fallbacks.internet)]
    ];
    preview.innerHTML = '<div class="nation-preview-country"><span>' + flag(country.iso2) + '</span><div><strong>' + esc(country.name) + '</strong><small>' + esc(country.region || 'Not classified') + ' · ' + esc(country.income || 'Income group unavailable') + '</small></div></div>' +
      '<div class="nation-preview-grid">' + entries.map(entry => '<div><small>' + esc(entry[0]) + '</small><strong>' + esc(entry[1]) + '</strong></div>').join('') + '</div>';
  }

  function showStart() {
    const start = $('#nation-start-screen');
    const game = $('#nation-game-screen');
    if (start) start.hidden = false;
    if (game) game.hidden = true;
  }

  function showGame() {
    const start = $('#nation-start-screen');
    const game = $('#nation-game-screen');
    if (start) start.hidden = true;
    if (game) game.hidden = false;
  }

  function renderKpis() {
    const target = $('#nation-kpi-grid');
    if (!target || !campaign) return;
    const entries = [
      ['POPULATION', 'population', 'People living in the country'],
      ['GDP / PERSON', 'gdp', 'Current US dollars per person'],
      ['GDP GROWTH', 'gdp_growth', 'Annual change in total output'],
      ['INFLATION', 'inflation', 'Annual consumer-price change'],
      ['UNEMPLOYMENT', 'unemployment', 'Share of the labour force']
    ];
    target.innerHTML = entries.map(entry => {
      const item = campaign.stats[entry[1]];
      return '<article class="nation-kpi"><small>' + entry[0] + '</small><strong>' + formatValue(entry[1], item) + '</strong><span>' + statSource(item) + '</span></article>';
    }).join('');
  }

  function renderIndicators() {
    const target = $('#nation-indicator-grid');
    if (!target || !campaign) return;
    const entries = [
      ['Life expectancy', 'life'], ['Internet access', 'internet'], ['Literacy', 'literacy'],
      ['Electricity access', 'electricity_access'], ['Renewable energy', 'renewables_share'], ['CO₂ per person', 'co2'],
      ['Safe water coverage', 'water'], ['Infant mortality / 1,000', 'infant_mortality']
    ];
    target.innerHTML = entries.map(entry => {
      const item = campaign.stats[entry[1]];
      return '<div class="nation-indicator"><span>' + esc(entry[0]) + '</span><strong>' + formatValue(entry[1], item) + '</strong><small>' + statSource(item) + '</small></div>';
    }).join('');
  }

  function renderSignals() {
    const target = $('#nation-signal-grid');
    if (!target || !campaign) return;
    const model = Engine.progress(campaign);
    const labels = [
      ['economy', 'Economic progress'], ['health', 'Health'], ['education', 'Education'],
      ['connectivity', 'Connectivity'], ['environment', 'Environment']
    ];
    target.innerHTML = labels.map(entry => {
      const value = model.scores[entry[0]];
      return '<div class="nation-signal"><div><span>' + entry[1] + '</span><strong>' + Math.round(value) + '</strong></div><div class="nation-signal-track"><i style="width:' + value + '%"></i></div></div>';
    }).join('');
    const total = $('#nation-progress-score');
    if (total) total.textContent = Math.round(model.total) + ' / 100';
    const decade = $('#nation-decade-progress');
    if (decade) decade.style.width = Math.min(100, campaign.turn / 10 * 100) + '%';
    const decadeLabel = $('#nation-decade-label');
    if (decadeLabel) decadeLabel.textContent = campaign.turn + ' of 10 years completed';
  }

  function renderPolicyDesk() {
    const target = $('#nation-policy-list');
    if (!target || !campaign) return;
    target.innerHTML = Engine.policies.map(policy => {
      const checked = selectedPoliciesSet.has(policy.id);
      return '<label class="nation-policy' + (checked ? ' is-selected' : '') + '"><input type="checkbox" data-nation-policy="' + policy.id + '"' + (checked ? ' checked' : '') + '><span class="nation-policy-copy"><strong>' + esc(policy.name) + '</strong><small>' + esc(policy.note) + '</small></span><span class="nation-policy-cost">' + policy.cost.toFixed(2) + '%<small>of GDP</small></span></label>';
    }).join('');
    target.querySelectorAll('[data-nation-policy]').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.getAttribute('data-nation-policy');
        if (input.checked && selectedPoliciesSet.size >= 2) {
          input.checked = false;
          const note = $('#nation-action-note');
          if (note) note.textContent = 'Choose up to two priorities each year. Remove one to choose another.';
          return;
        }
        if (input.checked) selectedPoliciesSet.add(id);
        else selectedPoliciesSet.delete(id);
        target.querySelectorAll('[data-nation-policy]').forEach(box => {
          const policy = Engine.policies.find(item => item.id === box.getAttribute('data-nation-policy'));
          box.closest('.nation-policy').classList.toggle('is-selected', box.checked);
          box.disabled = !box.checked && selectedPoliciesSet.size >= 2;
          if (policy) box.closest('.nation-policy').classList.toggle('is-disabled', box.disabled);
        });
        const count = $('#nation-policy-count');
        if (count) count.textContent = selectedPoliciesSet.size + ' / 2 selected';
        updateBudget();
      });
    });
    const count = $('#nation-policy-count');
    if (count) count.textContent = selectedPoliciesSet.size + ' / 2 selected';
    target.querySelectorAll('[data-nation-policy]').forEach(box => {
      box.disabled = !box.checked && selectedPoliciesSet.size >= 2;
      box.closest('.nation-policy').classList.toggle('is-disabled', box.disabled);
    });
  }

  function renderBudget(projection) {
    const target = $('#nation-budget-ledger');
    if (!target) return;
    const rows = [
      ['Tax revenue', projection.revenue, 'positive'],
      ['Essential public services', -projection.services, ''],
      ['Debt interest', -projection.interest, ''],
      ['Selected programmes', -projection.programmes, '']
    ];
    target.innerHTML = rows.map(row => '<div class="nation-ledger-row"><span>' + row[0] + '</span><strong class="' + row[2] + '">' + (row[1] < 0 ? '−' : '+') + shortMoney.format(Math.abs(row[1])) + '</strong></div>').join('') +
      '<div class="nation-ledger-total"><span>Projected yearly balance</span><strong class="' + (projection.balance >= 0 ? 'positive' : 'negative') + '">' + (projection.balance >= 0 ? '+' : '−') + shortMoney.format(Math.abs(projection.balance)) + '</strong></div>' +
      '<div class="nation-ledger-foot">Game fiscal model · not published government accounts</div>';
    const cash = $('#nation-cash-position');
    if (cash) cash.textContent = shortMoney.format(campaign.treasury);
    const debt = $('#nation-debt-position');
    if (debt) debt.textContent = shortMoney.format(campaign.debt);
    const ratio = $('#nation-debt-ratio');
    if (ratio) ratio.textContent = number.format(campaign.debt / Math.max(1, projection.gdp) * 100) + '% of simulated GDP';
    const action = $('#nation-end-year');
    if (action) action.disabled = false;
    const available = $('#nation-budget-outcome');
    if (available) {
      available.textContent = projection.available >= 0
        ? 'Cash after this year: ' + shortMoney.format(projection.available)
        : 'Funding gap: ' + shortMoney.format(Math.abs(projection.available)) + ' · added to simulated debt';
      available.classList.toggle('is-negative', projection.available < 0);
    }
  }

  function updateBudget() {
    if (!campaign) return;
    const slider = $('#nation-tax-rate');
    const label = $('#nation-tax-label');
    if (slider) selectedTax = Number(slider.value);
    if (label) label.textContent = selectedTax + '%';
    const projection = Engine.budgetProjection(campaign, Array.from(selectedPoliciesSet), selectedTax);
    renderBudget(projection);
  }

  function renderResult() {
    const target = $('#nation-latest-briefing');
    if (!target || !campaign) return;
    const result = campaign.lastResult;
    if (!result) {
      target.innerHTML = '<div class="nation-briefing-empty"><span>✳</span><div><strong>Your first year is ready.</strong><p>Set two national priorities, review the budget, then advance the year to see what happens.</p></div></div>';
      return;
    }
    const status = result.balance >= 0 ? 'budget surplus' : 'budget deficit';
    target.innerHTML = '<div class="nation-briefing-head"><span class="nation-event-mark">✳</span><div><small>SIMULATION BRIEFING · ' + result.year + '</small><h4>' + esc(result.event) + '</h4></div></div>' +
      '<p>' + esc((Engine.events.find(event => event.title === result.event) || {}).text || 'A simulated global development shaped this year.') + '</p>' +
      '<div class="nation-briefing-stats"><span>GDP growth <strong>' + number.format(result.growth) + '%</strong></span><span>' + status + ' <strong>' + (result.balance >= 0 ? '+' : '−') + shortMoney.format(Math.abs(result.balance)) + '</strong></span></div>' +
      '<small class="nation-simulation-note">This is a fictional scenario generated by the game, not a live news report.</small>';
  }

  function renderHistory() {
    const target = $('#nation-history');
    if (!target || !campaign) return;
    if (!campaign.history.length) {
      target.innerHTML = '<p class="nation-history-empty">Your first year has not been completed yet.</p>';
      return;
    }
    target.innerHTML = campaign.history.slice().reverse().slice(0, 6).map(item =>
      '<div class="nation-history-row"><span class="nation-history-year">' + item.year + '</span><div><strong>' + esc(item.event) + '</strong><small>' + (item.policies.length ? esc(item.policies.join(' · ')) : 'No new programmes selected') + '</small></div><b>' + (item.growth >= 0 ? '+' : '') + number.format(item.growth) + '%</b></div>'
    ).join('');
  }

  function renderGame() {
    if (!campaign) return;
    showGame();
    $('#nation-country-name').textContent = campaign.name;
    $('#nation-country-flag').textContent = flag(campaign.iso2);
    $('#nation-country-context').textContent = campaign.region + ' · ' + campaign.income;
    $('#nation-current-year').textContent = String(campaign.year);
    $('#nation-turn-number').textContent = 'YEAR ' + (campaign.turn + 1);
    $('#nation-save-status').textContent = 'Saved on this browser';
    $('#nation-tax-rate').value = String(campaign.taxRate);
    selectedTax = campaign.taxRate;
    renderKpis();
    renderIndicators();
    renderSignals();
    renderPolicyDesk();
    renderBudget(Engine.budgetProjection(campaign, Array.from(selectedPoliciesSet), selectedTax));
    renderResult();
    renderHistory();
    $('#nation-source-summary').textContent = campaign.sourceYear
      ? 'Starting snapshot includes published observations through ' + campaign.sourceYear + '. Indicator years differ by country and measure.'
      : 'Published observations were unavailable for this country; clearly marked game estimates are used for missing starting values.';
    $('#nation-decade-complete').hidden = campaign.turn < 10;
    $('#nation-action-note').textContent = selectedPoliciesSet.size + ' of 2 national priorities selected.';
  }

  function beginCampaign() {
    const select = $('#nation-country-select');
    const country = select && getCountry(select.value);
    if (!country || !dataset) return;
    campaign = Engine.createCampaign(country, dataset.values || {}, new Date().getFullYear());
    selectedPoliciesSet = new Set();
    selectedTax = 20;
    saveCurrent();
    renderGame();
  }

  function continueCampaign() {
    const saved = readSaved();
    if (!saved) return;
    campaign = saved;
    selectedPoliciesSet = new Set();
    selectedTax = campaign.taxRate || 20;
    renderGame();
  }

  function advance() {
    if (!campaign) return;
    campaign = Engine.advanceYear(campaign, Array.from(selectedPoliciesSet), selectedTax);
    selectedPoliciesSet = new Set();
    saveCurrent();
    renderGame();
    const note = $('#nation-action-note');
    if (note) note.textContent = 'Year completed. Review the briefing and choose the next two priorities.';
  }

  function init() {
    const tab = document.querySelector('[data-arcade-tab="nation"]');
    if (tab) tab.addEventListener('click', () => { loadDataset(); });
    const select = $('#nation-country-select');
    if (select) select.addEventListener('change', updateStartPreview);
    const start = $('#nation-start');
    if (start) start.addEventListener('click', beginCampaign);
    const resume = $('#nation-continue');
    if (resume) resume.addEventListener('click', continueCampaign);
    const retry = $('#nation-retry-data');
    if (retry) retry.addEventListener('click', () => { dataset = null; dataLoading = false; loadDataset(); });
    const slider = $('#nation-tax-rate');
    if (slider) slider.addEventListener('input', updateBudget);
    const advanceButton = $('#nation-end-year');
    if (advanceButton) advanceButton.addEventListener('click', advance);
    const changeCountry = $('#nation-change-country');
    if (changeCountry) changeCountry.addEventListener('click', showStart);
    const newNation = $('#nation-new-campaign');
    if (newNation) newNation.addEventListener('click', () => {
      if (confirm('Start a new country campaign? Your current saved campaign will be replaced when you begin the new one.')) showStart();
    });
    const refresh = $('#nation-save-now');
    if (refresh) refresh.addEventListener('click', saveCurrent);
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
