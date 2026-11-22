(() => {
  'use strict';
  const API = 'https://humanity-api-jyk5.onrender.com/api';
  const token = localStorage.getItem('humanity-session-token') || '';
  const $ = selector => document.querySelector(selector);
  const number = new Intl.NumberFormat('en-US');
  const rarityNames = ['Familiar', 'Known', 'Uncommon', 'Rare', 'Remarkable', 'Exceptional'];
  const rarityPoints = [10, 20, 40, 60, 80, 100];

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  async function api(path, options) {
    const settings = options || {};
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
    if (settings.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(API + path, {
      method: settings.method || 'GET',
      headers,
      body: settings.body ? JSON.stringify(settings.body) : undefined,
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showAccess(message) {
    $('#admin-access').hidden = false;
    $('#admin-dashboard').hidden = true;
    $('#admin-refresh').hidden = true;
    $('#admin-access-message').textContent = message;
  }

  async function loadDashboard() {
    const results = await Promise.all([api('/admin/overview'), api('/admin/review-queue')]);
    const stats = results[0].stats || {};
    $('#admin-stats').innerHTML = [
      ['PLAYERS', stats.players],
      ['DAILY EDITIONS', stats.dailyEditions],
      ['PENDING ANSWERS', stats.pendingAnswers],
      ['FINISHED MATCHES', stats.finishedMatches]
    ].map(entry => '<article class="admin-stat-card"><span>' + entry[0] +
      '</span><b>' + number.format(Number(entry[1] || 0)) + '</b></article>').join('');

    const entries = Array.isArray(results[1].entries) ? results[1].entries : [];
    $('#admin-queue-count').textContent = number.format(entries.length) + ' pending';
    $('#admin-queue').innerHTML = entries.length ? entries.map(item => {
      const source = item.source_url
        ? '<a class="admin-source-link" href="' + escapeHTML(item.source_url) + '" target="_blank" rel="noopener noreferrer">Open verification source ↗</a>'
        : '';
      const rarityOptions = rarityNames.map((name, index) =>
        '<option value="' + index + '">' + name + ' · ' + rarityPoints[index] + ' pts</option>'
      ).join('');
      return '<article class="admin-queue-item" data-review-row="' + Number(item.id) + '">' +
        '<div class="admin-queue-copy"><strong class="admin-queue-answer">' + escapeHTML(item.answer_text) +
        '<span class="admin-occurrences">×' + number.format(Number(item.occurrences || 1)) + ' suggestions</span></strong>' +
        '<span class="admin-queue-question">' + escapeHTML(item.question_prompt) + '</span>' + source +
        '<div class="admin-review-controls"><label>DISCOVERY RARITY<select data-review-rarity>' + rarityOptions +
        '</select></label><label>ALTERNATIVE NAMES / ALIASES<input data-review-aliases maxlength="240" ' +
        'placeholder="Comma-separated names, translations or local spellings"></label></div></div>' +
        '<div class="admin-queue-actions"><button class="approve" type="button" data-review-action="approve" data-review-id="' +
        Number(item.id) + '">Approve</button><button type="button" data-review-action="reject" data-review-id="' +
        Number(item.id) + '">Reject</button></div></article>';
    }).join('') : '<div class="admin-empty-state">The answer review queue is clear. New player suggestions will appear here.</div>';
  }

  async function bootstrap() {
    if (!token) {
      showAccess('Sign in to HUMANITY with an administrator account, then return to this page. Your account must be listed in the Render ADMIN_EMAILS setting.');
      return;
    }
    try {
      const session = await api('/auth/me');
      if (!session.player || session.player.isAdmin !== true) {
        showAccess('This account does not have administrator permissions. Access is granted only to accounts listed in the server ADMIN_EMAILS setting.');
        return;
      }
      $('#admin-username').textContent = session.player.username || 'Administrator';
      $('#admin-access').hidden = true;
      $('#admin-dashboard').hidden = false;
      $('#admin-refresh').hidden = false;
      await loadDashboard();
    } catch (error) {
      showAccess(error.status === 401
        ? 'Your sign-in session has expired. Sign in again with an administrator account.'
        : error.message);
    }
  }

  $('#admin-refresh').addEventListener('click', async () => {
    const button = $('#admin-refresh');
    button.disabled = true;
    try { await loadDashboard(); }
    catch (error) { $('#admin-queue').textContent = error.message; }
    finally { button.disabled = false; }
  });

  $('#admin-queue').addEventListener('click', async event => {
    const button = event.target.closest('[data-review-id]');
    if (!button) return;
    const row = button.closest('[data-review-row]');
    const rarity = row && row.querySelector('[data-review-rarity]');
    const aliases = row && row.querySelector('[data-review-aliases]');
    row.querySelectorAll('button').forEach(item => { item.disabled = true; });
    try {
      await api('/admin/review/' + encodeURIComponent(button.dataset.reviewId), {
        method: 'POST',
        body: {
          action: button.dataset.reviewAction,
          rarity: rarity ? Number(rarity.value) : 2,
          aliases: aliases ? aliases.value.split(',').map(value => value.trim()).filter(Boolean) : []
        }
      });
      await loadDashboard();
    } catch (error) {
      row.querySelectorAll('button').forEach(item => { item.disabled = false; });
      window.alert(error.message);
    }
  });

  bootstrap();
})();