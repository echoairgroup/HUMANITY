'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const SITE_URL = process.env.HUMANITY_SITE_URL || 'https://echoairgroup.github.io/HUMANITY/';
const API_ROOT = (process.env.HUMANITY_API_ROOT || 'https://humanity-api-jyk5.onrender.com/api').replace(/\/$/, '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForStableApi() {
  let previousUptime = null;
  let stableSince = Date.now();
  let stableIntervals = 0;

  for (let attempt = 1; attempt <= 42; attempt += 1) {
    try {
      const response = await fetch(API_ROOT + '/health', { cache: 'no-store' });
      assert.equal(response.status, 200, 'HUMANITY API health endpoint should return HTTP 200');
      const health = await response.json();
      assert.equal(health.ok, true);
      assert.equal(health.database, true, 'Neon should be connected while testing the browser UI');
      const uptime = Number(health.uptimeSeconds || 0);

      if (previousUptime !== null && uptime > previousUptime && uptime - previousUptime <= 12) {
        stableIntervals += 1;
      } else {
        stableIntervals = 0;
        stableSince = Date.now();
      }
      previousUptime = uptime;

      const stableFor = Date.now() - stableSince;
      console.log('API stability ' + attempt + '/42: uptime=' + uptime +
        's, stable=' + Math.floor(stableFor / 1000) + 's');
      if (uptime >= 20 && stableIntervals >= 5 && stableFor >= 30000) {
        console.log('PASS: API and Neon are stable for browser tests.');
        return;
      }
    } catch (error) {
      previousUptime = null;
      stableIntervals = 0;
      stableSince = Date.now();
      console.log('API is not ready yet: ' + error.message);
    }
    await sleep(5000);
  }
  throw new Error('The HUMANITY API did not become stable in time for browser checks.');
}

async function layoutMetrics(page, viewSelector) {
  return page.evaluate(selector => {
    const view = document.querySelector(selector);
    const footer = document.querySelector('.site-footer');
    const shell = document.querySelector('.site-shell');
    const lobby = document.querySelector('#party-lobby');
    const intro = document.querySelector('#view-party .party-intro');
    const rect = element => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        top: box.top + window.scrollY,
        bottom: box.bottom + window.scrollY,
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height
      };
    };
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      view: rect(view),
      footer: rect(footer),
      shell: rect(shell),
      lobby: rect(lobby),
      intro: rect(intro),
      footerLinks: Array.from(document.querySelectorAll('.footer-links a, .footer-links button'))
        .filter(element => element.getClientRects().length)
        .map(rect)
    };
  }, viewSelector);
}

async function checkLayout(page, view, width) {
  const metrics = await layoutMetrics(page, view);
  assert.ok(metrics.view && metrics.footer, view + ' and footer should both exist');
  assert.ok(
    metrics.documentWidth <= width + 1,
    view + ' should not create horizontal page overflow at ' + width + 'px (document=' + metrics.documentWidth + ')'
  );
  assert.ok(
    metrics.footer.top >= metrics.view.bottom - 1,
    view + ' must finish before the footer starts at ' + width + 'px'
  );
  if (view === '#view-party' && metrics.lobby) {
    assert.ok(
      metrics.footer.top >= metrics.lobby.bottom - 1,
      'Globe Rush lobby must not overlap the footer at ' + width + 'px'
    );
    if (metrics.intro) {
      assert.ok(
        metrics.lobby.top >= metrics.intro.bottom - 1,
        'Globe Rush intro and lobby must not overlap at ' + width + 'px'
      );
    }
  }
  for (const link of metrics.footerLinks) {
    assert.ok(link.left >= -1 && link.right <= width + 1,
      'Footer link should remain inside the viewport at ' + width + 'px');
  }
  console.log('PASS: ' + view + ' layout at ' + width + 'px — content width ' +
    metrics.documentWidth + 'px, footer top ' + Math.round(metrics.footer.top) + 'px.');
}

async function main() {
  await waitForStableApi();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    const response = await page.goto(SITE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    assert.ok(response && response.ok(), 'GitHub Pages homepage should return a successful response');
    await page.locator('.site-footer').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#daily-start').waitFor({ state: 'attached', timeout: 30000 });
    await sleep(1500);

    // Practice Lab must open from the normal Daily view, even before the Daily is completed.
    await page.locator('button[data-open-practice]:visible').first().click();
    await page.locator('#practice-modal[open]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#practice-modal [data-practice-pack]').first().waitFor({ state: 'visible', timeout: 20000 });
    const packs = await page.locator('#practice-modal [data-practice-pack]').count();
    assert.ok(packs >= 1, 'Practice Lab should load at least one playable pack');
    console.log('PASS: Practice Lab opens and loads ' + packs + ' playable question packs.');
    await page.locator('#practice-modal .modal-close').click();

    // The saved-session/account dialog must always offer a usable sign-in state in a fresh browser.
    await page.locator('#account-open').click();
    await page.locator('#account-modal[open]').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await page.locator('#account-signed-out').isVisible(), true,
      'A fresh visitor should see the sign-in/create-account panel');
    await page.locator('#account-modal .modal-close').click();

    // Globe Rush selectors are interactive and each mode remains selectable.
    await page.locator('[data-view="party"]').first().click();
    await page.locator('#view-party:not([hidden])').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#quick-variant').selectOption('team-rush');
    await page.locator('#quick-variant').selectOption('survival');
    await page.locator('#quick-variant').selectOption('classic');
    await page.locator('#quick-group').selectOption('large');
    console.log('PASS: Globe Rush lobby and Team Rush/Survival/large-queue selectors are interactive.');

    const widths = [320, 375, 430, 768, 1024, 1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 950 });
      await sleep(100);
      await checkLayout(page, '#view-party', width);
    }

    // Check the Daily page and its footer separately at the same responsive widths.
    await page.locator('[data-view="daily"]').first().click();
    await page.locator('#view-daily:not([hidden])').waitFor({ state: 'visible', timeout: 10000 });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 950 });
      await sleep(100);
      await checkLayout(page, '#view-daily', width);
    }

    assert.deepEqual(pageErrors, [], 'The page should not throw uncaught JavaScript errors.');
    console.log('PASS: No uncaught browser JavaScript errors.');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => {
  console.error('HUMANITY browser layout smoke test failed:', error);
  process.exitCode = 1;
});
