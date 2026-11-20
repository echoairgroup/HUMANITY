'use strict';

(() => {
  const API = 'https://humanity-api-jyk5.onrender.com/api';
  const SOCKET_URL = 'wss://humanity-api-jyk5.onrender.com/api/party';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const number = new Intl.NumberFormat('en-US');
  const state = {
    token: localStorage.getItem('humanity-session-token') || '',
    player: null, guestId: getGuestId(), daily: null, runId: null,
    questionIndex: 0, question: null, pendingNextIndex: null,
    provisionalScore: 0, timer: null, secondsLeft: 25, hintUsed: false,
    ws: null, wsPending: null, room: null, roomCode: null, playerId: null,
    result: null, currentRanking: 'daily', authMode: 'login', practice: null,
    toastTimer: null, sounds: localStorage.getItem('humanity-sound') !== 'false',
    animations: localStorage.getItem('humanity-motion') !== 'false'
  };

  function getGuestId() {
    let id = localStorage.getItem('humanity-guest-id');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('humanity-guest-id', id);
    }
    return id;
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function norm(value) {
    return String(value || '').normalize('NFKD').replace(/\p{M}+/gu, '')
      .toLocaleLowerCase('en').replace(/&/g, ' and ').replace(/[’']/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }
  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 3100);
  }
  async function api(path, options = {}) {
    const headers = {
      Accept: 'application/json',
      'X-Humanity-Guest': state.guestId,
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    };
    const response = await fetch(API + path, {
      method: options.method || 'GET', headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || 'The request could not be completed.');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  function setView(view) {
    if (!['daily', 'party', 'rankings'].includes(view)) view = 'daily';
    $$('[data-view-panel]').forEach(panel => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    $('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    document.body.classList.add('globe-rush-active');
    if (view === 'party') { loadOpenRooms(); loadPartyMiniRanking(); loadSeason(); }
    if (view === 'rankings') loadRankings(state.currentRanking);
    history.replaceState(null, '', '#' + view);
    window.scrollTo({ top: 0, behavior: state.animations ? 'smooth' : 'auto' });
  }
  function setSettings() {
    document.body.classList.toggle('reduce-motion', !state.animations);
    if ($('#setting-sound')) $('#setting-sound').checked = state.sounds;
    if ($('#setting-motion')) $('#setting-motion').checked = state.animations;
  }
  function playTone(kind) {
    if (!state.sounds) return;
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioClass) return;
      const ctx = new AudioClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = kind === 'error' ? 180 : kind === 'overload' ? 95 : 520;
      gain.gain.setValueAtTime(.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.05, ctx.currentTime + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + .16);
      osc.onended = () => ctx.close();
    } catch (_) {}
  }
  function openModal(id) { const el = $('#' + id); if (el && !el.open) el.showModal(); }
  function closeModal(id) { const el = $('#' + id); if (el && el.open) el.close(); }
  function fmtDate(value) {
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(date)
      : value;
  }
  function setDailySection(id) {
    ['daily-idle','daily-play','daily-result','daily-complete','daily-locked'].forEach(name => {
      const el = $('#' + name);
      if (el) el.hidden = name !== id;
    });
  }
  async function loadDaily() {
    try {
      const result = await api('/daily/current');
      state.daily = result;
      $('#edition-date').textContent = fmtDate(result.date);
      if (result.played) {
        setDailySection('daily-locked');
        $('#locked-summary').textContent = result.played.status === 'completed'
          ? 'You completed today’s official run. ' + (result.played.final_score == null ? 'Your score is saved while Discovery Points are finalised at 00:00 UTC.' : 'Your final Discovery Score is ' + number.format(result.played.final_score) + ' points.')
          : 'Your official attempt has already started. Atlas Daily is one uninterrupted run, so it cannot be restarted.';
      } else setDailySection('daily-idle');
      if (state.player) $('#streak-number').textContent = number.format(state.player.dailyStreak || 0) + ' days';
      await Promise.all([loadDailyMiniRanking(), loadArchive()]);
    } catch (error) {
      $('#edition-date').textContent = 'Unavailable';
      $('#daily-panel-title').textContent = 'The Atlas is temporarily offline.';
      toast(error.message);
    }
  }
  async function loadDailyMiniRanking() {
    try {
      const result = await api('/daily/leaderboard');
      renderMiniRanking('#daily-mini-ranking', result.entries || []);
    } catch (_) {
      $('#daily-mini-ranking').innerHTML = '<p class="empty-room-note">Rankings are temporarily unavailable.</p>';
    }
  }
  async function startDaily() {
    const button = $('#daily-start');
    button.disabled = true;
    button.textContent = 'Preparing today’s Atlas…';
    try {
      const result = await api('/daily/start', { method: 'POST', body: { guestId: state.guestId } });
      state.runId = result.runId;
      state.provisionalScore = 0;
      updateQuestion(result.question, result.index);
      setDailySection('daily-play');
      startDailyTimer(result.seconds || 25);
    } catch (error) {
      if (error.status === 409) {
        setDailySection('daily-locked');
        $('#locked-summary').textContent = 'Your official attempt has already started. It cannot be restarted or played again today.';
      } else toast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = 'Start today’s Atlas <span aria-hidden="true">↗</span>';
    }
  }
  function updateQuestion(question, index) {
    state.question = question;
    state.questionIndex = index;
    state.pendingNextIndex = null;
    $('#question-number').textContent = String(index + 1).padStart(2, '0');
    $('#question-category').textContent = question.category || 'GEOGRAPHY';
    $('#daily-question').textContent = question.prompt;
    $('#question-note').textContent = question.note || 'Every answer in the approved set counts.';
    $$('.progress-segment').forEach((el, i) => {
      el.classList.toggle('done', i < index);
      el.classList.toggle('active', i === index);
    });
    $('#daily-answer').value = '';
    $('#daily-feedback').textContent = '';
    $('#daily-feedback').classList.remove('success');
    $('#hint-box').hidden = true;
    $('#hint-box').textContent = '';
    state.hintUsed = false;
    $('#daily-hint').disabled = false;
    $('#hint-counter').textContent = '1 / 1';
    $('#daily-submit').disabled = false;
  }
  function stopDailyTimer() { clearInterval(state.timer); state.timer = null; }
  function renderDailyClock() {
    $('#daily-clock .clock-face').textContent = String(Math.max(0, state.secondsLeft));
    $('#daily-clock').classList.toggle('urgent', state.secondsLeft <= 7);
    $('#daily-clock').setAttribute('aria-label', state.secondsLeft + ' seconds remaining');
  }
  function startDailyTimer(seconds) {
    stopDailyTimer();
    state.secondsLeft = seconds || 25;
    renderDailyClock();
    state.timer = setInterval(() => {
      state.secondsLeft -= 1;
      renderDailyClock();
      if (state.secondsLeft <= 0) { stopDailyTimer(); skipDailyQuestion(); }
    }, 1000);
  }
  async function submitDailyAnswer(event) {
    event.preventDefault();
    if (!state.runId || !state.question || state.pendingNextIndex !== null) return;
    const input = $('#daily-answer');
    const answer = input.value.trim();
    if (!answer) return;
    $('#daily-submit').disabled = true;
    $('#daily-feedback').textContent = 'Checking the approved answer set…';
    $('#daily-feedback').classList.remove('success');
    try {
      const result = await api('/daily/answer', {
        method: 'POST',
        body: { guestId: state.guestId, runId: state.runId, index: state.questionIndex, answer }
      });
      if (result.skipped) {
        stopDailyTimer();
        state.pendingNextIndex = result.nextIndex;
        showDailyResult(false, '', '', 0, result.reveal || []);
        return;
      }
      if (!result.accepted) {
        $('#daily-feedback').textContent = result.message || 'That answer is not in today’s approved answer set. Try another.';
        playTone('error');
        input.select();
        return;
      }
      stopDailyTimer();
      state.provisionalScore += Number(result.provisionalPoints || 0);
      state.pendingNextIndex = result.nextIndex;
      showDailyResult(true, result.answer, result.level, result.provisionalPoints, result.reveal || [], result.sameAnswerCount || 1);
      playTone('success');
    } catch (error) {
      $('#daily-feedback').textContent = error.message;
      if (error.status === 409) { stopDailyTimer(); toast('This question has already been completed.'); }
    } finally { $('#daily-submit').disabled = false; }
  }
  async function skipDailyQuestion() {
    if (!state.runId || !state.question || state.pendingNextIndex !== null) return;
    $('#daily-submit').disabled = true;
    try {
      const result = await api('/daily/skip', {
        method: 'POST',
        body: { guestId: state.guestId, runId: state.runId, index: state.questionIndex }
      });
      state.pendingNextIndex = result.nextIndex;
      showDailyResult(false, '', '', 0, result.reveal || []);
      playTone('error');
    } catch (error) { toast(error.message); }
    finally { $('#daily-submit').disabled = false; }
  }
  function showDailyResult(accepted, answer, level, points, reveal, sameAnswerCount) {
    setDailySection('daily-result');
    $('#result-stamp').textContent = accepted ? 'ANSWER ACCEPTED' : 'TIME IS UP';
    $('#result-title').textContent = accepted ? 'Nicely found.' : 'The next question awaits.';
    $('#result-description').textContent = accepted
      ? '“' + answer + '” is approved. ' + number.format(sameAnswerCount || 1) + ' player(s) have named it so far.'
      : 'No answer was locked in this round. Here are some approved answers to learn from.';
    $('#result-level').textContent = accepted ? String(level || 'Known').toUpperCase() : '—';
    $('#result-points').textContent = number.format(points || 0);
    $('#answer-sheet-count').textContent = reveal.length + ' approved answers';
    $('#answer-sheet-list').innerHTML = reveal.map(item =>
      '<span class="answer-chip">' + esc(item.answer) + ' <b>' + number.format(item.points || 0) + '</b></span>'
    ).join('');
    const nextButton = $('#daily-next');
    nextButton.textContent = state.pendingNextIndex >= 7 ? 'See your result' : 'Next question →';
    // Keep the result on screen until the player explicitly continues.
    nextButton.focus({ preventScroll: true });
  }
  async function nextDailyQuestion() {
    if (!state.runId || state.pendingNextIndex === null || state.advancing) return;
    state.advancing = true;
    const index = state.pendingNextIndex;
    if (index >= 7) {
      setDailySection('daily-complete');
      $('#complete-score').textContent = number.format(state.provisionalScore);
      $('#complete-summary').textContent = 'You completed all seven questions in ' + fmtDate(state.daily.date) + '.';
      state.runId = null;
      state.advancing = false;
      await Promise.all([loadDailyMiniRanking(), loadProfile(true)]);
      return;
    }
    const button = $('#daily-next');
    button.disabled = true;
    try {
      const result = await api('/daily/next', {
        method: 'POST',
        body: { guestId: state.guestId, runId: state.runId, index }
      });
      updateQuestion(result.question, result.index);
      setDailySection('daily-play');
      startDailyTimer(result.seconds || 25);
      $('#daily-answer').focus();
    } catch (error) {
      toast(error.message);
      if (error.status === 404 || error.status === 409) setDailySection('daily-locked');
    } finally { button.disabled = false; state.advancing = false; }
  }
  async function useDailyHint() {
    if (!state.runId || !state.question || state.hintUsed) return;
    $('#daily-hint').disabled = true;
    try {
      const result = await api('/daily/hint', { method: 'POST', body: { guestId: state.guestId, runId: state.runId } });
      state.hintUsed = true;
      $('#hint-counter').textContent = '0 / 1';
      $('#hint-box').hidden = false;
      $('#hint-box').textContent = 'Examples: ' + (result.examples || []).join(' · ');
    } catch (error) { toast(error.message); $('#daily-hint').disabled = false; }
  }
  async function loadArchive() {
    try {
      const result = await api('/daily/archive');
      const listHtml = result.entries.length
        ? result.entries.slice(0, 10).map(entry => '<button class="archive-date" type="button" data-archive-date="' + esc(entry.date) + '">' + esc(fmtDate(entry.date)) + '</button>').join('')
        : '<span class="archive-loading">Your first archived edition will appear tomorrow.</span>';
      $('#archive-list').innerHTML = listHtml;
      $('#archive-modal-list').innerHTML = result.entries.map(entry =>
        '<button class="archive-date" type="button" data-archive-date="' + esc(entry.date) + '">' + esc(fmtDate(entry.date)) + '</button>'
      ).join('') || '<span class="archive-loading">No past editions yet.</span>';
    } catch (_) {
      $('#archive-list').innerHTML = '<span class="archive-loading">The archive is temporarily unavailable.</span>';
      $('#archive-modal-list').textContent = 'The archive is temporarily unavailable.';
    }
  }
  async function openArchiveEdition(date) {
    try {
      const result = await api('/daily/archive/' + encodeURIComponent(date));
      state.practice = { date: result.date, questions: result.questions || [], index: 0, finished: false };
      renderPractice();
      openModal('archive-modal');
    } catch (error) { toast(error.message); }
  }
  function renderPractice() {
    const practice = state.practice;
    const wrap = $('#archive-practice');
    if (!practice) { wrap.hidden = true; return; }
    wrap.hidden = false;
    if (practice.finished) {
      $('#practice-date').textContent = 'Practice complete · ' + fmtDate(practice.date);
      $('#practice-questions').innerHTML = '<p class="question-note">You revisited all seven questions. Practice never affects official rankings.</p><button class="button button-outline" id="practice-close" type="button">Back to archive</button>';
      return;
    }
    const question = practice.questions[practice.index];
    $('#practice-date').textContent = fmtDate(practice.date) + ' · Question ' + (practice.index + 1) + ' of ' + practice.questions.length;
    $('#practice-questions').innerHTML =
      '<div class="practice-question"><span class="micro-label">' + esc(question.category) + '</span>' +
      '<strong>' + esc(question.prompt) + '</strong><p>' + esc(question.note || '') + '</p>' +
      '<form class="answer-form" id="practice-form"><label class="visually-hidden" for="practice-answer">Your answer</label>' +
      '<input id="practice-answer" maxlength="80" autocomplete="off" placeholder="Try an answer…" required>' +
      '<button class="button button-primary" type="submit">Check</button></form>' +
      '<p id="practice-feedback" class="answer-feedback"></p><div id="practice-approved" class="answer-sheet-list"></div>' +
      '<button class="button button-outline" id="practice-next" type="button" disabled>' +
      (practice.index === practice.questions.length - 1 ? 'Finish practice' : 'Next question →') + '</button></div>';
    $('#practice-form').addEventListener('submit', event => {
      event.preventDefault();
      const value = $('#practice-answer').value;
      const entry = question.answers.find(item =>
        [item.answer].concat(item.aliases || []).some(alias => norm(alias) === norm(value))
      );
      if (!entry) {
        $('#practice-feedback').textContent = 'Not in the approved answers for this edition. Try another.';
        $('#practice-feedback').classList.remove('success');
        $('#practice-answer').select();
        return;
      }
      $('#practice-feedback').textContent = 'Correct — ' + entry.answer + ' is an approved answer.';
      $('#practice-feedback').classList.add('success');
      $('#practice-approved').innerHTML = '<span class="answer-chip">' + esc(entry.answer) + ' <b>' + number.format(entry.points) + ' pts</b></span>';
      $('#practice-next').disabled = false;
      playTone('success');
    });
    $('#practice-next').addEventListener('click', () => {
      practice.index += 1;
      if (practice.index >= practice.questions.length) practice.finished = true;
      renderPractice();
    });
  }

  function renderMiniRanking(target, entries) {
    const el = $(target);
    if (!entries || !entries.length) {
      el.innerHTML = '<p class="empty-room-note">No ranked results yet.</p>';
      return;
    }
    el.innerHTML = entries.slice(0, 5).map(row =>
      '<div class="mini-rank-row"><span class="mini-rank-number">' + String(row.rank).padStart(2, '0') +
      '</span><span class="mini-rank-name">' + esc(row.username || 'Explorer') +
      '</span><span class="mini-rank-score">' + number.format(row.score || row.rating || 0) + '</span></div>'
    ).join('');
  }
  async function loadPartyMiniRanking() {
    try { const result = await api('/leaderboards/party'); renderMiniRanking('#party-mini-ranking', result.entries || []); }
    catch (_) { $('#party-mini-ranking').innerHTML = '<p class="empty-room-note">Globe Rush rankings are unavailable.</p>'; }
  }
  function loadSeason() {
    const now = new Date();
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
    $('#season-title').textContent = 'Season ' + quarter + ' · ' + now.getUTCFullYear();
    $('#season-number').textContent = 'Q' + quarter;
    $('#season-rating').textContent = state.player ? number.format(state.player.partyRating || 1000) : '1000';
  }
  async function loadRankings(period) {
    state.currentRanking = period || 'daily';
    $$('.ranking-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.period === state.currentRanking));
    const table = $('#rankings-table');
    table.innerHTML = '<div class="empty-room-note">Loading the rankings…</div>';
    try {
      const result = await api(state.currentRanking === 'party'
        ? '/leaderboards/party'
        : '/leaderboards/global?period=' + encodeURIComponent(state.currentRanking));
      const entries = result.entries || [];
      if (!entries.length) { table.innerHTML = '<div class="empty-room-note">No ranked scores have been recorded for this period yet.</div>'; return; }
      const party = state.currentRanking === 'party';
      const country = state.currentRanking === 'country';
      let html = '<div class="ranking-row header"><span>RANK</span><span>' + (country ? 'COUNTRY' : 'EXPLORER') +
        '</span><span>' + (party ? 'RATING' : 'GAMES') + '</span><span>' + (party ? 'POINTS' : 'SCORE') + '</span></div>';
      entries.forEach(row => {
        const name = country ? row.country : row.username || 'Explorer';
        html += '<div class="ranking-row"><span class="rank-number">' + String(row.rank).padStart(2, '0') +
          '</span><span class="rank-player"><span class="rank-player-avatar">' + esc(name.slice(0,1).toUpperCase()) +
          '</span>' + esc(name) + '</span><span>' + number.format(party ? row.rating || 1000 : row.games || 0) +
          '</span><span>' + number.format(row.score || 0) + '</span></div>';
      });
      table.innerHTML = html;
    } catch (error) { table.innerHTML = '<div class="empty-room-note">' + esc(error.message) + '</div>'; }
  }

  async function loadAuthProviders() {
    const googleButton = $('#google-signin');
    const discordButton = $('#discord-signin');
    const buttons = $('#oauth-buttons');
    const divider = $('#oauth-divider');
    const note = $('#oauth-config-note');
    try {
      const result = await api('/config');
      const google = Boolean(result.auth && result.auth.google);
      const discord = Boolean(result.auth && result.auth.discord);
      googleButton.hidden = !google;
      discordButton.hidden = !discord;
      buttons.hidden = !google && !discord;
      divider.hidden = !google && !discord;
      note.hidden = google || discord;
    } catch (_) {
      googleButton.hidden = true;
      discordButton.hidden = true;
      buttons.hidden = true;
      divider.hidden = true;
      note.hidden = false;
      note.textContent = 'Third-party sign-in is unavailable right now. Username and password sign-in still works.';
    }
  }

  function setAccountUI(player) {
    state.player = player || null;
    if (!player) {
      $('#account-avatar').textContent = '?';
      $('#account-label').textContent = 'Sign in';
      $('#admin-open').hidden = true;
      $('#streak-number').textContent = '— days';
      return;
    }
    $('#account-avatar').textContent = (player.username || 'E').slice(0,1).toUpperCase();
    $('#account-label').textContent = player.username;
    $('#profile-avatar').textContent = (player.username || 'E').slice(0,1).toUpperCase();
    $('#profile-name').textContent = player.username;
    $('#profile-email').textContent = player.email || 'HUMANITY Explorer';
    $('#profile-stats').innerHTML =
      '<div><span>LEVEL</span><b>' + number.format(player.level || 1) + '</b></div>' +
      '<div><span>XP</span><b>' + number.format(player.xp || 0) + '</b></div>' +
      '<div><span>RATING</span><b>' + number.format(player.partyRating || 1000) + '</b></div>';
    $('#streak-number').textContent = number.format(player.dailyStreak || 0) + ' days';
    $('#admin-open').hidden = !player.isAdmin;
  }
  async function loadProfile(silent) {
    if (!state.token) { setAccountUI(null); return null; }
    try {
      const result = await api('/profile/me');
      setAccountUI(result.player);
      return result;
    } catch (_) {
      state.token = '';
      localStorage.removeItem('humanity-session-token');
      setAccountUI(null);
      if (!silent) toast('Your session expired. Please sign in again.');
      return null;
    }
  }
  function saveSession(token, player) {
    state.token = token;
    localStorage.setItem('humanity-session-token', token);
    if (player) {
      setAccountUI(player);
      if ($('#party-display-name')) $('#party-display-name').value = player.username;
    }
  }
  function setAuthMode(mode) {
    state.authMode = mode === 'register' ? 'register' : 'login';
    const register = state.authMode === 'register';
    $$('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.authTab === state.authMode));
    $('#account-modal-title').textContent = register ? 'Join the explorers.' : 'Welcome, explorer.';
    $('#register-fields').hidden = !register;
    $('#auth-username-label').textContent = 'Username or email';
    $('#auth-username').hidden = register;
    $('#auth-submit').textContent = register ? 'Create free account' : 'Sign in';
    $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
    $('#auth-feedback').textContent = '';
  }
  async function submitAuth(event) {
    event.preventDefault();
    const register = state.authMode === 'register';
    const body = register
      ? { username: $('#auth-new-username').value.trim(), email: $('#auth-email').value.trim(), password: $('#auth-password').value }
      : { identifier: $('#auth-username').value.trim(), password: $('#auth-password').value };
    $('#auth-submit').disabled = true;
    $('#auth-feedback').textContent = '';
    try {
      const result = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body });
      saveSession(result.token, result.player);
      $('#auth-form').reset();
      closeModal('account-modal');
      await loadProfile(true);
      toast('Welcome to HUMANITY, ' + result.player.username + '.');
    } catch (error) { $('#auth-feedback').textContent = error.message; }
    finally { $('#auth-submit').disabled = false; }
  }
  async function signOut() {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch (_) {}
    state.token = '';
    localStorage.removeItem('humanity-session-token');
    setAccountUI(null);
    closeModal('account-modal');
    toast('You are signed out.');
  }
  async function showAccount() {
    if (state.token) {
      await loadProfile();
      $('#account-signed-out').hidden = true;
      $('#account-signed-in').hidden = !state.player;
    } else {
      $('#account-signed-out').hidden = false;
      $('#account-signed-in').hidden = true;
      setAuthMode('login');
    }
    openModal('account-modal');
  }

  function connectSocket(action) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) { sendSocket(action); return; }
    if (state.ws && state.ws.readyState === WebSocket.CONNECTING) { state.wsPending = action; return; }
    state.wsPending = action;
    const socket = new WebSocket(SOCKET_URL);
    state.ws = socket;
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch (_) { return; }
      handleSocketMessage(message);
    });
    socket.addEventListener('close', () => {
      state.ws = null;
      if (state.room && !$('#party-room').hidden) toast('Your live connection closed. Join the room again.');
    });
    socket.addEventListener('error', () => toast('Could not connect to Globe Rush. Please try again.'));
  }
  function sendSocket(message) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) { state.wsPending = message; return; }
    state.ws.send(JSON.stringify(message));
  }
  function handleSocketMessage(message) {
    if (message.type === 'connected') {
      if (state.wsPending) { const pending = state.wsPending; state.wsPending = null; sendSocket(pending); }
    } else if (message.type === 'joined') {
      state.roomCode = message.roomCode;
      state.playerId = message.playerId;
      $('#room-code-display').textContent = message.roomCode;
      $('#planet-room-code').textContent = message.roomCode;
      $('#party-lobby').hidden = true;
      $('#party-room').hidden = false;
      $('#room-lobby-state').hidden = false;
      $('#room-game-state').hidden = true;
      $('#room-results-state').hidden = true;
      $('#party-room').scrollIntoView({ behavior: state.animations ? 'smooth' : 'auto', block: 'start' });
    } else if (message.type === 'room_state') {
      state.room = message;
      renderRoomState(message);
    } else if (message.type === 'timer') {
      updatePartyTimer(message.remainingMs, message.holderId, message.durationMs);
    } else if (message.type === 'answer_accepted') {
      $('#rush-feedback').textContent = message.nickname + ' named ' + message.answer + ' · ' + message.level +
        ' · +' + message.points + ' Discovery Points' + (message.gainedHeart ? ' · +1 Stability Point!' : '');
      $('#rush-feedback').classList.add('success');
      playTone('success');
    } else if (message.type === 'orb_overload') {
      $('#orb-stage').classList.add('overload');
      setTimeout(() => $('#orb-stage').classList.remove('overload'), 500);
      $('#rush-feedback').textContent = message.nickname + ' held the Atlas Orb when it overloaded.' +
        (message.eliminated ? ' Eliminated.' : ' One Stability Point lost.');
      $('#rush-feedback').classList.remove('success');
      playTone('overload');
    } else if (message.type === 'new_round') {
      const reason = message.reason === 'mistakes'
        ? 'Two incorrect answers · new category'
        : message.reason === 'turn_limit'
          ? 'Ten accepted turns · new category'
          : message.reason === 'overload'
            ? 'The Orb overloaded · new category'
            : 'New category';
      $('#rush-feedback').textContent = reason + ' · ' + message.category.title;
      $('#rush-feedback').classList.remove('success');
    } else if (message.type === 'match_ready') {
      $('#room-status-note').textContent = 'Match begins in a few seconds…';
    } else if (message.type === 'room_chat') {
      renderRoomChatMessage(message);
    } else if (message.type === 'game_over') {
      state.result = message.results;
      renderPartyResults(message.results);
    } else if (message.type === 'error') {
      $('#rush-feedback').textContent = message.message || 'That action could not be completed.';
      $('#rush-feedback').classList.remove('success');
      if (message.code !== 'category_changed') toast(message.message || 'Globe Rush action failed.');
    } else if (message.type === 'room_closed' || message.type === 'removed') {
      resetRoomUI();
      toast(message.message || 'This room is no longer available.');
    }
  }
  function renderRoomChat(messages) {
    const log = $('#room-chat-log');
    if (!log) return;
    const rows = Array.isArray(messages) ? messages.slice(-30) : [];
    log.innerHTML = rows.map(item => {
      const time = new Date(Number(item.createdAt) || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return '<div class="planet-chat-entry"><span>' + esc(time) + '</span><b>' + esc(item.nickname || 'Explorer') +
        '</b><p>' + esc(item.text || '') + '</p></div>';
    }).join('') || '<div class="planet-chat-empty">Send a message while the others join.</div>';
    log.scrollTop = log.scrollHeight;
  }
  function renderRoomChatMessage(message) {
    if (!state.room) return;
    const history = Array.isArray(state.room.chatMessages) ? state.room.chatMessages : [];
    state.room.chatMessages = [...history, message].slice(-30);
    renderRoomChat(state.room.chatMessages);
  }
  function renderRoomState(room) {
    const lobby = room.phase === 'lobby';
    const playing = room.phase === 'playing';
    const finished = room.phase === 'finished';
    $('#room-lobby-state').hidden = !lobby;
    $('#room-game-state').hidden = !playing;
    $('#room-results-state').hidden = !finished;
    const capacity = Math.max(2, Math.min(10, Number(room.capacity || room.players.length)));
    const hostIsYou = room.players.some(player => player.isYou && player.isHost);
    $('#room-status-label').textContent = lobby ? 'ROOM OPEN · READY TO EXPLORE' : 'GLOBE RUSH · ' + (playing ? 'IN PROGRESS' : 'RESULTS');
    $('#lobby-seat-count').textContent = room.players.length + ' / ' + capacity + ' PLAYERS';
    $('#planet-room-code').textContent = room.code;
    $('#planet-capacity').textContent = 'UP TO ' + capacity;
    $('#room-status-note').textContent = lobby
      ? room.players.length + ' of ' + capacity + ' explorers aboard · Invite friends with this room code.'
      : room.players.length + ' explorers on this mission.';
    const seats = Array.from({ length: capacity }, (_, index) => {
      const player = room.players[index];
      const hue = (index * 47 + 166) % 360;
      const seatClass = 'planet-seat' + (player ? ' occupied' : ' open') + (player && player.isYou ? ' is-you' : '');
      const name = player ? esc(player.nickname) : 'OPEN SLOT';
      const status = player
        ? (player.isHost ? 'HOST' : 'EXPLORER') + ' · ' + (player.isConnected ? 'ONLINE' : 'RECONNECTING')
        : 'AWAITING PLAYER';
      return '<div class="' + seatClass + '" style="--sprite-hue:' + hue + 'deg">' +
        '<span class="planet-seat-avatar" aria-hidden="true"><i></i><b></b><em></em></span>' +
        '<span class="planet-seat-platform" aria-hidden="true"></span>' +
        '<span class="planet-seat-name">' + name + '</span>' +
        '<span class="planet-seat-status">' + status + '</span>' +
        '</div>';
    }).join('');
    $('#room-lobby-players').innerHTML = seats;
    $('#planet-roster-count').textContent = room.players.length + ' ONLINE';
    $('#planet-player-roster').innerHTML = room.players.map(player =>
      '<div class="planet-roster-row ' + (player.isYou ? 'is-you' : '') + '">' +
      '<span class="planet-roster-dot"></span><span class="planet-roster-name">' + esc(player.nickname) + '</span>' +
      '<small>' + (player.isHost ? 'HOST' : (player.isConnected ? 'ONLINE' : 'OFFLINE')) + '</small></div>'
    ).join('') || '<div class="planet-roster-empty">Waiting for explorers…</div>';
    $('#room-start').hidden = !lobby || !hostIsYou;
    $('#room-start').disabled = room.players.length < 2;
    $('#room-start').textContent = room.players.length < 2 ? 'WAITING FOR YOUR CREW' : 'START GLOBE RUSH';
    renderRoomChat(room.chatMessages || []);
    if (playing && room.category) {
      $('#rush-round').textContent = String(room.round).padStart(2, '0');
      $('#rush-turn').textContent = String(room.turnNumber || 1).padStart(2, '0');
      $('#rush-category').textContent = room.category.prompt || room.category.title;
      $('#rush-note').textContent = 'New category after 2 incorrect answers or 10 accepted turns. ' +
        (room.category.note || 'Answers can only be used once per category.');
      const wrongCount = Math.max(0, Number(room.wrongAnswersThisCategory || 0));
      const turnCount = Math.max(0, Number(room.turnsThisCategory || 0));
      const wrongLimit = Math.max(1, Number(room.maxWrongAnswersPerCategory || 2));
      const turnLimit = Math.max(1, Number(room.maxTurnsPerCategory || 10));
      $('#category-cycle').innerHTML =
        '<div class="category-cycle-stat"><span>WRONG ANSWERS</span><b>' + wrongCount + ' / ' + wrongLimit +
        '</b><i><span style="width:' + Math.min(100, wrongCount / wrongLimit * 100) + '%"></span></i></div>' +
        '<div class="category-cycle-stat"><span>ACCEPTED TURNS</span><b>' + turnCount + ' / ' + turnLimit +
        '</b><i><span style="width:' + Math.min(100, turnCount / turnLimit * 100) + '%"></span></i></div>';
      $('#used-answer-list').innerHTML = room.usedAnswers.length
        ? room.usedAnswers.map(answer => '<span class="used-answer-chip">' + esc(answer) + '</span>').join('')
        : '<span class="empty-used">No answers yet.</span>';
      $('#rush-player-list').innerHTML = room.players.map(player =>
        '<div class="rush-player-row ' + (player.isHolder ? 'current' : '') + ' ' + (!player.alive ? 'out' : '') + '">' +
        '<span class="rush-player-name"><b>' + (player.isHolder ? '● ' : '') + esc(player.nickname) + (player.isYou ? ' (you)' : '') + '</b>' +
        '<small>' + number.format(player.turnsTaken || 0) + ' turns · ' + number.format(player.answersGiven || 0) + ' valid answers</small></span>' +
        '<span class="rush-player-hearts">' + '♥'.repeat(player.hearts) + '♡'.repeat(Math.max(0,3-player.hearts)) + '</span>' +
        '<span class="rush-player-score">' + number.format(player.score) + '</span></div>'
      ).join('');
      const me = room.players.find(player => player.isYou);
      const holding = Boolean(me && me.isHolder && me.alive);
      $('#rush-answer-area').hidden = !holding;
      const holder = room.players.find(player => player.id === room.currentHolderId);
      $('#orb-holder-label').textContent = holder ? 'THE ORB IS WITH ' + holder.nickname.toUpperCase() : 'THE ORB IS MOVING';
      $('#rush-answer').disabled = !holding;
      if (!holding) $('#rush-answer').value = '';
      if (room.timerRemainingMs !== null) updatePartyTimer(room.timerRemainingMs, room.currentHolderId, room.timerDurationMs);
    }
    if (finished && state.result) renderPartyResults(state.result);
  }
  function updatePartyTimer(remainingMs, holderId, durationMs) {
    const remaining = Math.max(0, Number(remainingMs || 0));
    const duration = Math.max(1, Number(durationMs || state.room?.timerDurationMs || 12000));
    const seconds = Math.ceil(remaining / 1000);
    const progress = Math.max(0, Math.min(100, (remaining / duration) * 100));
    $('#rush-seconds').textContent = String(seconds);
    $('#rush-timer-fill').style.width = progress + '%';
    $('#rush-timer').classList.toggle('urgent', seconds <= 4);
    const holder = state.room && state.room.players.find(player => player.id === holderId);
    if (holder) {
      $('#rush-timer-label').textContent = holder.isYou ? 'YOUR TURN' : 'PLAYER TURN';
      $('#orb-holder-label').textContent = holder.isYou
        ? 'THE ORB IS WITH YOU'
        : 'THE ORB IS WITH ' + holder.nickname.toUpperCase();
    }
  }
  function renderPartyResults(results) {
    if (!results) return;
    $('#room-lobby-state').hidden = true;
    $('#room-game-state').hidden = true;
    $('#room-results-state').hidden = false;
    $('#rush-winner').textContent = results.winner + ' wins!';
    $('#rush-final-ranking').innerHTML = results.ranking.map(row =>
      '<div class="final-ranking-row ' + (row.isWinner ? 'winner' : '') + '">' +
      '<span>' + String(row.rank).padStart(2, '0') + '</span><strong>' + esc(row.nickname) +
      '</strong><b>' + number.format(row.score) + ' pts</b><small>' + '♥'.repeat(row.hearts) + '</small></div>'
    ).join('');
    $('#room-rematch').hidden = !(state.room && state.room.players.some(player => player.isYou && player.isHost));
    loadPartyMiniRanking();
  }
  function resetRoomUI() {
    state.room = null; state.roomCode = null; state.playerId = null; state.result = null;
    $('#party-room').hidden = true;
    $('#party-lobby').hidden = false;
    if (state.ws) { try { state.ws.close(); } catch (_) {} }
    state.ws = null;
    loadOpenRooms();
  }
  function nickname() {
    if (state.player) return state.player.username;
    let value = ($('#party-display-name') && $('#party-display-name').value.trim()) || localStorage.getItem('humanity-display-name') || '';
    if (!value) {
      value = 'Explorer-' + String(Math.floor(1000 + Math.random() * 9000));
      localStorage.setItem('humanity-display-name', value);
    }
    if ($('#party-display-name')) $('#party-display-name').value = value;
    return value;
  }
  function queueMatch(mode, group) {
    if (mode === 'ranked' && !state.token) {
      toast('Sign in with a free account to play Ranked.');
      showAccount();
      return;
    }
    connectSocket({
      type: mode === 'ranked' ? 'ranked_queue' : 'quick_play',
      mode, group, nickname: nickname(), token: state.token || undefined
    });
  }
  function loadOpenRooms() {
    api('/party/rooms').then(result => {
      const list = $('#open-rooms-list');
      if (!result.rooms.length) {
        list.innerHTML = '<div class="empty-room-note">No public rooms right now. Start Quick Play or host a private room.</div>';
        return;
      }
      list.innerHTML = result.rooms.map(room =>
        '<div class="public-room-row"><div><strong>' + esc(room.code) + '</strong><small>' +
        esc(room.group) + ' · ' + room.players + '/' + room.capacity + ' explorers</small></div>' +
        '<button type="button" data-join-room="' + esc(room.code) + '">Join ↗</button></div>'
      ).join('');
    }).catch(() => { $('#open-rooms-list').innerHTML = '<div class="empty-room-note">Open rooms are temporarily unavailable.</div>'; });
  }
  async function loadAdmin() {
    if (!state.player || !state.player.isAdmin) return;
    try {
      const results = await Promise.all([api('/admin/overview'), api('/admin/review-queue')]);
      const stats = results[0].stats;
      $('#admin-stats').innerHTML =
        '<div><span>PLAYERS</span><b>' + number.format(stats.players) + '</b></div>' +
        '<div><span>DAILY EDITIONS</span><b>' + number.format(stats.dailyEditions) + '</b></div>' +
        '<div><span>PENDING ANSWERS</span><b>' + number.format(stats.pendingAnswers) + '</b></div>' +
        '<div><span>FINISHED MATCHES</span><b>' + number.format(stats.finishedMatches) + '</b></div>';
      const entries = results[1].entries || [];
      $('#admin-queue').innerHTML = entries.length ? entries.map(item =>
        '<div class="admin-queue-item"><div><strong>' + esc(item.answer_text) + ' <span class="micro-label">×' +
        item.occurrences + '</span></strong><small>' + esc(item.question_prompt) + '</small></div>' +
        '<div class="admin-queue-actions"><button class="approve" data-review-id="' + item.id +
        '" data-review-action="approve" type="button">Approve</button><button data-review-id="' + item.id +
        '" data-review-action="reject" type="button">Reject</button></div></div>'
      ).join('') : '<p class="empty-room-note">The review queue is clear.</p>';
    } catch (error) { $('#admin-queue').textContent = error.message; }
  }
  async function loadFriends() {
    try {
      const result = await api('/friends');
      const friends = result.friends || [];
      $('#friend-list').innerHTML = friends.length ? friends.map(friend =>
        '<div class="friend-row"><span>' + esc(friend.username) + ' · ' + esc(friend.status) + '</span>' +
        (friend.status === 'pending' && !friend.sent_by_you
          ? '<button type="button" data-friend-response="' + esc(friend.id) + '" data-accept="true">Accept</button>' : '') +
        '</div>'
      ).join('') : '<p class="empty-room-note">No friends yet. Add an explorer by username.</p>';
    } catch (error) { $('#friend-list').textContent = error.message; }
  }
  async function addFriend(event) {
    event.preventDefault();
    const username = $('#friend-username').value.trim();
    if (!username) return;
    try {
      await api('/friends/request', { method: 'POST', body: { username } });
      $('#friend-username').value = '';
      toast('Friend request sent.');
      loadFriends();
    } catch (error) { toast(error.message); }
  }

  function initEvents() {
    $$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    $('#daily-start').addEventListener('click', startDaily);
    $('#daily-answer-form').addEventListener('submit', submitDailyAnswer);
    $('#daily-next').addEventListener('click', nextDailyQuestion);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.repeat) return;
      const dailyView = $('[data-view-panel="daily"]');
      const resultPanel = $('#daily-result');
      const nextButton = $('#daily-next');
      if (!dailyView || dailyView.hidden || !resultPanel || resultPanel.hidden ||
          state.pendingNextIndex === null || event.target !== nextButton) return;
      event.preventDefault();
      nextDailyQuestion();
    });
    $('#daily-hint').addEventListener('click', useDailyHint);
    $('#daily-share').addEventListener('click', async () => {
      const text = 'I completed today’s HUMANITY Atlas Daily with ' + $('#complete-score').textContent + ' provisional Discovery Points.';
      try {
        if (navigator.share) await navigator.share({ title: 'HUMANITY Atlas Daily', text, url: location.href });
        else { await navigator.clipboard.writeText(text); toast('Your result was copied.'); }
      } catch (_) {}
    });
    $('#party-display-name').addEventListener('change', event => {
      const value = event.target.value.trim();
      if (value.length < 2 || value.length > 18) { toast('Display names must be 2–18 characters.'); return; }
      localStorage.setItem('humanity-display-name', value);
    });
    $('#quick-play').addEventListener('click', () => queueMatch('quick', $('#quick-group').value));
    $('#ranked-play').addEventListener('click', () => queueMatch('ranked', $('#ranked-group').value));
    $('#create-room-form').addEventListener('submit', event => {
      event.preventDefault();
      connectSocket({ type: 'create_room', visibility: 'private', mode: 'private', capacity: Number($('#private-capacity').value || 10), nickname: nickname(), token: state.token || undefined });
    });
    $('#join-room-form').addEventListener('submit', event => { event.preventDefault(); joinRoom($('#join-code').value); });
    $('#refresh-rooms').addEventListener('click', loadOpenRooms);
    $('#open-archive-from-lock').addEventListener('click', () => { loadArchive(); openModal('archive-modal'); });
    $('#archive-open').addEventListener('click', () => { loadArchive(); openModal('archive-modal'); });
    $('#archive-list').addEventListener('click', event => {
      const button = event.target.closest('[data-archive-date]');
      if (button) openArchiveEdition(button.dataset.archiveDate);
    });
    $('#archive-modal-list').addEventListener('click', event => {
      const button = event.target.closest('[data-archive-date]');
      if (button) openArchiveEdition(button.dataset.archiveDate);
    });
    $('#archive-practice').addEventListener('click', event => {
      if (event.target.closest('#practice-close')) { state.practice = null; $('#archive-practice').hidden = true; }
    });
    $('#account-open').addEventListener('click', showAccount);
    $('#ranking-account-open').addEventListener('click', showAccount);
    $('#auth-form').addEventListener('submit', submitAuth);
    $$('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab)));
    $('#google-signin').addEventListener('click', () => { location.href = API + '/auth/google'; });
    $('#discord-signin').addEventListener('click', () => { location.href = API + '/auth/discord'; });
    $('#signout').addEventListener('click', signOut);
    $('#friends-open').addEventListener('click', () => { closeModal('account-modal'); openModal('friends-modal'); loadFriends(); });
    $('#friend-add-form').addEventListener('submit', addFriend);
    $('#friend-list').addEventListener('click', async event => {
      const button = event.target.closest('[data-friend-response]');
      if (!button) return;
      try {
        await api('/friends/respond', { method: 'POST', body: { playerId: button.dataset.friendResponse, accept: button.dataset.accept === 'true' } });
        loadFriends();
      } catch (error) { toast(error.message); }
    });
    $('#admin-open').addEventListener('click', () => { closeModal('account-modal'); openModal('admin-modal'); loadAdmin(); });
    $('#admin-refresh').addEventListener('click', loadAdmin);
    $('#admin-queue').addEventListener('click', async event => {
      const button = event.target.closest('[data-review-id]');
      if (!button) return;
      button.disabled = true;
      try {
        await api('/admin/review/' + button.dataset.reviewId, { method: 'POST', body: { action: button.dataset.reviewAction } });
        loadAdmin();
      } catch (error) { toast(error.message); button.disabled = false; }
    });
    $('#settings-open').addEventListener('click', () => { setSettings(); openModal('settings-modal'); });
    $('#setting-sound').addEventListener('change', event => {
      state.sounds = event.target.checked;
      localStorage.setItem('humanity-sound', String(state.sounds));
      playTone('success');
    });
    $('#setting-motion').addEventListener('change', event => {
      state.animations = event.target.checked;
      localStorage.setItem('humanity-motion', String(state.animations));
      setSettings();
    });
    $('#leave-room').addEventListener('click', () => { sendSocket({ type: 'leave_room' }); resetRoomUI(); });
    $('#room-chat-form').addEventListener('submit', event => {
      event.preventDefault();
      const input = $('#room-chat-input');
      const message = input.value.trim();
      if (!message) return;
      sendSocket({ type: 'chat_message', text: message });
      input.value = '';
    });
    $('#copy-room-code').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(state.roomCode || ''); toast('Room code copied.'); }
      catch (_) { toast('Room code: ' + state.roomCode); }
    });
    $('#room-start').addEventListener('click', () => sendSocket({ type: 'start_game' }));
    $('#room-rematch').addEventListener('click', () => sendSocket({ type: 'rematch' }));
    $('#rush-answer-form').addEventListener('submit', event => {
      event.preventDefault();
      const answer = $('#rush-answer').value.trim();
      if (!answer) return;
      sendSocket({ type: 'submit_answer', answer });
      $('#rush-answer').value = '';
    });
    $('#open-rooms-list').addEventListener('click', event => {
      const button = event.target.closest('[data-join-room]');
      if (button) joinRoom(button.dataset.joinRoom);
    });
    $('#ranking-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-period]');
      if (button) loadRankings(button.dataset.period);
    });
    $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
    $$('dialog.modal').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
  }
  function joinRoom(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(clean)) { toast('Enter a valid six-character room code.'); return; }
    connectSocket({ type: 'join_room', code: clean, nickname: nickname(), token: state.token || undefined });
  }
  async function bootstrap() {
    const params = new URLSearchParams(location.search);
    const oauthToken = params.get('session');
    if (oauthToken) {
      state.token = oauthToken;
      localStorage.setItem('humanity-session-token', oauthToken);
      history.replaceState(null, '', location.pathname + location.hash);
    }
    setSettings();
    if ($('#party-display-name')) $('#party-display-name').value = localStorage.getItem('humanity-display-name') || '';
    initEvents();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    await Promise.all([loadAuthProviders(), loadProfile(true)]);
    await loadDaily();
    if (location.hash === '#party') setView('party');
    else if (location.hash === '#rankings') setView('rankings');
    else setView('daily');
    if (state.player) {
      $('#account-signed-out').hidden = true;
      $('#account-signed-in').hidden = false;
    }
    if (oauthToken) toast('You are signed in to HUMANITY.');
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
