(() => {
  'use strict';

  const API = 'https://humanity-api-jyk5.onrender.com/api';
  const token = localStorage.getItem('humanity-session-token') || '';
  const $ = selector => document.querySelector(selector);
  const number = new Intl.NumberFormat('en-US');
  const AVATARS = [
    ['mercury','Mercury'],['venus','Venus'],['earth','Earth'],['mars','Mars'],
    ['jupiter','Jupiter'],['saturn','Saturn'],['uranus','Uranus'],['neptune','Neptune']
  ];
  const RARITIES = ['Familiar','Known','Uncommon','Rare','Remarkable','Exceptional'];
  const RARITY_POINTS = [10,20,40,60,80,100];
  const state = {
    actor: null, actorRole: 'member', tab: 'overview',
    query: '', roleFilter: '', statusFilter: '', offset: 0, limit: 15, total: 0,
    selectedId: null, selectedDetails: null, toastTimer: null, searchTimer: null,
    busy: false, analyticsRange: '30d', analyticsData: null, analyticsTimer: null
  };

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[character]));
  }

  async function api(path, options = {}) {
    const headers = { Accept:'application/json', Authorization:'Bearer ' + token };
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(API + path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache:'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function toast(message) {
    const el = $('#admin-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }

  function showAccess(message) {
    $('#admin-access').hidden = false;
    $('#admin-dashboard').hidden = true;
    $('#admin-refresh').hidden = true;
    $('#admin-access-message').textContent = message;
  }

  function formatDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString('en-GB', withTime
      ? {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}
      : {day:'2-digit',month:'short',year:'numeric'});
  }

  function formatUptime(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return (days ? days + 'd ' : '') + hours + 'h ' + minutes + 'm';
  }

  function avatarOptions(selected) {
    return AVATARS.map(([id,name]) => '<option value="' + id + '"' +
      (selected === id ? ' selected' : '') + '>' + name + '</option>').join('');
  }

  function setTab(tab) {
    if (!['overview','insights','players','answers','audit'].includes(tab)) return;
    if (state.analyticsTimer) { clearInterval(state.analyticsTimer); state.analyticsTimer = null; }
    state.tab = tab;
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.adminTab === tab);
    });
    document.querySelectorAll('[data-admin-view]').forEach(view => {
      const active = view.dataset.adminView === tab;
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
    if (tab === 'insights') {
      loadAnalytics();
      state.analyticsTimer = setInterval(() => { if (state.tab === 'insights' && !document.hidden) loadAnalytics(); }, 60000);
    }
    if (tab === 'players') loadUsers();
    if (tab === 'answers') loadReviewQueue();
    if (tab === 'audit') loadAudit();
  }

  async function loadOverview() {
    const result = await api('/admin/overview');
    const stats = result.stats || {};
    const cards = [
      ['PLAYERS',stats.players,'Registered accounts'],
      ['ACTIVE ACCOUNTS',stats.activePlayers,'Can currently sign in'],
      ['SUSPENDED',stats.suspendedPlayers,'Access currently blocked'],
      ['NEW THIS WEEK',stats.newPlayers7d,'Joined in the last 7 days'],
      ['DAILY EDITIONS',stats.dailyEditions,'Atlas Daily challenges'],
      ['PENDING ANSWERS',stats.pendingAnswers,'Awaiting review'],
      ['FINISHED MATCHES',stats.finishedMatches,'Globe Rush records'],
      ['STAFF',Number(stats.admins || 0) + Number(stats.moderators || 0),'Admins and moderators']
    ];
    $('#admin-stats').innerHTML = cards.map(item =>
      '<article class="admin-stat-card"><span>' + item[0] + '</span><b>' +
      number.format(Number(item[1] || 0)) + '</b><small>' + item[2] + '</small></article>'
    ).join('');
    $('#admin-player-tab-count').textContent = number.format(Number(stats.players || 0));
    $('#admin-answer-tab-count').textContent = number.format(Number(stats.pendingAnswers || 0));
    $('#admin-last-updated').textContent = 'Updated ' + formatDate(new Date(), true);
  }


  function compact(value) {
    return new Intl.NumberFormat('en-US', { notation:'compact', maximumFractionDigits:1 }).format(Number(value || 0));
  }

  function insightList(target, rows, labelOf, valueOf, empty) {
    const root = $(target);
    if (!rows || !rows.length) {
      root.innerHTML = '<div class="admin-empty-state">' + escapeHTML(empty || 'No data for this period yet.') + '</div>';
      return;
    }
    const max = Math.max(1, ...rows.map(valueOf));
    root.innerHTML = '<div class="admin-insight-bars">' + rows.map(row => {
      const value = Number(valueOf(row) || 0);
      const pct = Math.max(2, Math.round(value / max * 100));
      return '<div class="admin-insight-bar-row"><span title="' + escapeHTML(labelOf(row)) + '">' + escapeHTML(labelOf(row)) +
        '</span><i><b style="width:' + pct + '%"></b></i><strong>' + compact(value) + '</strong></div>';
    }).join('') + '</div>';
  }

  function renderTimeline(rows) {
    const root = $('#admin-analytics-chart');
    if (!rows || !rows.length) {
      root.innerHTML = '<div class="admin-empty-state">No activity is available for this period yet.</div>';
      return;
    }
    const max = Math.max(1, ...rows.map(row => Math.max(Number(row.page_views || 0), Number(row.signups || 0))));
    const showEvery = rows.length > 120 ? 30 : rows.length > 45 ? 7 : rows.length > 14 ? 3 : 1;
    root.innerHTML = rows.map((row,index) => {
      const views = Number(row.page_views || 0);
      const signups = Number(row.signups || 0);
      const vh = Math.max(1, Math.round(views / max * 100));
      const sh = Math.max(1, Math.round(signups / max * 100));
      const label = index % showEvery === 0 ? escapeHTML(String(row.date || '').slice(5)) : '';
      return '<div class="admin-chart-column" title="' + escapeHTML(row.date) + ' · ' + compact(views) + ' page views · ' + compact(signups) + ' sign-ups">' +
        '<div class="admin-chart-bars"><i class="page" style="height:' + vh + '%"></i><i class="signup" style="height:' + sh + '%"></i></div><small>' + label + '</small></div>';
    }).join('');
    root.style.setProperty('--admin-chart-columns', String(rows.length));
  }

  function renderFeed(rows) {
    const root = $('#admin-analytics-feed');
    if (!rows || !rows.length) {
      root.innerHTML = '<div class="admin-empty-state">No recent events have been recorded in this period.</div>';
      return;
    }
    const names = { signup:'New account', atlas:'Atlas Daily', 'globe-rush':'Globe Rush', practice:'Practice Lab', 'page-view':'Page view' };
    root.innerHTML = rows.map(item =>
      '<article class="admin-feed-row"><span class="admin-feed-kind">' + escapeHTML(names[item.kind] || 'Activity') + '</span>' +
      '<div><strong>' + escapeHTML(item.label || 'HUMANITY visitor') + '</strong><p>' + escapeHTML(item.detail || '') + '</p></div>' +
      '<time>' + escapeHTML(formatDate(item.occurred_at,true)) + '</time></article>'
    ).join('');
  }

  function renderAnalytics(data, live) {
    const s = data.summary || {};
    const values = [
      ['TOTAL PLAYERS',s.total_players,'All registered accounts'],
      ['ACTIVE ACCOUNTS',s.active_players,'Accounts not suspended'],
      ['UNIQUE VISITORS',s.unique_visitors,'Optional analytics consent'],
      ['PAGE VIEWS',s.page_views,'Consented page loads'],
      ['NEW ACCOUNTS',s.new_players,'Registrations in selected period'],
      ['DAILY RUNS STARTED',s.daily_started,'Atlas Daily attempts'],
      ['DAILY RUNS COMPLETED',s.daily_completed,'Completed official runs'],
      ['ANSWER ATTEMPTS',s.answer_attempts,'Submitted answer attempts'],
      ['ANSWER ACCURACY',s.answer_accuracy_pct == null ? '—' : Number(s.answer_accuracy_pct).toFixed(1) + '%','Accepted Atlas Daily answers'],
      ['ATLAS COMPLETION',s.daily_completion_pct == null ? '—' : Number(s.daily_completion_pct).toFixed(1) + '%','Runs completed in selected period'],
      ['AVERAGE ATLAS SCORE',s.average_daily_score,'Completed official runs'],
      ['AVERAGE ATLAS TIME',Math.floor(Number(s.average_daily_seconds || 0)/60) + 'm ' + (Number(s.average_daily_seconds || 0)%60) + 's','Average time to finish'],
      ['HINTS USED',s.hints_used,'Atlas Daily hint uses'],
      ['GLOBE RUSH MATCHES',s.party_matches,'Finished multiplayer matches'],
      ['MATCH PLAYER SLOTS',s.match_player_slots,'Total seats in recorded matches'],
      ['GLOBE RUSH XP AWARDED',s.party_xp_earned,'XP earned across match players'],
      ['PRACTICE SESSIONS',s.practice_started,'Sessions created'],
      ['PRACTICE COMPLETED',s.practice_completed,'Finished practice sessions'],
      ['ACTIVE SESSIONS',s.active_sessions,'Valid sign-in sessions'],
      ['PENDING ANSWERS',s.pending_answers,'Waiting for moderation']
    ];
    $('#admin-insight-kpis').innerHTML = values.map(item => {
      const display = typeof item[1] === 'string' ? item[1] : compact(item[1]);
      return '<article class="admin-stat-card"><span>' + item[0] + '</span><b>' + display + '</b><small>' + item[2] + '</small></article>';
    }).join('');
    $('#admin-live-players').textContent = live ? compact(live.players) : '—';
    $('#admin-live-rooms').textContent = live ? compact(live.rooms) : '—';
    $('#admin-live-sessions').textContent = compact(s.active_sessions);
    $('#admin-live-pending').textContent = compact(s.pending_answers);
    $('#admin-live-status').textContent = live ? 'CONNECTED' : 'PARTIAL';
    $('#admin-live-status').className = 'admin-status-pill ' + (live ? 'is-online' : 'is-offline');
    $('#admin-consent-note').textContent = Number(s.page_views || 0)
      ? 'Counts include only visitors who explicitly allowed optional analytics.'
      : 'No consented page views in this period yet. Gameplay records are still shown separately.';
    $('#admin-analytics-retention').textContent = 'Optional visitor analytics · ' + Number(data.retentionDays || 365) + '-day retention';
    renderTimeline(data.timeline || []);
    insightList('#admin-popular-pages', data.popularPages || [], row => String(row.page || 'Unknown page').toUpperCase(), row => row.views, 'No opt-in page views for this period yet.');
    insightList('#admin-party-insights', data.partyModes || [], row => String(row.mode || 'Mode') + ' · ' + String(row.variant || 'classic'), row => row.matches, 'No Globe Rush matches in this period yet.');
    insightList('#admin-category-insights', data.categories || [], row => String(row.category_label || 'Category'), row => row.matches, 'No Globe Rush categories in this period yet.');
    insightList('#admin-country-insights', data.countries || [], row => String(row.country || 'Unknown').toUpperCase(), row => row.players, 'No country data is available yet.');
    insightList('#admin-engine-insights', data.engineRuns || [], row => String(row.run_type || 'Engine') + ' · ' + String(row.status || 'unknown'), row => row.runs, 'No background engine runs recorded in this period.');
    insightList('#admin-admin-action-insights', data.adminActions || [], row => String(row.action || 'Admin action').replace(/[-_]/g,' '), row => row.actions, 'No admin actions recorded in this period.');
    insightList('#admin-question-insights', data.topQuestions || [], row => String(row.prompt || row.question_id || 'Question').slice(0,72), row => row.attempts, 'No Atlas Daily answers in this period yet.');
    insightList('#admin-practice-insights', data.practicePacks || [], row => String(row.pack_id || 'Practice pack').replace(/[-_]/g,' '), row => row.sessions, 'No Practice Lab sessions in this period yet.');
    insightList('#admin-avatar-insights', data.avatars || [], row => String(row.avatar || 'mercury').toUpperCase(), row => row.players, 'No player avatar data available yet.');
    insightList('#admin-top-players', data.topPlayers || [], row => String(row.username || 'Explorer') + ' · L' + Number(row.level || 1), row => row.games, 'No player gameplay in this period yet.');
    renderFeed(data.activity || []);
    $('#admin-analytics-updated').textContent = 'Updated ' + formatDate(new Date(),true);
  }

  async function loadAnalytics() {
    try {
      const params = new URLSearchParams({range:state.analyticsRange});
      const results = await Promise.all([
        api('/admin/analytics?' + params.toString()),
        api('/party/online').catch(() => null)
      ]);
      state.analyticsData = results[0];
      renderAnalytics(results[0], results[1]);
    } catch (error) {
      $('#admin-insight-kpis').innerHTML = '<div class="admin-empty-state">Insights could not be loaded: ' + escapeHTML(error.message) + '</div>';
      toast(error.message);
    }
  }

  function exportAnalyticsCSV() {
    const data = state.analyticsData;
    if (!data) { toast('Load analytics before exporting.'); return; }
    const lines = [['date','signups','page_views','daily_runs','globe_rush_matches','practice_runs']];
    for (const row of data.timeline || []) lines.push([row.date,row.signups,row.page_views,row.daily_runs,row.matches,row.practice_runs]);
    const quote = value => '"' + String(value == null ? '' : value).replace(/"/g,'""') + '"';
    const csv = lines.map(row => row.map(quote).join(',')).join('\r\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'humanity-insights-' + state.analyticsRange + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('Aggregate analytics CSV exported.');
  }

  async function loadHealth() {
    const pill = $('#admin-api-status');
    try {
      const health = await api('/health');
      pill.textContent = 'OPERATIONAL';
      pill.className = 'admin-status-pill is-online';
      $('#admin-health-service').textContent = health.service || 'Online';
      $('#admin-health-database').textContent = health.database ? 'Connected' : 'Unavailable';
      $('#admin-health-uptime').textContent = formatUptime(health.uptimeSeconds);
      $('#admin-health-rooms').textContent = number.format(Number(health.activeRooms || 0));
      $('#admin-health-note').textContent = 'Latest API health check completed successfully.';
    } catch (error) {
      pill.textContent = 'UNAVAILABLE';
      pill.className = 'admin-status-pill is-offline';
      $('#admin-health-service').textContent = 'Not responding';
      $('#admin-health-database').textContent = 'Unknown';
      $('#admin-health-uptime').textContent = '—';
      $('#admin-health-rooms').textContent = '—';
      $('#admin-health-note').textContent = error.message;
    }
  }

  function avatarClass(value) {
    const key = String(value || 'mercury').toLowerCase();
    return AVATARS.some(item => item[0] === key) ? 'admin-avatar-' + key : 'admin-avatar-mercury';
  }

  function buildUserRow(player) {
    const selected = String(state.selectedId || '') === String(player.id);
    const role = String(player.role || 'member').toLowerCase();
    const status = String(player.status || 'active').toLowerCase();
    const initial = escapeHTML((player.username || '?').slice(0,1).toUpperCase());
    return '<tr data-user-id="' + escapeHTML(player.id) + '" class="' + (selected ? 'is-selected' : '') + '">' +
      '<td><div class="admin-player-identity"><span class="admin-player-avatar admin-avatar-orb ' + avatarClass(player.selectedAvatar) + '"></span><span>' +
      '<span class="admin-player-name">' + escapeHTML(player.username) + '</span><span class="admin-player-email">' +
      escapeHTML(player.email || 'No email address') + '</span></span></div></td>' +
      '<td><span class="admin-tag role-' + escapeHTML(role) + '">' + escapeHTML(role.toUpperCase()) + '</span></td>' +
      '<td><span class="admin-tag status-' + escapeHTML(status) + '">' + escapeHTML(status.toUpperCase()) + '</span></td>' +
      '<td>' + number.format(Number(player.level || 1)) + '</td><td>' + escapeHTML(formatDate(player.createdAt)) +
      '</td><td><span class="admin-table-open">OPEN ↗</span></td></tr>';
  }

  async function loadUsers() {
    const list = $('#admin-users-list');
    list.innerHTML = '<tr><td colspan="6" class="admin-table-message">Loading players…</td></tr>';
    const params = new URLSearchParams({
      q:state.query, role:state.roleFilter, status:state.statusFilter,
      limit:String(state.limit), offset:String(state.offset)
    });
    try {
      const result = await api('/admin/users?' + params.toString());
      state.total = Number(result.total || 0);
      $('#admin-users-count').textContent = number.format(state.total) + ' players found';
      list.innerHTML = result.players.length
        ? result.players.map(buildUserRow).join('')
        : '<tr><td colspan="6" class="admin-table-message">No players match these filters.</td></tr>';
      const page = Math.floor(state.offset / state.limit) + 1;
      const pages = Math.max(1, Math.ceil(state.total / state.limit));
      $('#admin-page-label').textContent = 'Page ' + page + ' of ' + pages;
      $('#admin-page-prev').disabled = state.offset <= 0;
      $('#admin-page-next').disabled = state.offset + state.limit >= state.total;
      if (state.selectedId && !result.players.some(player => String(player.id) === String(state.selectedId))) {
        state.selectedId = null;
      }
    } catch (error) {
      list.innerHTML = '<tr><td colspan="6" class="admin-table-message">' + escapeHTML(error.message) + '</td></tr>';
    }
  }

  function canManageTarget(player) {
    if (!player || state.actorRole === 'moderator' || player.role === 'owner') return false;
    if (state.actorRole === 'owner') return true;
    return state.actorRole === 'admin' && player.role === 'member';
  }

  function renderActivity(entries) {
    const items = Array.isArray(entries) ? entries : [];
    if (!items.length) return '<p class="admin-muted-note">No recent activity has been recorded for this player.</p>';
    return '<ul class="admin-activity-list">' + items.slice(0,10).map(item => {
      const label = item.kind === 'atlas-daily' ? 'Atlas Daily' :
        item.kind === 'globe-rush' ? 'Globe Rush · ' + String(item.label || 'classic').replace(/-/g,' ') :
        'Practice · ' + String(item.label || 'session');
      const suffix = item.kind === 'globe-rush' && item.player_rank ? ' · #' + item.player_rank : '';
      return '<li><span>' + escapeHTML(label + suffix) + '</span><small>' +
        escapeHTML(formatDate(item.occurred_at, true)) + '</small></li>';
    }).join('') + '</ul>';
  }

  function renderEditor(details) {
    const player = details.player;
    state.selectedDetails = details;
    const canManage = canManageTarget(player);
    const isOwner = state.actorRole === 'owner';
    const stats = details.stats || {};
    const avatar = AVATARS.find(item => item[0] === player.selectedAvatar);
    const name = escapeHTML(player.username || 'Explorer');
    const role = escapeHTML(player.role || 'member');
    const status = escapeHTML(player.status || 'active');
    const lockNote = player.avatarLocked ? 'Avatar assignment is locked until an administrator unlocks it.' : 'Players may use avatars once their Globe Rush streak unlocks them.';
    const roleField = isOwner
      ? '<label class="admin-form-field"><span>ACCOUNT ROLE</span><select name="role"><option value="member"' + (player.role === 'member' ? ' selected' : '') + '>Member</option><option value="moderator"' + (player.role === 'moderator' ? ' selected' : '') + '>Moderator</option><option value="admin"' + (player.role === 'admin' ? ' selected' : '') + '>Admin</option></select></label>'
      : '<div class="admin-form-field"><span>ACCOUNT ROLE</span><input value="' + role.toUpperCase() + '" disabled></div>';
    const fieldsDisabled = canManage ? '' : ' disabled';
    $('#admin-user-editor').innerHTML =
      '<div class="admin-editor-head"><span class="admin-editor-avatar admin-avatar-orb ' + avatarClass(player.selectedAvatar) + '" title="' + escapeHTML(avatar ? avatar[1] : 'Mercury') + '"></span>' +
      '<div><h3>' + name + '</h3><p>' + escapeHTML(player.email || 'No email linked') + '</p></div>' +
      '<span class="admin-tag status-' + status + ' admin-editor-status">' + status.toUpperCase() + '</span></div>' +
      '<div class="admin-editor-stats">' +
      '<div class="admin-editor-stat"><span>LEVEL</span><b>' + number.format(player.level || 1) + '</b></div>' +
      '<div class="admin-editor-stat"><span>GAMES</span><b>' + number.format(Number(stats.dailyGames || 0) + Number(stats.globeRushGames || 0) + Number(stats.practiceGames || 0)) + '</b></div>' +
      '<div class="admin-editor-stat"><span>FRIENDS</span><b>' + number.format(stats.friends || 0) + '</b></div></div>' +
      '<form id="admin-user-form" data-user-id="' + escapeHTML(player.id) + '">' +
      '<div class="admin-editor-section"><h4>IDENTITY & PERMISSIONS</h4><div class="admin-form-grid">' +
      roleField +
      '<label class="admin-form-field"><span>PLANET AVATAR</span><div class="admin-avatar-live-preview" id="admin-avatar-live-preview"><span class="admin-avatar-orb ' + avatarClass(player.selectedAvatar) + '" id="admin-avatar-preview-orb"></span><strong id="admin-avatar-preview-name">' + escapeHTML(avatar ? avatar[1] : 'Mercury') + '</strong></div><select name="selectedAvatar" data-original-avatar="' + escapeHTML(player.selectedAvatar || 'mercury') + '"' + fieldsDisabled + '>' + avatarOptions(player.selectedAvatar) + '</select></label>' +
      '<label class="admin-form-field"><span>ACCOUNT STATUS</span><select name="status"' + fieldsDisabled + '><option value="active"' + (player.status === 'active' ? ' selected' : '') + '>Active</option><option value="suspended"' + (player.status === 'suspended' ? ' selected' : '') + '>Suspended</option></select></label>' +
      '<label class="admin-form-field"><span>XP</span><input name="xp" type="number" min="0" max="1000000000" step="1" value="' + Number(player.xp || 0) + '"' + fieldsDisabled + '></label>' +
      '<label class="admin-form-field"><span>LEVEL</span><input name="level" type="number" min="1" max="10000" step="1" value="' + Number(player.level || 1) + '"' + fieldsDisabled + '></label>' +
      '<label class="admin-form-field"><span>GLOBE RUSH RATING</span><input name="partyRating" type="number" min="100" max="100000" step="1" value="' + Number(player.partyRating || 1000) + '"' + fieldsDisabled + '></label>' +
      '</div>' +
      '<label class="admin-checkbox-row"><input name="avatarLocked" type="checkbox"' + (player.avatarLocked ? ' checked' : '') + fieldsDisabled + '><span>Lock this assigned planet for the player. Changing the selected planet will enable this automatically; leave it unlocked only when the player has earned its streak requirement.</span></label>' +
      '<p class="admin-muted-note">' + escapeHTML(lockNote) + (avatar ? ' Current avatar: ' + escapeHTML(avatar[1]) + '.' : '') + '</p></div>' +
      '<div class="admin-editor-section"><h4>ACCOUNT NOTES & MODERATION</h4><div class="admin-form-grid">' +
      '<label class="admin-form-field full"><span>SUSPENSION REASON</span><textarea name="suspensionReason" maxlength="300" placeholder="Shown to the player if their account is suspended"' + fieldsDisabled + '>' + escapeHTML(player.suspensionReason || '') + '</textarea></label>' +
      '<label class="admin-form-field full"><span>PRIVATE ADMIN NOTE</span><textarea name="adminNote" maxlength="500" placeholder="Internal notes for HUMANITY administrators"' + fieldsDisabled + '>' + escapeHTML(player.adminNote || '') + '</textarea></label>' +
      '</div></div>' +
      '<div class="admin-editor-actions"><button class="admin-save-button" type="submit"' + (canManage ? '' : ' disabled') + '>Save changes</button>' +
      '<button class="admin-danger-button" id="admin-revoke-sessions" type="button"' + (canManage ? '' : ' disabled') + '>Revoke sessions</button></div>' +
      '<p class="admin-editor-feedback" id="admin-editor-feedback">' + (canManage ? 'Changes are recorded in the admin audit log.' : (state.actorRole === 'moderator' ? 'Moderator access is read-only for player accounts.' : 'This account is protected from your current role.')) + '</p>' +
      '</form>' +
      '<div class="admin-editor-section"><h4>RECENT ACTIVITY</h4>' + renderActivity(details.recentActivity) + '</div>' +
      '<div class="admin-editor-section"><h4>ACCOUNT DETAILS</h4><p class="admin-muted-note">Joined ' + escapeHTML(formatDate(player.createdAt, true)) + ' · ' +
      number.format(stats.activeSessions || 0) + ' active session(s) · best Atlas Daily score ' + number.format(stats.bestDailyScore || 0) + ' · Globe Rush wins ' + number.format(stats.globeRushWins || 0) + '</p></div>';

    const form = $('#admin-user-form');
    const avatarSelect = form.elements.selectedAvatar;
    const avatarLock = form.elements.avatarLocked;
    avatarSelect.addEventListener('change', () => {
      const changed = avatarSelect.value !== avatarSelect.dataset.originalAvatar;
      if (changed) avatarLock.checked = true;
      const selected = AVATARS.find(item => item[0] === avatarSelect.value);
      const orb = $('#admin-avatar-preview-orb');
      if (orb) orb.className = 'admin-avatar-orb ' + avatarClass(avatarSelect.value);
      const label = $('#admin-avatar-preview-name');
      if (label) label.textContent = selected ? selected[1] : 'Mercury';
      $('#admin-editor-feedback').textContent = changed
        ? 'New planet selected. It will be assigned and locked when you save.'
        : 'Original avatar restored. You can keep the current lock setting.';
    });
    avatarLock.addEventListener('change', () => {
      $('#admin-editor-feedback').textContent = avatarLock.checked
        ? 'This avatar will be locked to the account after saving.'
        : 'Unlocked avatars still require the player to meet the planet streak requirement.';
    });
    form.addEventListener('submit', saveUser);
    $('#admin-revoke-sessions').addEventListener('click', revokeSessions);
  }

  async function openUser(id) {
    state.selectedId = id;
    $('#admin-users-list').querySelectorAll('tr[data-user-id]').forEach(row => {
      row.classList.toggle('is-selected', row.dataset.userId === String(id));
    });
    $('#admin-user-editor').innerHTML = '<div class="admin-empty-state">Loading player account…</div>';
    try {
      const details = await api('/admin/users/' + encodeURIComponent(id));
      renderEditor(details);
    } catch (error) {
      $('#admin-user-editor').innerHTML = '<div class="admin-empty-state">' + escapeHTML(error.message) + '</div>';
    }
  }

  async function saveUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = $('#admin-editor-feedback');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    feedback.textContent = 'Saving account changes…';
    const body = {
      selectedAvatar:form.elements.selectedAvatar.value,
      avatarLocked:form.elements.avatarLocked.checked,
      status:form.elements.status.value,
      xp:Number(form.elements.xp.value),
      level:Number(form.elements.level.value),
      partyRating:Number(form.elements.partyRating.value),
      suspensionReason:form.elements.suspensionReason.value,
      adminNote:form.elements.adminNote.value
    };
    if (state.actorRole === 'owner' && form.elements.role) body.role = form.elements.role.value;
    try {
      const result = await api('/admin/users/' + encodeURIComponent(form.dataset.userId), {method:'PATCH',body});
      feedback.textContent = 'Saved. Account changes are now active.';
      toast('Player account updated.');
      await loadUsers();
      await openUser(form.dataset.userId);
      await Promise.all([loadOverview(),loadAudit()]);
    } catch (error) {
      feedback.textContent = error.message;
      toast(error.message);
      submit.disabled = false;
    }
  }

  async function revokeSessions() {
    if (!state.selectedId || !window.confirm('Revoke every active sign-in session for this player? They will need to sign in again.')) return;
    const button = $('#admin-revoke-sessions');
    button.disabled = true;
    try {
      const result = await api('/admin/users/' + encodeURIComponent(state.selectedId) + '/revoke-sessions', {method:'POST',body:{}});
      toast(number.format(result.revoked || 0) + ' session(s) revoked.');
      await openUser(state.selectedId);
      await loadAudit();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  }

  async function loadReviewQueue() {
    const queue = $('#admin-queue');
    queue.innerHTML = '<div class="admin-empty-state">Loading answer suggestions…</div>';
    try {
      const result = await api('/admin/review-queue');
      const entries = Array.isArray(result.entries) ? result.entries : [];
      $('#admin-queue-count').textContent = number.format(entries.length) + ' pending';
      $('#admin-answer-tab-count').textContent = number.format(entries.length);
      if (!entries.length) {
        queue.innerHTML = '<div class="admin-empty-state">The answer review queue is clear. New player suggestions will appear here.</div>';
        return;
      }
      queue.innerHTML = entries.map(item => {
        const sourceUrl = String(item.source_url || '');
        const source = /^https?:\/\//i.test(sourceUrl)
          ? '<a class="admin-source-link" href="' + escapeHTML(sourceUrl) + '" target="_blank" rel="noopener noreferrer">Open verification source ↗</a>'
          : '';
        const options = RARITIES.map((name,index) => '<option value="' + index + '"' + (index === 2 ? ' selected' : '') + '>' +
          name + ' · ' + RARITY_POINTS[index] + ' pts</option>').join('');
        return '<article class="admin-queue-item" data-review-row="' + Number(item.id) + '">' +
          '<div class="admin-queue-copy"><strong class="admin-queue-answer">' + escapeHTML(item.answer_text) +
          '<span class="admin-occurrences">×' + number.format(Number(item.occurrences || 1)) + ' suggestions</span></strong>' +
          '<span class="admin-queue-question">' + escapeHTML(item.question_prompt) + '</span>' + source +
          '<div class="admin-review-controls"><label>DISCOVERY RARITY<select data-review-rarity>' + options + '</select></label>' +
          '<label>ALTERNATIVE NAMES / ALIASES<input data-review-aliases maxlength="5000" placeholder="Comma-separated names, translations or local spellings"></label></div></div>' +
          '<div class="admin-queue-actions"><button class="approve" type="button" data-review-action="approve" data-review-id="' + Number(item.id) + '">Approve</button>' +
          '<button type="button" data-review-action="reject" data-review-id="' + Number(item.id) + '">Reject</button></div></article>';
      }).join('');
    } catch (error) {
      queue.innerHTML = '<div class="admin-empty-state">' + escapeHTML(error.message) + '</div>';
    }
  }

  async function reviewAction(event) {
    const button = event.target.closest('[data-review-id]');
    if (!button) return;
    const row = button.closest('[data-review-row]');
    if (!row) return;
    row.querySelectorAll('button').forEach(item => { item.disabled = true; });
    try {
      const aliases = row.querySelector('[data-review-aliases]').value.split(',').map(value => value.trim()).filter(Boolean);
      await api('/admin/review/' + encodeURIComponent(button.dataset.reviewId), {
        method:'POST',
        body:{
          action:button.dataset.reviewAction,
          rarity:Number(row.querySelector('[data-review-rarity]').value),
          aliases
        }
      });
      toast(button.dataset.reviewAction === 'approve' ? 'Answer approved and added to the answer bank.' : 'Answer suggestion rejected.');
      await Promise.all([loadReviewQueue(),loadOverview(),loadAudit()]);
    } catch (error) {
      row.querySelectorAll('button').forEach(item => { item.disabled = false; });
      toast(error.message);
    }
  }

  function actionLabel(value) {
    return String(value || 'admin_action').replace(/_/g,' ').replace(/\b\w/g,letter => letter.toUpperCase());
  }

  async function loadAudit() {
    const root = $('#admin-audit-list');
    root.innerHTML = '<div class="admin-empty-state">Loading audit history…</div>';
    try {
      const result = await api('/admin/audit?limit=80');
      const entries = Array.isArray(result.entries) ? result.entries : [];
      if (!entries.length) {
        root.innerHTML = '<div class="admin-empty-state">No administration actions have been recorded yet.</div>';
        return;
      }
      root.innerHTML = '<div class="admin-audit-list">' + entries.map(item => {
        const details = item.details && typeof item.details === 'object' ? item.details : {};
        const summary = Object.entries(details).slice(0,8).map(([key,value]) =>
          actionLabel(key) + ': ' + (Array.isArray(value) ? value.join(', ') : String(value))
        ).join(' · ');
        return '<article class="admin-audit-row"><time class="admin-audit-date">' + escapeHTML(formatDate(item.created_at,true)) + '</time>' +
          '<div class="admin-audit-main"><strong>' + escapeHTML(actionLabel(item.action)) + '</strong>' +
          '<p>By ' + escapeHTML(item.actor_username || 'Administrator') + (summary ? ' · ' + escapeHTML(summary) : '') + '</p></div>' +
          '<span class="admin-audit-target">' + escapeHTML(item.target_username || 'System') + '</span></article>';
      }).join('') + '</div>';
    } catch (error) {
      root.innerHTML = '<div class="admin-empty-state">' + escapeHTML(error.message) + '</div>';
    }
  }

  async function refreshDashboard() {
    const button = $('#admin-refresh');
    button.disabled = true;
    try {
      await Promise.all([loadOverview(),loadHealth(),loadReviewQueue()]);
      if (state.tab === 'players') {
        await loadUsers();
        if (state.selectedId) await openUser(state.selectedId);
      }
      if (state.tab === 'audit') await loadAudit();
      if (state.tab === 'insights') await loadAnalytics();
      toast('Admin data refreshed.');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function initEvents() {
    document.querySelectorAll('[data-admin-tab]').forEach(button =>
      button.addEventListener('click', () => setTab(button.dataset.adminTab))
    );
    document.querySelectorAll('[data-go-tab]').forEach(button =>
      button.addEventListener('click', () => setTab(button.dataset.goTab))
    );
    $('#admin-refresh').addEventListener('click', refreshDashboard);
    $('#admin-audit-refresh').addEventListener('click', loadAudit);
    $('#admin-analytics-refresh').addEventListener('click', loadAnalytics);
    $('#admin-analytics-range').addEventListener('change', () => {
      state.analyticsRange = $('#admin-analytics-range').value;
      loadAnalytics();
    });
    $('#admin-analytics-export').addEventListener('click', exportAnalyticsCSV);
    $('#admin-queue').addEventListener('click', reviewAction);
    $('#admin-users-list').addEventListener('click', event => {
      const row = event.target.closest('tr[data-user-id]');
      if (row) openUser(row.dataset.userId);
    });
    $('#admin-player-search').addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.query = $('#admin-player-search').value.trim();
        state.offset = 0;
        loadUsers();
      }, 240);
    });
    $('#admin-role-filter').addEventListener('change', () => {
      state.roleFilter = $('#admin-role-filter').value;
      state.offset = 0;
      loadUsers();
    });
    $('#admin-status-filter').addEventListener('change', () => {
      state.statusFilter = $('#admin-status-filter').value;
      state.offset = 0;
      loadUsers();
    });
    $('#admin-player-search-clear').addEventListener('click', () => {
      $('#admin-player-search').value = '';
      $('#admin-role-filter').value = '';
      $('#admin-status-filter').value = '';
      state.query = '';
      state.roleFilter = '';
      state.statusFilter = '';
      state.offset = 0;
      loadUsers();
    });
    $('#admin-page-prev').addEventListener('click', () => {
      state.offset = Math.max(0,state.offset - state.limit);
      loadUsers();
    });
    $('#admin-page-next').addEventListener('click', () => {
      if (state.offset + state.limit < state.total) state.offset += state.limit;
      loadUsers();
    });
  }

  async function bootstrap() {
    if (!token) {
      showAccess('Sign in to HUMANITY with an administrator account, then return to this page. Your account must have owner, admin or moderator access.');
      return;
    }
    try {
      const session = await api('/auth/me');
      const player = session.player;
      const role = String(player && player.role || 'member').toLowerCase();
      if (!player || !['owner','admin','moderator'].includes(role)) {
        showAccess('This account does not have HUMANITY administration permissions. Ask the site owner to assign an appropriate role.');
        return;
      }
      state.actor = player;
      state.actorRole = role;
      $('#admin-username').textContent = player.username || 'Administrator';
      $('#admin-role').textContent = role.toUpperCase();
      $('#admin-access').hidden = true;
      $('#admin-dashboard').hidden = false;
      $('#admin-refresh').hidden = false;
      initEvents();
      await Promise.all([loadOverview(),loadHealth(),loadReviewQueue()]);
    } catch (error) {
      showAccess(error.status === 401
        ? 'Your sign-in session has expired. Sign in again with an administrator account.'
        : error.message);
    }
  }

  bootstrap();
})();