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
        .map(rect),
      lobbyPanels: [
        ['play panel', document.querySelector('#view-party .party-play-panel')],
        ['orbital scene', document.querySelector('#view-party .party-centre-scene')],
        ['open rooms', document.querySelector('#view-party .public-rooms-card')]
      ].filter(([, element]) => element && element.getClientRects().length)
        .map(([name, element]) => ({ name, ...rect(element) })),
      sidebarVisible: Boolean(document.querySelector('#view-party .party-sidebar') &&
        document.querySelector('#view-party .party-sidebar').getClientRects().length),
      lobbyMainDisplay: getComputedStyle(document.querySelector('#view-party .party-lobby-main')).display
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
    assert.equal(metrics.sidebarVisible, false,
      'The optional Globe Rush sidebar must stay hidden; the lobby has exactly three main panels.');
    assert.equal(metrics.lobbyMainDisplay, 'contents',
      'The play panel and open rooms must participate directly in the three-column lobby grid.');
    assert.ok(metrics.lobbyPanels.length >= 2,
      'Globe Rush must show its play panel and open-rooms panel at ' + width + 'px.');
    for (let i = 0; i < metrics.lobbyPanels.length; i += 1) {
      for (let j = i + 1; j < metrics.lobbyPanels.length; j += 1) {
        const a = metrics.lobbyPanels[i];
        const b = metrics.lobbyPanels[j];
        const horizontalOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const verticalOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        assert.ok(!(horizontalOverlap > 1 && verticalOverlap > 1),
          a.name + ' must not overlap ' + b.name + ' at ' + width + 'px.');
      }
    }
  }
  for (const link of metrics.footerLinks) {
    assert.ok(link.left >= -1 && link.right <= width + 1,
      'Footer link should remain inside the viewport at ' + width + 'px');
  }
  console.log('PASS: ' + view + ' layout at ' + width + 'px — content width ' +
    metrics.documentWidth + 'px, footer top ' + Math.round(metrics.footer.top) + 'px.');
}

async function checkPrivateRoomLayout(page, width, live) {
  await page.setViewportSize({ width, height: 950 });
  await sleep(120);
  const metrics = await page.evaluate(isLive => {
    const rect = element => {
      if (!element || !element.getClientRects().length) return null;
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
    const selectors = isLive
      ? [
          ['game header', '#room-game-state .rush-game-header'],
          ['category cycle', '#room-game-state .category-cycle'],
          ['orb stage', '#room-game-state .orb-stage'],
          ['answer area', '#room-game-state .rush-answer-area'],
          ['used answers and player list', '#room-game-state .rush-bottom-grid']
        ]
      : [
          ['world arena', '#room-lobby-state .planet-arena'],
          ['room console', '#room-lobby-state .planet-console']
        ];
    const consoleChildren = [
      ['room code card', '#room-lobby-state .planet-room-code-card'],
      ['crew card', '#room-lobby-state .planet-console > .planet-console-card:nth-child(2)'],
      ['mission settings', '#room-lobby-state .planet-rules-card'],
      ['start button', '#room-lobby-state .planet-start-button'],
      ['crew chat', '#room-lobby-state .planet-chat-card']
    ];
    return {
      documentWidth: document.documentElement.scrollWidth,
      room: rect(document.querySelector('#party-room')),
      layout: rect(document.querySelector(isLive ? '#room-game-state' : '#room-lobby-state')),
      panels: selectors.map(([name, selector]) => ({
        name,
        box: rect(document.querySelector(selector))
      })).filter(item => item.box),
      consoleChildren: isLive ? [] : consoleChildren.map(([name, selector]) => ({
        name,
        box: rect(document.querySelector(selector))
      })).filter(item => item.box)
    };
  }, live);

  assert.ok(metrics.room && metrics.layout, 'Globe Rush room state should be visible at ' + width + 'px.');
  assert.ok(metrics.documentWidth <= width + 1,
    'Globe Rush room must not create horizontal overflow at ' + width + 'px.');
  assert.ok(metrics.panels.length >= (live ? 4 : 2),
    'Globe Rush room should display its main panels at ' + width + 'px.');
  const assertNoOverlap = items => {
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        const horizontal = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
        const vertical = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
        assert.ok(!(horizontal > 1 && vertical > 1),
          a.name + ' overlaps ' + b.name + ' at ' + width + 'px.');
      }
    }
    for (const item of items) {
      assert.ok(item.box.left >= -1 && item.box.right <= width + 1,
        item.name + ' must stay inside the viewport at ' + width + 'px.');
    }
  };
  assertNoOverlap(metrics.panels);
  assertNoOverlap(metrics.consoleChildren);
  console.log('PASS: Globe Rush ' + (live ? 'live match' : 'room lobby') +
    ' has no panel overlap at ' + width + 'px.');
}

async function checkTwoPlayerRoomAndLiveGame(browser, hostPage, pageErrors) {
  let guestContext = null;
  let guestPage = null;
  const socketTrace = { host: [], guest: [] };
  const traceSockets = (page, label) => {
    page.on('websocket', socket => {
      socket.on('framereceived', data => {
        let message;
        try { message = JSON.parse(String(data)); } catch (_) { return; }
        socketTrace[label].push({
          direction: 'in',
          type: message.type,
          phase: message.phase,
          round: message.round,
          players: Array.isArray(message.players) ? message.players.length : undefined,
          countdown: message.autoStartInMs,
          startsInMs: message.startsInMs,
          code: message.code,
          message: message.message,
          errorCode: message.code && message.type === 'error' ? message.code : undefined
        });
        socketTrace[label] = socketTrace[label].slice(-40);
      });
      socket.on('framesent', data => {
        let message;
        try { message = JSON.parse(String(data)); } catch (_) { return; }
        socketTrace[label].push({ direction: 'out', type: message.type, code: message.code });
        socketTrace[label] = socketTrace[label].slice(-40);
      });
    });
  };
  traceSockets(hostPage, 'host');
  try {
    await hostPage.setViewportSize({ width: 1440, height: 950 });
    await hostPage.locator('#party-display-name').fill('LayoutHost');
    await hostPage.locator('#host-visibility').selectOption('private');
    await hostPage.locator('#create-room-form button[type="submit"]').click();
    await hostPage.locator('#party-room:not([hidden])').waitFor({ state: 'visible', timeout: 25000 });
    await hostPage.waitForFunction(() => {
      const code = document.querySelector('#room-code-display');
      return code && /^[A-Z2-9]{6}$/.test(code.textContent.trim());
    }, null, { timeout: 15000 });
    const code = await hostPage.locator('#room-code-display').textContent();

    guestContext = await browser.newContext({
      viewport: { width: 375, height: 900 },
      serviceWorkers: 'block'
    });
    guestPage = await guestContext.newPage();
    guestPage.on('pageerror', error => pageErrors.push('guest: ' + error.message));
    traceSockets(guestPage, 'guest');
    const response = await guestPage.goto(SITE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    assert.ok(response && response.ok(), 'The second browser should load HUMANITY.');
    await guestPage.locator('[data-view="party"]').first().click();
    await guestPage.locator('#view-party:not([hidden])').waitFor({ state: 'visible', timeout: 10000 });
    await guestPage.locator('#party-display-name').fill('LayoutGuest');
    await guestPage.locator('#join-code').fill(String(code).trim());
    await guestPage.locator('#join-room-form button[type="submit"]').click();
    await guestPage.locator('#party-room:not([hidden])').waitFor({ state: 'visible', timeout: 25000 });

    await hostPage.waitForFunction(() => {
      const button = document.querySelector('#room-start');
      return button && !button.disabled && !button.hidden;
    }, null, { timeout: 20000 });

    // Check the actual private-room console before starting the match.
    for (const width of [320, 375, 430, 768, 1024, 1440]) {
      await checkPrivateRoomLayout(hostPage, width, false);
    }

    await hostPage.setViewportSize({ width: 1440, height: 950 });
    await hostPage.locator('#room-start').click();
    try {
      await hostPage.locator('#room-game-state:not([hidden])').waitFor({ state: 'visible', timeout: 25000 });
      await guestPage.locator('#room-game-state:not([hidden])').waitFor({ state: 'visible', timeout: 25000 });
    } catch (error) {
      const hostSnapshot = await hostPage.evaluate(() => ({
        statusLabel: document.querySelector('#room-status-label')?.textContent,
        startHidden: document.querySelector('#room-start')?.hidden,
        startDisabled: document.querySelector('#room-start')?.disabled,
        lobbyHidden: document.querySelector('#room-lobby-state')?.hidden,
        gameHidden: document.querySelector('#room-game-state')?.hidden,
        launchStatus: document.querySelector('#room-status-note')?.textContent,
        toast: document.querySelector('#toast')?.textContent
      }));
      throw new Error('Globe Rush did not enter its live game state. Snapshot=' +
        JSON.stringify(hostSnapshot) + ' host socket=' + JSON.stringify(socketTrace.host.slice(-25)) +
        ' guest socket=' + JSON.stringify(socketTrace.guest.slice(-25)) +
        ' original=' + error.message);
    }

    // Check the real two-player game view too, not just the lobby/footer.
    for (const width of [320, 375, 430, 768, 1024, 1440]) {
      await checkPrivateRoomLayout(hostPage, width, true);
    }
    await guestPage.setViewportSize({ width: 375, height: 900 });
    await checkPrivateRoomLayout(guestPage, 375, true);
    console.log('PASS: A private two-player room can be created, joined and started.');
  } finally {
    if (guestPage) {
      try { await guestPage.locator('#leave-room').click({ timeout: 2500 }); } catch (_) {}
    }
    try { await hostPage.locator('#leave-room').click({ timeout: 2500 }); } catch (_) {}
    if (guestContext) await guestContext.close();
  }
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

    // Create a private room with a second browser and inspect both room and live-game layouts.
    await checkTwoPlayerRoomAndLiveGame(browser, page, pageErrors);

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
