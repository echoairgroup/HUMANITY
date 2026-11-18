'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../nation.js');

const country = {
  code: 'NLD',
  name: 'Netherlands',
  iso2: 'NL',
  region: 'Europe & Central Asia',
  income: 'High income',
  capital: 'Amsterdam'
};

const values = {
  population: { NLD: { value: 17900000, year: 2024 } },
  population_growth: { NLD: { value: 0.8, year: 2024 } },
  gdp: { NLD: { value: 67000, year: 2024 } },
  gdp_growth: { NLD: { value: 1.1, year: 2024 } },
  inflation: { NLD: { value: 3.2, year: 2024 } },
  unemployment: { NLD: { value: 3.8, year: 2024 } },
  life: { NLD: { value: 81.9, year: 2023 } },
  internet: { NLD: { value: 97.8, year: 2023 } },
  literacy: { NLD: { value: 99, year: 2021 } },
  renewables_share: { NLD: { value: 15.5, year: 2022 } }
};

test('campaign starts from supplied country observations and records their years', () => {
  const campaign = Engine.createCampaign(country, values, 2026);
  assert.equal(campaign.code, 'NLD');
  assert.equal(campaign.name, 'Netherlands');
  assert.equal(campaign.stats.population.value, 17900000);
  assert.equal(campaign.stats.gdp.value, 67000);
  assert.equal(campaign.stats.life.year, 2023);
  assert.equal(campaign.sourceYear, 2024);
  assert.equal(campaign.year, 2027);
  assert.equal(campaign.stats.internet.estimated, false);
  assert.equal(campaign.stats.water.estimated, true);
  assert.equal(Object.keys(campaign.stats).length, 26);
  assert.ok(Number.isFinite(campaign.debt));
});

test('year advancement applies policies, changes indicators and stores a history entry', () => {
  const campaign = Engine.createCampaign(country, values, 2026);
  const next = Engine.advanceYear(campaign, ['education', 'clean_energy'], 20, 0);
  assert.equal(next.turn, 1);
  assert.equal(next.year, 2028);
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].year, 2027);
  assert.ok(next.stats.population.value > campaign.stats.population.value);
  assert.ok(next.stats.literacy.value > campaign.stats.literacy.value);
  assert.ok(next.stats.renewables_share.value > campaign.stats.renewables_share.value);
  assert.ok(next.stats.co2.value < campaign.stats.co2.value);
  assert.ok(Number.isFinite(next.debt));
  assert.ok(Number.isFinite(next.treasury));
  assert.notEqual(next.stats.gdp_growth.value, campaign.stats.gdp_growth.value);
});

test('budget model clamps tax and permits no more than two programmes', () => {
  const campaign = Engine.createCampaign(country, values, 2026);
  const projection = Engine.budgetProjection(campaign, ['education', 'healthcare', 'clean_energy'], 99);
  assert.equal(projection.taxRate, 27);
  assert.equal(projection.policies.length, 2);
  assert.ok(projection.revenue > 0);
  const lowTax = Engine.budgetProjection(campaign, [], 0);
  assert.equal(lowTax.taxRate, 14);
});

test('progress starts at a neutral baseline and remains bounded after several years', () => {
  let campaign = Engine.createCampaign(country, values, 2026);
  assert.equal(Math.round(Engine.progress(campaign).total), 50);
  for (let year = 0; year < 12; year += 1) {
    campaign = Engine.advanceYear(campaign, year % 2 ? ['jobs_innovation', 'infrastructure'] : ['education', 'healthcare'], 20, year);
  }
  const result = Engine.progress(campaign);
  assert.ok(result.total >= 0 && result.total <= 100);
  assert.equal(campaign.history.length, 12);
  assert.equal(campaign.year, 2039);
  assert.ok(Object.values(result.scores).every(value => value >= 0 && value <= 100));
});

test('the Arcade tab, panel, script and offline shell are connected', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const arcade = fs.readFileSync(path.join(root, 'arcade.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(html, /data-arcade-tab="nation"/);
  assert.match(html, /data-arcade-panel="nation"/);
  assert.match(html, /src="\.\/nation\.js"/);
  assert.match(arcade, /'nation'/);
  assert.match(sw, /humanity-shell-v8/);
  assert.match(sw, /'\.\/nation\.js'/);
  assert.match(html, /How to play Nation Builder/);
  assert.match(html, /id="nation-objectives"/);
  assert.match(html, /id="nation-achievements"/);
  assert.match(html, /id="nation-export-save"/);
  assert.match(html, /id="nation-import-file"/);
  const nation = fs.readFileSync(path.join(root, 'nation.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(nation, /function renderObjectives/);
  assert.match(nation, /function updateAchievements/);
  assert.match(nation, /function exportCampaign/);
  assert.match(nation, /function importCampaignFile/);
  assert.match(nation, /campaign\.draftPolicyIds = Array\.from\(selectedPoliciesSet\)/);
  assert.match(app, /function initMotionControls/);
  assert.match(app, /scroll-progress-fill/);
  assert.match(styles, /\.back-to-top\.is-visible/);
  assert.match(styles, /\.nation-guide-steps/);
});
