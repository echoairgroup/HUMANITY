'use strict';

(() => {
  const API = 'https://humanity-api-jyk5.onrender.com/api';
  const SOCKET_URL = 'wss://humanity-api-jyk5.onrender.com/api/party';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const number = new Intl.NumberFormat('en-US');
  const soundBoostMigrationKey = 'humanity-sound-volume-boost-v1';
  if (localStorage.getItem(soundBoostMigrationKey) !== 'done') {
    const savedSoundVolumeValue = localStorage.getItem('humanity-sound-volume');
    const savedSoundVolume = Number(savedSoundVolumeValue);
    if (savedSoundVolumeValue === null || !Number.isFinite(savedSoundVolume) || savedSoundVolume === 68) {
      localStorage.setItem('humanity-sound-volume', '92');
    }
    localStorage.setItem(soundBoostMigrationKey, 'done');
  }
  const PLANET_AVATARS = [
    { id: 'mercury', name: 'Mercury', streak: 0 },
    { id: 'venus', name: 'Venus', streak: 3 },
    { id: 'earth', name: 'Earth', streak: 7 },
    { id: 'mars', name: 'Mars', streak: 14 },
    { id: 'jupiter', name: 'Jupiter', streak: 30 },
    { id: 'saturn', name: 'Saturn', streak: 60 },
    { id: 'uranus', name: 'Uranus', streak: 90 },
    { id: 'neptune', name: 'Neptune', streak: 150 }
  ];
  const state = {
    token: localStorage.getItem('humanity-session-token') || '',
    player: null, guestId: getGuestId(), daily: null, runId: null,
    questionIndex: 0, question: null, pendingNextIndex: null,
    provisionalScore: 0, timer: null, secondsLeft: 25, dailyDeadlineAt: 0,
    dailySubmitting: false, dailyExpiryPending: false, hintUsed: false,
    ws: null, wsPending: null, room: null, roomCode: null, playerId: null,
    resumeToken: sessionStorage.getItem('humanity-room-resume-token') || '',
    reconnectAttempts: 0, reconnectTimer: null, isLeavingRoom: false, profileStats: null,
    wsHeartbeatTimer: null, wsHeartbeatSocket: null,
    result: null, currentRanking: 'daily', authMode: 'login', practice: null, unlimited: null,
    dailyResumeAvailable: false,
    dailyHistory: [], lastPracticeLabel: '', ascentPoints: 0, ascentMaxPoints: 700,
    suggestionTimer: null, suggestionSequence: 0, pendingSuggestion: null,
    dailyAdvanceTimer: null,
    partySuggestionTimer: null, partySuggestionSequence: 0, pendingPartySuggestion: null,
    roomLaunchTimer: null,
    toastTimer: null, categoryAnnouncementTimer: null, categoryAnnouncementDelayTimer: null,
    orbOverloadTimer: null, onlineRefreshTimer: null,
    sounds: localStorage.getItem('humanity-sound') !== 'false',
    soundVolume: Math.max(0, Math.min(100, Number(localStorage.getItem('humanity-sound-volume') || 92))),
    audioContext: null, audioMaster: null, audioNoiseBuffer: null,
    dailySoundMarks: [], rushSoundKey: '', rushSoundMarks: [],
    animations: localStorage.getItem('humanity-motion') !== 'false',
    currentView: 'daily', analyticsInitialView: false
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
  function updateNavigationIndicator() {
    const nav = $('.main-nav');
    const indicator = $('#nav-active-indicator');
    const active = $('.main-nav .nav-item.active');
    if (!nav || !indicator || !active) return;
    indicator.style.width = active.offsetWidth + 'px';
    indicator.style.height = active.offsetHeight + 'px';
    indicator.style.transform = 'translate3d(' + active.offsetLeft + 'px,' + active.offsetTop + 'px,0)';
    indicator.classList.add('ready');
  }

  function analyticsConsentGranted() {
    try { return localStorage.getItem('humanity-analytics-consent') === 'granted'; }
    catch (_) { return false; }
  }
  function analyticsVisitorId() {
    try {
      let id = localStorage.getItem('humanity-analytics-id');
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : 'humanity-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        localStorage.setItem('humanity-analytics-id', id);
      }
      return id;
    } catch (_) { return ''; }
  }
  function trackAnalytics(eventName, data = {}) {
    if (!analyticsConsentGranted()) return;
    const visitorId = analyticsVisitorId();
    if (!visitorId) return;
    const payload = {
      visitorId,
      eventName,
      page: String(data.view || state.currentView || 'daily')
    };
    ['game','mode','variant','pack','resumed','durationSeconds','success'].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(data,key)) payload.data = Object.assign({},payload.data,{[key]:data[key]});
    });
    fetch('https://humanity-api-jyk5.onrender.com/api/analytics/event', {
      method:'POST',
      mode:'cors',
      keepalive:true,
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }).catch(() => {});
  }

  function setView(view) {
    if (!['daily', 'party', 'rankings'].includes(view)) view = 'daily';
    const changedView = state.currentView !== view;
    state.currentView = view;
    if (!state.analyticsInitialView) {
      state.analyticsInitialView = true;
      trackAnalytics('page_view',{view});
    } else if (changedView) {
      trackAnalytics('view_change',{view});
    }
    $$('[data-view-panel]').forEach(panel => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    document.body.classList.add('globe-rush-active');
    requestAnimationFrame(updateNavigationIndicator);
    if (view === 'party') {
      loadOpenRooms(); loadPartyMiniRanking(); loadSeason(); loadOnlinePlayers();
      if (!state.onlineRefreshTimer) state.onlineRefreshTimer = window.setInterval(() => {
        if (!document.hidden) loadOnlinePlayers();
      }, 15000);
    } else if (state.onlineRefreshTimer) {
      window.clearInterval(state.onlineRefreshTimer);
      state.onlineRefreshTimer = null;
    }
    if (view === 'rankings') loadRankings(state.currentRanking);
    history.replaceState(null, '', '#' + view);
    window.scrollTo({ top: 0, behavior: state.animations ? 'smooth' : 'auto' });
  }
  function setSettings() {
    document.body.classList.toggle('reduce-motion', !state.animations);
    if ($('#setting-sound')) $('#setting-sound').checked = state.sounds;
    if ($('#setting-motion')) $('#setting-motion').checked = state.animations;
    const volume = $('#setting-sound-volume');
    const volumeLabel = $('#setting-sound-volume-label');
    if (volume) volume.value = String(state.soundVolume);
    if (volumeLabel) volumeLabel.textContent = state.soundVolume + '%';
  }
  function getAudioContext() {
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioClass) return null;
      if (!state.audioContext) {
        const context = new AudioClass();
        const master = context.createGain();
        const compressor = context.createDynamicsCompressor();
        master.gain.value = (state.soundVolume / 100) * 2.35;
        compressor.threshold.value = -9;
        compressor.knee.value = 14;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.22;
        master.connect(compressor);
        compressor.connect(context.destination);
        state.audioContext = context;
        state.audioMaster = master;
      }
      return state.audioContext;
    } catch (_) {
      return null;
    }
  }
  function unlockAudio() {
    if (!state.sounds || state.soundVolume <= 0) return;
    const context = getAudioContext();
    if (context && context.state === 'suspended') context.resume().catch(() => {});
  }
  function soundVoice(context, frequency, offset, duration, amplitude, waveform, glideTo) {
    const at = context.currentTime + Math.max(0, offset || 0);
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = waveform || 'sine';
    oscillator.frequency.setValueAtTime(Math.max(30, frequency), at);
    if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), at + duration * 0.82);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.min(0.105, Math.max(0.0002, amplitude || 0.025) * 1.55), at + Math.min(0.016, duration * 0.2));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope);
    envelope.connect(state.audioMaster);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.015);
  }
  function soundNoise(context, offset, duration, amplitude, cutoff) {
    if (!state.audioNoiseBuffer) {
      const length = Math.ceil(context.sampleRate * 0.34);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length * 0.35);
      state.audioNoiseBuffer = buffer;
    }
    const at = context.currentTime + Math.max(0, offset || 0);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = state.audioNoiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(180, cutoff || 2200), at);
    filter.Q.value = 0.65;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.min(0.105, Math.max(0.0002, amplitude || 0.018) * 1.55), at + Math.min(0.025, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(state.audioMaster);
    source.start(at);
    source.stop(at + duration + 0.01);
  }
  function playSound(name, options) {
    if (!state.sounds || state.soundVolume <= 0) return;
    const context = getAudioContext();
    if (!context || !state.audioMaster) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const config = options || {};
    const voice = (frequency, offset, duration, amplitude, waveform, glideTo) =>
      soundVoice(context, frequency, offset, duration, amplitude, waveform, glideTo);
    const chord = (notes, spacing, duration, amplitude, waveform) =>
      notes.forEach((frequency, index) => voice(frequency, index * (spacing || 0), duration, amplitude, waveform));
    switch (name) {
      case 'hover': voice(1046, 0, 0.045, 0.008, 'sine'); break;
      case 'click':
        voice(720, 0, 0.045, 0.018, 'sine');
        voice(1040, 0.012, 0.035, 0.009, 'sine');
        break;
      case 'submit':
        voice(460, 0, 0.07, 0.025, 'triangle');
        voice(690, 0.045, 0.085, 0.018, 'sine');
        break;
      case 'navigation':
        voice(440, 0, 0.075, 0.022, 'sine');
        voice(660, 0.045, 0.09, 0.019, 'sine');
        break;
      case 'modal-open':
        voice(330, 0, 0.12, 0.024, 'sine');
        voice(494, 0.055, 0.14, 0.021, 'sine');
        voice(659, 0.105, 0.16, 0.015, 'sine');
        break;
      case 'modal-close':
        voice(659, 0, 0.09, 0.018, 'sine');
        voice(494, 0.045, 0.11, 0.017, 'sine');
        voice(330, 0.09, 0.12, 0.014, 'sine');
        break;
      case 'toggle':
        voice(620, 0, 0.055, 0.022, 'sine');
        voice(880, 0.05, 0.07, 0.016, 'sine');
        break;
      case 'launch':
        soundNoise(context, 0, 0.22, 0.018, 1700);
        chord([220, 330, 440, 660, 880], 0.065, 0.19, 0.024, 'sine');
        break;
      case 'question':
        voice(440, 0, 0.11, 0.02, 'triangle');
        voice(554, 0.075, 0.13, 0.018, 'sine');
        break;
      case 'hint':
        soundNoise(context, 0, 0.18, 0.012, 4200);
        chord([587, 784, 1175], 0.055, 0.2, 0.022, 'sine');
        break;
      case 'answer': {
        const rarity = Math.max(0, Math.min(5, Number(config.rarity) || 0));
        const scales = [
          [440, 554, 659], [494, 622, 740], [523, 659, 784],
          [587, 740, 880, 1175], [659, 831, 988, 1318], [784, 988, 1175, 1568]
        ];
        chord(scales[rarity], 0.065, rarity >= 4 ? 0.25 : 0.19, rarity >= 4 ? 0.033 : 0.026, 'sine');
        if (rarity >= 3) soundNoise(context, 0.02, 0.17, 0.009, 3200);
        break;
      }
      case 'miss':
        voice(330, 0, 0.12, 0.028, 'triangle', 250);
        voice(247, 0.09, 0.16, 0.025, 'triangle', 185);
        break;
      case 'skip':
        voice(440, 0, 0.085, 0.02, 'sine');
        voice(349, 0.07, 0.13, 0.019, 'sine');
        voice(262, 0.14, 0.15, 0.014, 'sine');
        break;
      case 'countdown': voice(740, 0, 0.06, 0.018, 'square'); break;
      case 'warning':
        voice(660, 0, 0.075, 0.024, 'triangle');
        voice(880, 0.11, 0.085, 0.021, 'triangle');
        break;
      case 'critical':
        voice(880, 0, 0.08, 0.027, 'square');
        voice(660, 0.1, 0.08, 0.023, 'square');
        break;
      case 'daily-complete':
        chord([523, 659, 784, 1046, 1318], 0.09, 0.32, 0.028, 'sine');
        soundNoise(context, 0.18, 0.22, 0.012, 3400);
        break;
      case 'queue':
        voice(392, 0, 0.09, 0.022, 'sine');
        voice(523, 0.09, 0.11, 0.022, 'sine');
        voice(659, 0.18, 0.15, 0.018, 'sine');
        break;
      case 'your-turn':
        chord([523, 784, 1046], 0.07, 0.2, 0.03, 'triangle');
        break;
      case 'power-up':
        chord([659, 831, 988, 1318], 0.055, 0.24, 0.03, 'sine');
        soundNoise(context, 0.04, 0.17, 0.01, 3800);
        break;
      case 'eliminated':
        soundNoise(context, 0, 0.2, 0.025, 1500);
        voice(262, 0, 0.26, 0.038, 'triangle', 98);
        voice(131, 0.1, 0.31, 0.028, 'sawtooth', 45);
        break;
      case 'join': chord([392, 523, 659], 0.07, 0.2, 0.024, 'sine'); break;
      case 'orb-pass':
        soundNoise(context, 0, 0.15, 0.022, 2500);
        voice(330, 0, 0.12, 0.024, 'triangle', 660);
        voice(660, 0.09, 0.15, 0.023, 'sine', 990);
        break;
      case 'overload':
        soundNoise(context, 0, 0.29, 0.055, 900);
        voice(180, 0, 0.34, 0.06, 'sawtooth', 48);
        voice(95, 0.04, 0.28, 0.035, 'triangle', 42);
        break;
      case 'category':
        soundNoise(context, 0, 0.16, 0.012, 3000);
        chord([392, 494, 587, 784], 0.075, 0.23, 0.024, 'sine');
        break;
      case 'match-ready': chord([440, 554, 659, 880], 0.085, 0.23, 0.028, 'triangle'); break;
      case 'chat':
        voice(880, 0, 0.055, 0.015, 'sine');
        voice(1175, 0.055, 0.075, 0.012, 'sine');
        break;
      case 'leave':
        voice(659, 0, 0.09, 0.018, 'sine');
        voice(494, 0.075, 0.11, 0.016, 'sine');
        voice(392, 0.15, 0.14, 0.014, 'sine');
        break;
      case 'victory':
        chord([523, 659, 784, 1046, 1318], 0.1, 0.38, 0.034, 'sine');
        voice(1568, 0.42, 0.3, 0.025, 'sine');
        soundNoise(context, 0.16, 0.24, 0.014, 3600);
        break;
      case 'defeat':
        voice(392, 0, 0.18, 0.027, 'triangle', 330);
        voice(330, 0.14, 0.2, 0.024, 'triangle', 262);
        voice(262, 0.29, 0.26, 0.021, 'sine', 196);
        break;
      case 'preview':
        chord([440, 554, 659], 0.11, 0.22, 0.026, 'sine');
        voice(880, 0.46, 0.15, 0.022, 'sine');
        soundNoise(context, 0.62, 0.19, 0.012, 3200);
        break;
      default: voice(520, 0, 0.09, 0.02, 'sine');
    }
  }
  function openModal(id) {
    const el = $('#' + id);
    if (el && !el.open) {
      el.showModal();
      playSound('modal-open');
    }
  }
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
    if (id !== 'daily-play') {
      clearDailySuggestion();
      clearDailyReaction();
      const reveal = $('#daily-answer-reveal');
      if (reveal) reveal.hidden = true;
    } else {
      const reveal = $('#daily-answer-reveal');
      if (reveal) reveal.hidden = true;
    }
  }
  function clearDailySuggestion() {
    clearTimeout(state.suggestionTimer);
    state.suggestionTimer = null;
    state.suggestionSequence += 1;
    state.pendingSuggestion = null;
    const panel = $('#daily-suggestion');
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = '';
    }
  }
  function clearFlyingRarity() {
    const chip = $('#atlas-flying-rarity');
    if (!chip) return;
    chip.hidden = true;
    chip.classList.remove('is-flying');
  }
  function showFlyingRarity(level, points, rarity) {
    const chip = $('#atlas-flying-rarity');
    if (!chip) return;
    chip.dataset.rarity = String(Math.max(0, Math.min(5, Number(rarity) || 0)));
    $('#atlas-flying-rarity-level').textContent = String(level || 'FAMILIAR').toUpperCase();
    $('#atlas-flying-rarity-points').textContent = '+' + number.format(points || 0) + ' PTS';
    chip.hidden = false;
    chip.classList.remove('is-flying');
    void chip.offsetWidth;
    chip.classList.add('is-flying');
  }
  function clearDailyReaction() {
    clearTimeout(state.dailyAdvanceTimer);
    state.dailyAdvanceTimer = null;
    const panel = $('#daily-answer-reaction');
    if (panel) { panel.hidden = true; panel.classList.remove('visible'); }
    clearFlyingRarity();
  }
  function clearPartySuggestion() {
    clearTimeout(state.partySuggestionTimer);
    state.partySuggestionTimer = null;
    state.partySuggestionSequence += 1;
    state.pendingPartySuggestion = null;
    const panel = $('#rush-suggestion');
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
  }
  function schedulePartySuggestion() {
    clearTimeout(state.partySuggestionTimer);
    state.partySuggestionTimer = null;
    const input = $('#rush-answer');
    const typed = input.value.trim();
    clearPartySuggestion();
    if (!state.room || state.room.phase !== 'playing' || typed.length < 3) return;
    const sequence = state.partySuggestionSequence;
    const categoryId = state.room.category && state.room.category.id;
    if (!categoryId) return;
    state.partySuggestionTimer = setTimeout(() => {
      sendSocket({ type: 'suggest_answer', answer: typed, categoryId, requestId: sequence });
    }, 260);
  }
  function usePartySuggestion() {
    const suggestion = state.pendingPartySuggestion;
    const input = $('#rush-answer');
    if (!suggestion || norm(input.value) !== norm(suggestion.input)) return false;
    input.value = suggestion.answer;
    clearPartySuggestion();
    $('#rush-feedback').textContent = 'Suggestion inserted. Press Enter when the Orb reaches you.';
    input.focus();
    return true;
  }
  function showDailySuggestion(typed, answer) {
    if (!typed || !answer) return false;
    const panel = $('#daily-suggestion');
    state.pendingSuggestion = { input: typed, answer };
    panel.innerHTML = '<span class="suggestion-copy">DID YOU MEAN?</span><button class="suggestion-choice" type="button" data-use-daily-suggestion>' +
      esc(answer) + '<span>PRESS ENTER TO USE</span></button>';
    panel.hidden = false;
    return true;
  }
  async function scheduleDailySuggestion() {
    clearTimeout(state.suggestionTimer);
    state.suggestionTimer = null;
    const input = $('#daily-answer');
    const panel = $('#daily-suggestion');
    const typed = input.value.trim();
    state.pendingSuggestion = null;
    panel.hidden = true;
    panel.innerHTML = '';
    const sequence = ++state.suggestionSequence;
    if (!state.runId || !state.question || state.pendingNextIndex !== null || typed.length < 3) return;
    state.suggestionTimer = setTimeout(async () => {
      let answer = null;
      try {
        if (state.practice) {
          const result = await api('/daily/archive/suggest', {
            method: 'POST',
            body: { date: state.practice.date, questionId: state.question.id, answer: typed }
          });
          answer = result.suggestion && result.suggestion.answer;
        } else if (state.unlimited) {
          const result = await api('/practice/suggest', {
            method: 'POST',
            body: { guestId: state.guestId, runId: state.runId, index: state.unlimited.questionsPlayed, answer: typed }
          });
          answer = result.suggestion && result.suggestion.answer;
        } else {
          const result = await api('/daily/suggest', {
            method: 'POST',
            body: { guestId: state.guestId, runId: state.runId, index: state.questionIndex, answer: typed }
          });
          answer = result.suggestion && result.suggestion.answer;
        }
      } catch (_) {
        answer = null;
      }
      if (sequence !== state.suggestionSequence || input.value.trim() !== typed || !answer) return;
      showDailySuggestion(typed, answer);
    }, 220);
  }
  function useDailySuggestion() {
    const suggestion = state.pendingSuggestion;
    const input = $('#daily-answer');
    if (!suggestion || norm(input.value) !== norm(suggestion.input)) return false;
    input.value = suggestion.answer;
    clearDailySuggestion();
    $('#daily-feedback').textContent = 'Suggestion inserted. Press Enter again to submit your answer.';
    input.focus();
    return true;
  }
  function setAscentVisible(visible) {
    const exit = $('#daily-archive-exit');
    if (exit) exit.hidden = !(visible && state.practice);
  }
  function updateAscentProgress(points) {
    const earned = points == null || !Number.isFinite(Number(points))
      ? 0 : Math.max(0, Number(points));
    const maximum = Math.max(1, Number(state.ascentMaxPoints) || 700);
    state.ascentPoints = Math.max(0, Math.min(maximum, Number(state.ascentPoints || 0) + earned));
    const ratio = state.ascentPoints / maximum;
    // Linear distance per Discovery Point. Duration scales with distance,
    // so every answer moves the camera at the same fast, steady speed.
    const travelPerMove = 681.5 * earned / maximum;
    const duration = earned > 0 ? Math.max(180, Math.round(travelPerMove / 48 * 1000)) : 900;
    const view = $('#view-daily');
    const world = $('#atlas-space-world');
    [view, world].filter(Boolean).forEach(element => {
      element.style.setProperty('--flight-progress', ratio.toFixed(5));
      element.style.setProperty('--flight-distance', (681.5 * ratio).toFixed(2) + 'vw');
      element.style.setProperty('--flight-duration', duration + 'ms');
    });
  }
  function resetAscent() {
    state.ascentPoints = 0;
    updateAscentProgress(0);
  }
  async function returnToToday() {
    stopDailyTimer();
    state.runId = null;
    state.practice = null;
    state.unlimited = null;
    state.dailyHistory = [];
    state.pendingNextIndex = null;
    state.advancing = false;
    resetAscent();
    setAscentVisible(false);
    $('#attempt-label').textContent = 'ONE OFFICIAL RUN';
    $('#edition-label').textContent = "TODAY'S EDITION";
    $('#daily-return-today').hidden = true;
    await loadDaily();
  }

  async function loadDaily() {
    try {
      state.practice = null;
      state.unlimited = null;
      state.dailyHistory = [];
      state.dailyResumeAvailable = false;
      state.provisionalScore = 0;
      setAscentVisible(false);
      $('#attempt-label').textContent = 'ONE OFFICIAL RUN';
      $('#edition-label').textContent = "TODAY'S EDITION";
      $('#daily-return-today').hidden = true;
      const result = await api('/daily/current');
      state.daily = result;
      state.dailyHistory = Array.isArray(result.history) ? result.history : [];
      state.provisionalScore = Number(result.played && result.played.provisional_score) || 0;
      $('#edition-date').textContent = fmtDate(result.date);

      const canResume = Boolean(result.played && result.played.status === 'in_progress');
      state.dailyResumeAvailable = canResume;
      const resumeNote = $('#daily-resume-note');
      if (resumeNote) {
        resumeNote.hidden = !canResume;
        resumeNote.textContent = canResume
          ? 'Your official run is saved at question ' + (Math.min(6, Math.max(0, Number(result.played.current_question) || 0)) + 1) + ' of 7. Continue with the remaining time.'
          : '';
      }

      if (result.played && !canResume) {
        setDailySection('daily-locked');
        $('#locked-summary').textContent = result.played.status === 'completed'
          ? 'You completed today’s official run. ' + (result.played.final_score == null ? 'Your score is saved while Discovery Points are finalised at 00:00 UTC.' : 'Your final Discovery Score is ' + number.format(result.played.final_score) + ' points.')
          : 'This official attempt is no longer available.';
      } else {
        setDailySection('daily-idle');
        $('#daily-panel-title').textContent = canResume ? 'Pick up where you left off.' : 'Ready to explore?';
        $('#daily-start').innerHTML = canResume
          ? 'Resume today’s Atlas <span aria-hidden="true">↗</span>'
          : 'Start today’s Atlas <span aria-hidden="true">↗</span>';
        $('#attempt-label').textContent = canResume ? 'OFFICIAL RUN IN PROGRESS' : 'ONE OFFICIAL RUN';
      }
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
    playSound('launch');
    const button = $('#daily-start');
    button.disabled = true;
    button.textContent = state.dailyResumeAvailable ? 'Resuming your Atlas…' : 'Preparing today’s Atlas…';
    try {
      const result = await api('/daily/start', { method: 'POST', body: { guestId: state.guestId } });
      trackAnalytics('game_start',{game:'atlas_daily',resumed:Boolean(result.resumed)});
      state.practice = null;
      state.unlimited = null;
      state.dailyHistory = Array.isArray(state.dailyHistory) ? state.dailyHistory : [];
      state.runId = result.runId;
      state.provisionalScore = Number(result.provisionalScore) || 0;
      state.ascentMaxPoints = Number(result.maxPossibleScore) || 700;
      resetAscent();
      if (state.provisionalScore > 0) updateAscentProgress(state.provisionalScore);
      setAscentVisible(true);
      $('#attempt-label').textContent = result.resumed ? 'OFFICIAL RUN · RESUMED' : 'OFFICIAL RUN · 7 QUESTIONS';
      $('#daily-return-today').hidden = true;
      state.dailyResumeAvailable = false;
      updateQuestion(result.question, result.index);
      state.hintUsed = Boolean(result.hintUsed);
      $('#daily-hint').disabled = state.hintUsed;
      $('#hint-counter').textContent = state.hintUsed ? '0 / 1' : '1 / 1';
      setDailySection('daily-play');
      startDailyTimer(result.seconds);
    } catch (error) {
      if (error.status === 409) {
        await loadDaily();
        toast(error.payload && error.payload.completed
          ? 'Today’s official Atlas is already complete.'
          : 'Your saved Atlas attempt has changed. The latest status has been loaded.');
      } else {
        toast(error.message);
      }
    } finally {
      button.disabled = false;
      button.innerHTML = state.dailyResumeAvailable
        ? 'Resume today’s Atlas <span aria-hidden="true">↗</span>'
        : 'Start today’s Atlas <span aria-hidden="true">↗</span>';
    }
  }
  function renderDailyQuestionVisual(question) {
    const root = $('#daily-question-visual');
    if (!root) return;
    const visual = question && question.visual;
    root.innerHTML = '';
    root.hidden = !visual || !['flag-colours', 'symbol'].includes(visual.kind);
    if (root.hidden) return;
    root.dataset.kind = visual.kind;
    if (visual.kind === 'flag-colours') {
      const colors = (Array.isArray(visual.colors) ? visual.colors : []).filter(color => /^#[0-9a-f]{6}$/i.test(String(color)));
      root.innerHTML = '<div class="question-colour-strip">' + colors.map(color => '<i style="--clue-colour:' + color + '"></i>').join('') + '</div><small>FLAG COLOUR CLUE</small>';
    } else {
      const glyph = document.createElement('span');
      glyph.className = 'question-symbol-glyph';
      glyph.textContent = String(visual.text || '✦').slice(0, 4);
      const label = document.createElement('small');
      label.textContent = String(visual.label || 'WORLD CLUE').slice(0, 32);
      root.append(glyph, label);
    }
  }

  function updateQuestion(question, index) {
    if (state.question) playSound('question');
    clearDailySuggestion();
    clearDailyReaction();
    state.question = question;
    state.questionIndex = index;
    state.dailyExpiryPending = false;
    state.pendingNextIndex = null;
    $('#question-number').textContent = String(index + 1).padStart(2, '0');
    $('.question-count .muted').textContent = state.unlimited ? ' / ∞' : ' / 07';
    $('#question-category').textContent = question.category || 'GEOGRAPHY';
    renderDailyQuestionVisual(question);
    $('#daily-archive-exit').hidden = !state.practice && !state.unlimited;
    $('#daily-archive-exit').textContent = state.unlimited ? 'EXIT PRACTICE ×' : 'EXIT ARCHIVE ×';
    $('#unlimited-actions').hidden = false;
    $('#unlimited-skip').hidden = false;
    $('#unlimited-finish').hidden = !state.unlimited;
    $('#daily-answer-reveal').hidden = true;
    $('#daily-flight-summary').hidden = Boolean(state.unlimited);
    $('#daily-question').textContent = question.prompt;
    $('#question-note').textContent = question.note || 'Every answer in the approved set counts.';
    const progressIndex = state.unlimited ? index % 7 : index;
    $$('.progress-segment').forEach((el, i) => {
      el.classList.toggle('done', i < progressIndex);
      el.classList.toggle('active', i === progressIndex);
    });
    $('#daily-answer').value = '';
    $('#daily-answer').disabled = false;
    $('#daily-feedback').textContent = '';
    $('#daily-feedback').classList.remove('success');
    $('#hint-box').hidden = true;
    $('#hint-box').textContent = '';
    state.hintUsed = false;
    $('#daily-hint').disabled = false;
    $('#hint-counter').textContent = '1 / 1';
    $('#daily-submit').disabled = false;
    if (state.unlimited) {
      stopDailyTimer();
      $('#daily-clock .clock-face').textContent = '∞';
      $('#daily-clock small').textContent = 'OPEN';
      $('#daily-clock').classList.remove('urgent');
      $('#daily-clock').setAttribute('aria-label', 'Untimed practice');
    } else {
      $('#daily-clock small').textContent = 'SEC';
    }
    requestAnimationFrame(() => {
      const answerInput = $('#daily-answer');
      if (answerInput && !answerInput.disabled && !$('#daily-play').hidden) {
        answerInput.focus({ preventScroll: true });
      }
    });
  }
  function stopDailyTimer() {
    clearInterval(state.timer);
    state.timer = null;
    state.dailyDeadlineAt = 0;
  }
  function renderDailyClock() {
    $('#daily-clock .clock-face').textContent = String(Math.max(0, state.secondsLeft));
    $('#daily-clock').classList.toggle('urgent', state.secondsLeft <= 7);
    $('#daily-clock').setAttribute('aria-label', state.secondsLeft + ' seconds remaining');
  }
  function refreshDailyTimer() {
    if (!state.dailyDeadlineAt) return;
    const remaining = Math.max(0, Math.ceil((state.dailyDeadlineAt - Date.now()) / 1000));
    if (remaining !== state.secondsLeft) {
      state.secondsLeft = remaining;
      if ([10, 5, 3, 2, 1].includes(remaining) && !state.dailySoundMarks.includes(remaining)) {
        state.dailySoundMarks.push(remaining);
        playSound(remaining <= 3 ? 'critical' : 'countdown');
      }
      renderDailyClock();
    }
    if (remaining <= 0) {
      stopDailyTimer();
      if (state.dailySubmitting) state.dailyExpiryPending = true;
      else skipDailyQuestion();
    }
  }
  function startDailyTimer(seconds) {
    stopDailyTimer();
    state.dailySoundMarks = [];
    const requestedSeconds = Number(seconds);
    state.secondsLeft = Number.isFinite(requestedSeconds) ? Math.max(0, Math.ceil(requestedSeconds)) : 25;
    state.dailyDeadlineAt = Date.now() + state.secondsLeft * 1000;
    renderDailyClock();
    if (state.secondsLeft <= 0) {
      refreshDailyTimer();
      return;
    }
    state.timer = setInterval(refreshDailyTimer, 200);
  }
  async function submitDailyAnswer(event) {
    event.preventDefault();
    if (!state.runId || !state.question || state.pendingNextIndex !== null || state.dailySubmitting) return;
    if (useDailySuggestion()) return;
    const input = $('#daily-answer');
    const answer = input.value.trim();
    if (!answer) return;
    state.dailySubmitting = true;
    if (state.unlimited) {
      $('#daily-submit').disabled=true;
      $('#daily-feedback').textContent='Checking the curated answer set…';
      try {
        const result=await api('/practice/answer',{
          method:'POST',body:{guestId:state.guestId,runId:state.runId,index:state.unlimited.questionsPlayed,answer}
        });
        if(!result.accepted) {
          if (result.suggestion && result.suggestion.answer) {
            showDailySuggestion(answer, result.suggestion.answer);
            $('#daily-feedback').textContent = result.message || 'Select the suggested answer, then submit again.';
            input.focus();
            return;
          }
          $('#daily-feedback').textContent=result.message||'That answer is not approved yet. Try another.';
          playSound('miss');input.select();return;
        }
        stopDailyTimer();
        state.provisionalScore+=Number(result.provisionalPoints||0);
        state.unlimited.questionsPlayed=Number(result.nextIndex||0);
        state.pendingNextIndex=state.unlimited.questionsPlayed;
        showDailyResult(true,result.answer,result.level,result.provisionalPoints,result.reveal||[],1,result.rarity);
        playSound('answer', { rarity: result.rarity });
      } catch(error) {
        $('#daily-feedback').textContent=error.message;
      } finally {
        state.dailySubmitting = false;
        $('#daily-submit').disabled = state.pendingNextIndex !== null;
        if (state.dailyExpiryPending) {
          state.dailyExpiryPending = false;
          if (state.pendingNextIndex === null) skipDailyQuestion();
        }
      }
      return;
    }
    $('#daily-submit').disabled = true;
    $('#daily-feedback').textContent = 'Checking the approved answer set…';
    $('#daily-feedback').classList.remove('success');
    try {
      if (state.practice) {
        const result = await api('/daily/archive/answer', {
          method: 'POST',
          body: { date: state.practice.date, questionId: state.question.id, answer }
        });
        if (!result.accepted) {
          if (result.suggestion && result.suggestion.answer) {
            showDailySuggestion(answer, result.suggestion.answer);
            $('#daily-feedback').textContent = result.message || 'Select the suggested answer, then submit again.';
            input.focus();
            return;
          }
          $('#daily-feedback').textContent = result.message || 'That answer is not in this edition’s approved set. Try another.';
          playSound('miss');
          input.select();
          return;
        }
        stopDailyTimer();
        state.provisionalScore += Number(result.points || 0);
        state.pendingNextIndex = state.questionIndex + 1;
        showDailyResult(true, result.answer, result.level, result.points, result.reveal || [], 1, result.rarity);
        playSound('answer', { rarity: result.rarity });
        return;
      }
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
        if (result.suggestion && result.suggestion.answer) {
          showDailySuggestion(answer, result.suggestion.answer);
          $('#daily-feedback').textContent = result.message || 'Select the suggested answer, then submit again.';
          input.focus();
          return;
        }
        $('#daily-feedback').textContent = result.message || 'That answer is not in today’s approved answer set. Try another.';
        playSound('miss');
        input.select();
        return;
      }
      stopDailyTimer();
      state.provisionalScore += Number(result.provisionalPoints || 0);
      state.pendingNextIndex = result.nextIndex;
      showDailyResult(true, result.answer, result.level, result.provisionalPoints, result.reveal || [], result.sameAnswerCount || 1, result.rarity);
      playSound('answer', { rarity: result.rarity });
    } catch (error) {
      $('#daily-feedback').textContent = error.message;
      if (error.status === 409) { stopDailyTimer(); toast('This question has already been completed.'); }
    } finally {
      state.dailySubmitting = false;
      $('#daily-submit').disabled = state.pendingNextIndex !== null;
      if (state.dailyExpiryPending) {
        state.dailyExpiryPending = false;
        if (state.pendingNextIndex === null) skipDailyQuestion();
      }
    }
  }
  async function skipDailyQuestion() {
    if (!state.runId || !state.question || state.pendingNextIndex !== null || state.dailySubmitting) return;
    state.dailySubmitting = true;
    $('#daily-submit').disabled = true;
    try {
      if (state.unlimited) {
        const result=await api('/practice/skip',{
          method:'POST',body:{guestId:state.guestId,runId:state.runId,index:state.unlimited.questionsPlayed}
        });
        state.unlimited.questionsPlayed=Number(result.nextIndex||0);
        state.pendingNextIndex=state.unlimited.questionsPlayed;
        showDailyResult(false,'','','',result.reveal||[]);
        playSound('skip');
        return;
      }
      if (state.practice) {
        stopDailyTimer();
        state.pendingNextIndex = state.questionIndex + 1;
        const reveal = (state.question.answers || []).map(item => ({ answer: item.answer, points: item.points, level: item.level, rarity: item.rarity }));
        showDailyResult(false, '', '', 0, reveal);
        playSound('skip');
        return;
      }
      const result = await api('/daily/skip', {
        method: 'POST',
        body: { guestId: state.guestId, runId: state.runId, index: state.questionIndex }
      });
      state.pendingNextIndex = result.nextIndex;
      showDailyResult(false, '', '', 0, result.reveal || []);
      playSound('skip');
    } catch (error) { toast(error.message); }
    finally {
      state.dailySubmitting = false;
      $('#daily-submit').disabled = state.pendingNextIndex !== null;
    }
  }
  function showDailyResult(accepted, answer, level, points, reveal, sameAnswerCount, rarity) {
    const panel = $('#daily-answer-reaction');
    if (!panel) return;
    if ($('#daily-play').hidden) setDailySection('daily-play');
    state.dailyHistory.push({
      question: state.question ? state.question.prompt : '',
      category: state.question ? state.question.category : '',
      answer: accepted ? String(answer || '') : '',
      accepted: Boolean(accepted),
      level: accepted ? String(level || 'Known') : '',
      points: accepted ? Number(points || 0) : 0,
      rarity: accepted ? Number(rarity || 0) : null,
      reveal: (Array.isArray(reveal) ? reveal : []).slice(0,80)
    });
    renderDailyAnswerReveal(reveal || [], accepted, answer);

    if (accepted) {
      updateAscentProgress(points);
      showFlyingRarity(level, points, rarity);
    } else {
      clearFlyingRarity();
    }
    panel.dataset.rarity = String(Math.max(0, Math.min(5, Number(rarity) || 0)));
    $('#daily-reaction-level').textContent = accepted ? String(level || 'Known').toUpperCase() : 'TIME UP';
    $('#daily-reaction-points').textContent = accepted
      ? '+' + number.format(points || 0) + ' DISCOVERY POINTS'
      : 'NO POINTS THIS ORBIT';
    $('#daily-reaction-answer').textContent = accepted
      ? String(answer || '').toUpperCase() + (sameAnswerCount > 1 ? ' · ' + number.format(sameAnswerCount) + ' FOUND' : '')
      : 'Ready for the next question';

    panel.hidden = false;
    panel.classList.remove('visible');
    void panel.offsetWidth;
    panel.classList.add('visible');
    $('#daily-answer').disabled = true;
    $('#daily-submit').disabled = true;

    const nextButton = $('#daily-next');
    nextButton.hidden = false;
    nextButton.disabled = false;
    nextButton.textContent = state.unlimited ? 'NEXT QUESTION  →' :
      state.pendingNextIndex >= 7 ? 'FINISH DAILY  →' : 'CONTINUE  →';
    nextButton.focus({ preventScroll: true });
  }
  function renderDailyAnswerReveal(reveal,accepted,submittedAnswer) {
    const panel=$('#daily-answer-reveal');
    if(!panel)return;
    const entries=(Array.isArray(reveal)?reveal:[]).slice()
      .sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0)||String(a.answer).localeCompare(String(b.answer)));
    const itemHTML=item=>{
      const rarity=Math.max(0,Math.min(5,Number(item.rarity)||0));
      const aliases=Array.isArray(item.aliases)?item.aliases:[];
      return '<div class="answer-reveal-item" data-rarity="'+rarity+'">'+
        '<span class="answer-reveal-name">'+esc(item.answer)+'</span>'+
        '<span class="answer-reveal-tier">'+esc(item.level||'Known')+'</span>'+
        '<strong>+'+number.format(Number(item.points)||0)+'</strong>'+
        (aliases.length?'<small>'+aliases.slice(0,3).map(esc).join(' · ')+'</small>':'')+'</div>';
    };
    const top=entries.slice(0,8),rest=entries.slice(8);
    panel.innerHTML='<div class="answer-reveal-heading"><div><span class="micro-label">VERIFIED ANSWER POOL</span>'+
      '<strong>'+(accepted?'Your answer is in the atlas.':'Here are the accepted discoveries.')+'</strong>'+
      '<small>'+entries.length+' accepted answer'+(entries.length===1?'':'s')+
      (submittedAnswer?' · Submitted: '+esc(submittedAnswer):'')+'</small></div><span class="answer-reveal-count">'+
      number.format(entries.length)+'</span></div><div class="answer-reveal-grid">'+top.map(itemHTML).join('')+'</div>'+
      (rest.length?'<details class="answer-reveal-more"><summary>Reveal '+rest.length+' more accepted answers</summary>'+
      '<div class="answer-reveal-grid">'+rest.map(itemHTML).join('')+'</div></details>':'');
    panel.hidden=false;
  }

  function renderDailyRecap() {
    const target=$('#daily-answer-recap');
    if(!target)return;
    const rows=state.dailyHistory||[];
    if(!rows.length){target.innerHTML='<p class="empty-room-note">No question results to show yet.</p>';return;}
    target.innerHTML='<div class="daily-recap-head"><span class="micro-label">YOUR EXPEDITION LOG</span><strong>'+
      rows.length+' question'+(rows.length===1?'':'s')+' completed</strong></div><div class="daily-recap-list">'+
      rows.map((item,index)=>{
        const rarity=Math.max(0,Math.min(5,Number(item.rarity)||0));
        const alternatives=(item.reveal||[]).slice(0,5).map(entry=>esc(entry.answer)).join(' · ');
        return '<article class="daily-recap-row"><span class="daily-recap-number">'+String(index+1).padStart(2,'0')+
          '</span><div class="daily-recap-copy"><strong>'+esc(item.category||'Question')+'</strong><small>'+esc(item.question||'')+
          '</small><span>'+(item.accepted?'Your answer: '+esc(item.answer):'No answer submitted')+'</span>'+
          (alternatives?'<small class="daily-recap-alternatives">Other accepted answers: '+alternatives+'</small>':'')+
          '</div><div class="daily-recap-score" '+(item.accepted?'data-rarity="'+rarity+'"':'')+'>'+
          (item.accepted?'<strong>+'+number.format(item.points)+'</strong><small>'+esc(item.level)+'</small>':
            '<strong>—</strong><small>SKIPPED</small>')+'</div></article>';
      }).join('')+'</div>';
  }


  function renderFlightDistribution(result) {
    const participants = Math.max(0, Number(result.participants) || 0);
    const average = result.averageScore == null ? null : Number(result.averageScore);
    const mode = result.mostCommon || null;
    $('#flight-average').textContent = average == null ? '—' : number.format(Math.round(average)) + ' PTS';
    $('#flight-average-detail').textContent = average == null ? 'No completed flights yet' : 'Mean distance across all finishers';
    $('#flight-mode').textContent = mode ? mode.label + ' PTS' : '—';
    $('#flight-mode-detail').textContent = mode ? number.format(mode.count) + ' player(s) landed here' : 'No most common landing yet';
    $('#flight-participants').textContent = participants === 0
      ? 'No completed flights have been recorded for this edition yet.'
      : 'Based on ' + number.format(participants) + ' completed flight' + (participants === 1 ? '' : 's') + ' · anonymous worldwide results.';

    const graph = $('#flight-distribution-graph');
    const buckets = Array.isArray(result.buckets) ? result.buckets : [];
    if (!participants || !buckets.length) {
      graph.textContent = 'Finish this edition to start the worldwide landing comparison.';
      return;
    }

    const width = 620;
    const height = 220;
    const left = 42;
    const right = 18;
    const top = 22;
    const bottom = 164;
    const plotWidth = width - left - right;
    const plotHeight = bottom - top;
    const maxCount = Math.max(1, ...buckets.map(bucket => Number(bucket.count) || 0));
    const gap = 13;
    const barWidth = (plotWidth - gap * (buckets.length - 1)) / buckets.length;
    const grid = [0, .5, 1].map(fraction => {
      const y = bottom - plotHeight * fraction;
      const value = Math.round(maxCount * fraction);
      return '<line x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '" class="flight-chart-grid"/>' +
        '<text x="' + (left - 10) + '" y="' + (y + 4) + '" text-anchor="end" class="flight-chart-y-label">' + value + '</text>';
    }).join('');
    const bars = buckets.map((bucket, index) => {
      const count = Math.max(0, Number(bucket.count) || 0);
      const barHeight = count / maxCount * plotHeight;
      const x = left + index * (barWidth + gap);
      const y = bottom - barHeight;
      const highlighted = mode && Number(bucket.min) === Number(mode.min);
      const label = esc(bucket.label || '');
      return '<g class="' + (highlighted ? 'is-popular' : '') + '">' +
        '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + Math.max(2, barHeight).toFixed(1) + '" rx="3" class="flight-chart-bar"/>' +
        '<text x="' + (x + barWidth / 2).toFixed(1) + '" y="' + (bottom + 20) + '" text-anchor="middle" class="flight-chart-x-label">' + label + '</text>' +
        (count ? '<text x="' + (x + barWidth / 2).toFixed(1) + '" y="' + Math.max(top - 3, y - 7).toFixed(1) + '" text-anchor="middle" class="flight-chart-count">' + count + '</text>' : '') +
        '</g>';
    }).join('');
    const chartMaximum = Math.max(1, Number(result.maxScore) || 700);
    const averageX = average == null ? null : left + Math.max(0, Math.min(chartMaximum, average)) / chartMaximum * plotWidth;
    const averageLine = averageX == null ? '' :
      '<line x1="' + averageX.toFixed(1) + '" y1="' + (top - 5) + '" x2="' + averageX.toFixed(1) + '" y2="' + bottom + '" class="flight-chart-average"/>' +
      '<text x="' + averageX.toFixed(1) + '" y="12" text-anchor="middle" class="flight-chart-average-label">AVG</text>';
    graph.innerHTML =
      '<svg class="flight-distribution-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Completed flight score distribution. Average ' +
      (average == null ? 'not available' : number.format(Math.round(average)) + ' points') + '. Most common landing ' +
      (mode ? esc(mode.label) + ' points' : 'not available') + '.">' +
      '<defs><linearGradient id="flightBarBlue" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#72d7e5"/><stop offset="1" stop-color="#2b6694"/></linearGradient>' +
      '<linearGradient id="flightBarGold" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffd18a"/><stop offset="1" stop-color="#b77743"/></linearGradient></defs>' +
      grid + bars + averageLine +
      '<text x="' + (width / 2) + '" y="208" text-anchor="middle" class="flight-chart-axis-title">DISCOVERY POINTS · DISTANCE FROM EARTH</text></svg>';
  }

  async function loadFlightDistribution(date) {
    const graph = $('#flight-distribution-graph');
    graph.textContent = 'Calculating the worldwide flight report…';
    try {
      const day = date || (state.daily && state.daily.date);
      const query = day ? '?date=' + encodeURIComponent(day) : '';
      const result = await api('/daily/flight-distribution' + query);
      renderFlightDistribution(result);
    } catch (error) {
      graph.textContent = 'The worldwide flight report is temporarily unavailable.';
      $('#flight-participants').textContent = error.message;
    }
  }

  async function nextDailyQuestion() {
    if (!state.runId || state.pendingNextIndex === null || state.advancing) return;
    state.advancing = true;
    const index = state.pendingNextIndex;
    const button = $('#daily-next');
    button.disabled = true;
    if (state.unlimited) {
      try {
        const result=await api('/practice/next',{
          method:'POST',body:{guestId:state.guestId,runId:state.runId,index:state.unlimited.questionsPlayed}
        });
        updateQuestion(result.question,result.index);
        setDailySection('daily-play');
        $('#daily-answer').focus();
      } catch(error) {
        toast(error.message);
        if(error.status===404||error.status===409) await finishUnlimited();
      } finally { button.disabled=false;state.advancing=false; }
      return;
    }
    if (state.practice) {
      if (index >= state.practice.questions.length) {
        stopDailyTimer();
        state.practice.finished = true;
        playSound('daily-complete');
        clearDailyReaction();
        setDailySection('daily-complete');
        renderDailyRecap();
        $('#daily-flight-summary').hidden=false;
        $('.daily-complete .eyebrow').textContent = 'ARCHIVE HIGH RISE COMPLETE';
        $('#complete-score').textContent = number.format(state.provisionalScore);
        $('#complete-summary').textContent = 'You replayed all seven questions from ' + fmtDate(state.practice.date) + '. This practice run does not affect official rankings.';
        $('.daily-complete .complete-score span').textContent = 'PRACTICE POINTS';
        $('#daily-return-today').hidden = false;
        $('#daily-return-today').textContent = "Return to today's Atlas";
        state.runId = null;
        state.advancing = false;
        loadFlightDistribution(state.practice.date);
        return;
      }
      state.practice.index = index;
      updateQuestion(state.practice.questions[index], index);
      setDailySection('daily-play');
      startDailyTimer(25);
      $('#daily-answer').focus();
      button.disabled = false;
      state.advancing = false;
      return;
    }
    if (index >= 7) {
      playSound('daily-complete');
      clearDailyReaction();
      setDailySection('daily-complete');
      renderDailyRecap();
      $('#daily-flight-summary').hidden=false;
      $('.daily-complete .eyebrow').textContent = "TODAY'S ATLAS COMPLETE";
      $('.daily-complete .complete-score span').textContent = 'PROVISIONAL POINTS';
      $('#complete-score').textContent = number.format(state.provisionalScore);
      $('#complete-summary').textContent = 'You completed all seven questions in ' + fmtDate(state.daily.date) + '.';
      $('#daily-return-today').hidden = true;
      state.runId = null;
      state.advancing = false;
      loadFlightDistribution(state.daily.date);
      await Promise.all([loadDailyMiniRanking(), loadProfile(true)]);
      return;
    }
    try {
      const result = await api('/daily/next', {
        method: 'POST',
        body: { guestId: state.guestId, runId: state.runId, index }
      });
      updateQuestion(result.question, result.index);
      state.hintUsed = Boolean(result.hintUsed);
      $('#daily-hint').disabled = state.hintUsed;
      $('#hint-counter').textContent = state.hintUsed ? '0 / 1' : '1 / 1';
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
      let examples;
      if (state.unlimited || state.practice) {
        examples = state.question.hints && state.question.hints.length
          ? state.question.hints
          : (state.question.answers || []).slice(0, 3).map(item => item.answer);
      } else {
        const result = await api('/daily/hint', { method: 'POST', body: { guestId: state.guestId, runId: state.runId } });
        examples = result.examples || [];
      }
      state.hintUsed = true;
      playSound('hint');
      $('#hint-counter').textContent = '0 / 1';
      $('#hint-box').hidden = false;
      $('#hint-box').textContent = 'Examples: ' + examples.join(' · ');
    } catch (error) { toast(error.message); $('#daily-hint').disabled = false; }
  }

  async function loadPracticePacks() {
    const panel=$('#practice-pack-list');
    panel.innerHTML='<p class="archive-loading">Loading themed expeditions…</p>';
    try {
      const result=await api('/practice/packs');
      const packs=result.packs||[];
      panel.innerHTML=packs.map(pack=>
        '<article class="practice-pack-card"><span class="practice-pack-icon">'+esc(pack.icon||'◎')+'</span>'+
        '<div class="practice-pack-copy"><span class="micro-label">'+number.format(pack.questionCount)+' QUESTION TOPICS</span>'+
        '<strong>'+esc(pack.title)+'</strong><p>'+esc(pack.description)+'</p></div>'+
        '<button class="button button-primary" type="button" data-practice-pack="'+esc(pack.id)+'">PLAY ↗</button></article>'
      ).join('')||'<p class="empty-room-note">No themed packs are available yet.</p>';
    } catch(error){panel.innerHTML='<p class="empty-room-note">'+esc(error.message)+'</p>';}
  }

  async function startUnlimited(packId) {
    playSound('launch');
    const buttons=$$('[data-practice-pack]');
    buttons.forEach(button=>button.disabled=true);
    try {
      const result=await api('/practice/start',{method:'POST',body:{guestId:state.guestId,packId}});
      trackAnalytics('practice_start',{game:'practice_lab',pack:packId});
      closeModal('practice-modal');
      stopDailyTimer();
      state.practice=null;
      state.unlimited={runId:result.runId,packId:result.pack.id,title:result.pack.title,questionsPlayed:0,finished:false};
      state.runId=result.runId;
      state.dailyHistory=[];
      state.provisionalScore=0;
      state.pendingNextIndex=null;
      state.advancing=false;
      state.ascentMaxPoints=700;
      resetAscent();
      setAscentVisible(true);
      $('#edition-label').textContent='PRACTICE LAB';
      $('#edition-date').textContent=result.pack.title;
      $('#attempt-label').textContent='UNLIMITED · UNRANKED';
      $('#daily-return-today').hidden=true;
      $('#daily-flight-summary').hidden=true;
      updateQuestion(result.question,0);
      setDailySection('daily-play');
      $('#daily-answer').focus();
      $('#daily-play').scrollIntoView({behavior:state.animations?'smooth':'auto',block:'center'});
    } catch(error){toast(error.message);}
    finally{buttons.forEach(button=>button.disabled=false);}
  }

  async function finishUnlimited() {
    if(!state.unlimited||state.unlimited.finished)return;
    stopDailyTimer();
    try {
      const result=await api('/practice/finish',{method:'POST',body:{guestId:state.guestId,runId:state.runId}});
      state.unlimited.finished=true;
      playSound('daily-complete');
      state.provisionalScore=Number(result.score||state.provisionalScore);
      state.lastPracticeLabel=result.pack.title;
      state.runId=null;
      renderDailyRecap();
      setDailySection('daily-complete');
      $('.daily-complete .eyebrow').textContent='PRACTICE SESSION COMPLETE';
      $('.daily-complete h2').textContent='Keep exploring.';
      $('.daily-complete .complete-score span').textContent='PRACTICE POINTS';
      $('#complete-score').textContent=number.format(state.provisionalScore);
      $('#complete-summary').textContent='You explored '+number.format(result.questionsPlayed)+' questions in '+result.pack.title+'. This session does not affect official rankings.';
      $('#daily-flight-summary').hidden=true;
      $('#daily-return-today').hidden=false;
      $('#daily-return-today').textContent="Return to today's Atlas";
    } catch(error){toast(error.message);}
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
    if (state.runId && !state.practice) {
      toast('Finish today’s official Atlas before replaying an earlier edition.');
      return;
    }
    try {
      const result = await api('/daily/archive/' + encodeURIComponent(date));
      const questions = Array.isArray(result.questions) ? result.questions : [];
      if (questions.length !== 7 || questions.some(question => !Array.isArray(question.answers))) {
        throw new Error('This archived edition is incomplete and cannot be replayed.');
      }
      closeModal('archive-modal');
      stopDailyTimer();
      state.practice = { date: result.date, questions, index: 0, finished: false };
      state.unlimited = null;
      state.dailyHistory = [];
      state.runId = 'archive:' + result.date;
      state.pendingNextIndex = null;
      state.advancing = false;
      state.provisionalScore = 0;
      state.ascentMaxPoints = questions.reduce((sum, question) => {
        const best = Math.max(0, ...(question.answers || []).map(entry => Number(entry.points) || 0));
        return sum + best;
      }, 0) || 700;
      resetAscent();
      setAscentVisible(true);
      $('#edition-label').textContent = 'ARCHIVE EDITION';
      $('#edition-date').textContent = fmtDate(result.date);
      $('#attempt-label').textContent = 'ARCHIVE REPLAY · PRACTICE';
      $('#daily-return-today').hidden = true;
      $('.daily-complete .eyebrow').textContent = 'ARCHIVE HIGH RISE COMPLETE';
      $('.daily-complete .complete-score span').textContent = 'PRACTICE POINTS';
      updateQuestion(questions[0], 0);
      setDailySection('daily-play');
      startDailyTimer(25);
      $('#daily-answer').focus();
      $('#daily-panel-title').textContent = 'Ready to explore?';
      $('#daily-play').scrollIntoView({ behavior: state.animations ? 'smooth' : 'auto', block: 'center' });
    } catch (error) { toast(error.message); }
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
      const missing = [!google ? 'Google' : '', !discord ? 'Discord' : ''].filter(Boolean);
      note.hidden = missing.length === 0;
      note.textContent = missing.length
        ? missing.join(' and ') + ' sign-in ' + (missing.length === 1 ? 'is' : 'are') +
          ' not configured yet. Username/password accounts already work; first social sign-in creates a free account automatically.'
        : '';
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
    renderPlanetAvatarOptions();
    if (!player) {
      state.profileStats = null;
      $('#account-avatar').textContent = '?';
      $('#account-label').textContent = 'Sign in';
      $('#admin-open').hidden = true;
      $('#streak-number').textContent = '— days';
      if ($('#profile-avatar-collection')) $('#profile-avatar-collection').innerHTML = '';
      if ($('#profile-history')) $('#profile-history').innerHTML = '';
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
  function formatPlayTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return hours ? hours + 'h ' + minutes + 'm' : minutes + 'm';
  }
  function renderProfileStats(stats, player) {
    const target = $('#profile-stats');
    if (!target || !player) return;
    const xp = Math.max(0, Number(player.xp || 0));
    const level = Math.max(1, Number(player.level || 1));
    const levelProgress = xp % 500;
    const pct = levelProgress / 500 * 100;
    target.innerHTML =
      '<div><span>LEVEL</span><b>' + number.format(level) + '</b></div>' +
      '<div><span>TOTAL XP</span><b>' + number.format(xp) + '</b></div>' +
      '<div><span>RANKED RATING</span><b>' + number.format(player.partyRating || 1000) + '</b></div>' +
      '<div><span>PLAY TIME</span><b>' + formatPlayTime(stats.totalPlaySeconds) + '</b></div>' +
      '<div><span>ATLAS DAILIES</span><b>' + number.format(stats.dailyGames || 0) + '</b></div>' +
      '<div><span>BEST DAILY SCORE</span><b>' + number.format(stats.bestDailyScore || 0) + '</b></div>' +
      '<div><span>GLOBE RUSH WINS</span><b>' + number.format(stats.partyWins || 0) + '</b></div>' +
      '<div><span>TEAM RUSH WINS</span><b>' + number.format(stats.teamRushWins || 0) + '</b></div>' +
      '<div><span>SURVIVAL GAMES</span><b>' + number.format(stats.survivalGames || 0) + '</b></div>' +
      '<div><span>ACCEPTED ATLAS ANSWERS</span><b>' + number.format(stats.correctAnswers || 0) + '</b></div>' +
      '<div><span>UNIQUE ATLAS ANSWERS</span><b>' + number.format(stats.uniqueAnswers || 0) + '</b></div>' +
      '<div><span>PERFECT ATLAS DAILIES</span><b>' + number.format(stats.perfectDailies || 0) + '</b></div>' +
      '<div class="profile-level-progress"><span>NEXT LEVEL · ' + number.format(500 - levelProgress) + ' XP TO GO</span>' +
      '<i><b style="width:' + pct.toFixed(1) + '%"></b></i></div>';
  }
  function renderProfileAvatarCollection() {
    const root = $('#profile-avatar-collection');
    if (!root) return;
    const streak = Math.max(0, Number(state.player && state.player.dailyStreak || 0));
    const selected = selectedPlanetAvatar();
    const adminAssigned = Boolean(state.player && state.player.avatarLocked);
    root.innerHTML = '<div class="profile-avatar-heading"><span class="micro-label">PLANET COLLECTION</span>' +
      '<strong>Choose your orbit avatar</strong><small>' + streak + ' consecutive Atlas Daily days · unlock more planets as your streak grows</small></div>' +
      (adminAssigned ? '<p class="profile-avatar-admin-note">Your planet avatar was assigned by a HUMANITY administrator and is currently locked.</p>' : '') +
      '<div class="profile-avatar-grid">' + PLANET_AVATARS.map(planet => {
        const streakLocked = streak < planet.streak;
        const locked = adminAssigned || streakLocked;
        const status = adminAssigned
          ? (selected === planet.id ? 'ADMIN ASSIGNED' : 'ADMIN LOCKED')
          : (streakLocked ? planet.streak + ' DAY STREAK' : selected === planet.id ? 'SELECTED' : 'UNLOCKED');
        return '<button class="profile-planet-choice' + (selected === planet.id ? ' selected' : '') + (locked ? ' locked' : '') +
          '" type="button" data-profile-avatar="' + planet.id + '"' + (locked ? ' disabled aria-disabled="true"' : '') +
          ' title="' + (adminAssigned ? 'This avatar collection is locked by a HUMANITY administrator' : (streakLocked ? 'Reach a ' + planet.streak + '-day streak to unlock ' + planet.name : 'Use ' + planet.name)) + '">' +
          '<span class="planet-avatar-visual planet-avatar-' + planet.id + '"></span><b>' + planet.name + '</b>' +
          '<small>' + status + '</small></button>';
      }).join('') + '</div>';
  }
  function renderProfileHistory(entries) {
    const target = $('#profile-history');
    if (!target) return;
    const items = Array.isArray(entries) ? entries.slice(0, 12) : [];
    target.innerHTML = '<div class="profile-history-heading"><span class="micro-label">EXPLORER LOGBOOK</span>' +
      '<strong>Recent activity</strong><small>Your latest official Atlas Daily and Globe Rush results.</small></div>' +
      (items.length ? '<div class="profile-history-list">' + items.map(item => {
        const date = new Date(String(item.date || '') + 'T00:00:00Z');
        const dateLabel = Number.isFinite(date.getTime())
          ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
          : String(item.date || '—');
        const daily = item.kind === 'atlas-daily';
        const variant = String(item.variant || 'classic').replace(/-/g, ' ').toUpperCase();
        const mode = String(item.gameMode || 'quick').toUpperCase();
        const label = daily ? 'ATLAS DAILY' : variant + ' · ' + mode;
        const result = daily ? 'COMPLETED' : String(item.result || 'PLAYED');
        const scoreLabel = daily ? 'DISCOVERY POINTS' : 'MATCH POINTS';
        const rankLabel = !daily && item.rank ? ' · #' + number.format(item.rank) : '';
        return '<article class="profile-history-row ' + (result === 'WON' ? 'is-win' : '') + '">' +
          '<div class="profile-history-main"><strong>' + esc(label) + '</strong><small>' + esc(dateLabel) + rankLabel + '</small></div>' +
          '<div class="profile-history-result"><b>' + number.format(item.score || 0) + '</b><small>' + scoreLabel + '</small></div>' +
          '<span class="profile-history-status">' + esc(result) + '</span></article>';
      }).join('') + '</div>' : '<p class="profile-history-empty">Your completed runs will appear here.</p>');
  }
  function renderProfileAchievements(achievements,stats) {
    const target=$('#profile-achievements');
    if(!target)return;
    const items=Array.isArray(achievements)?achievements:[];
    const current=Number(stats&&stats.currentStreak||0),best=Number(stats&&stats.bestStreak||0);
    target.innerHTML='<div class="profile-achievement-heading"><span class="micro-label">EXPLORER PASSPORT</span>'+
      '<strong>Achievements & milestones</strong></div><div class="profile-streak-strip">'+
      '<span>STREAK NOW <b>'+number.format(current)+' days</b></span>'+
      '<span>BEST STREAK <b>'+number.format(best)+' days</b></span></div>'+
      '<div class="profile-achievement-grid">'+items.map(item=>{
        const progress=Math.max(0,Math.min(100,Number(item.progress||0)/Math.max(1,Number(item.target||1))*100));
        return '<article class="profile-achievement '+(item.unlocked?'is-unlocked':'is-locked')+'">'+
          '<span class="achievement-mark">'+(item.unlocked?'✦':'◇')+'</span><div><strong>'+esc(item.title)+'</strong>'+
          '<small>'+esc(item.description)+'</small><div class="achievement-progress"><i style="width:'+progress.toFixed(1)+'%"></i></div>'+
          '<em>'+(item.unlocked?'UNLOCKED':number.format(item.progress||0)+' / '+number.format(item.target||1))+'</em></div></article>';
      }).join('')+'</div>';
  }
  async function loadProfile(silent) {
      if (!state.token) { setAccountUI(null); return null; }
    try {
      const result = await api('/profile/me');
      setAccountUI(result.player);
      state.profileStats = result.stats || {};
      renderProfileStats(state.profileStats, result.player);
      renderProfileAvatarCollection();
      renderProfileHistory(result.recentActivity || []);
      renderProfileAchievements(result.achievements||[],result.stats||{});
      return result;
    } catch (_) {
      state.token = '';
      localStorage.removeItem('humanity-session-token');
      setAccountUI(null);
      state.profileStats = null;
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
      playSound('join');
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
    }
    const signedIn = Boolean(state.token && state.player);
    $('#account-signed-out').hidden = signedIn;
    $('#account-signed-in').hidden = !signedIn;
    if (!signedIn) setAuthMode('login');
    openModal('account-modal');
  }

  function setPartyConnectionStatus(status, label) {
    const badge = $('#party-connection-status');
    if (!badge) return;
    badge.className = 'party-connection-pill is-' + status;
    badge.textContent = label;
  }
  function schedulePartyReconnect() {
    if (state.isLeavingRoom || !state.roomCode || !state.resumeToken || state.reconnectTimer) return;
    if (state.reconnectAttempts >= 8) {
      setPartyConnectionStatus('offline', 'RECONNECT FAILED');
      toast('Globe Rush could not reconnect. Your room may still be available for a short time.');
      return;
    }
    const delays = [700, 1200, 1800, 2600, 3600, 4800, 6200, 7800];
    const delay = delays[state.reconnectAttempts] || 7800;
    state.reconnectAttempts += 1;
    setPartyConnectionStatus('reconnecting', 'RECONNECTING · ' + state.reconnectAttempts + '/8');
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (state.isLeavingRoom || !state.roomCode || !state.resumeToken) return;
      connectSocket({ type: 'reconnect', code: state.roomCode, resumeToken: state.resumeToken });
    }, delay);
  }
  function connectSocket(action) {
    if (action && action.type !== 'reconnect') {
      state.isLeavingRoom = false;
      state.reconnectAttempts = 0;
    }
    if (state.ws && state.ws.readyState === WebSocket.OPEN) { sendSocket(action); return; }
    if (state.ws && state.ws.readyState === WebSocket.CONNECTING) { state.wsPending = action; return; }
    state.wsPending = action;
    const socket = new WebSocket(SOCKET_URL);
    state.ws = socket;
    socket.addEventListener('open', () => {
      if (state.ws !== socket) return;
      if (state.wsHeartbeatTimer) clearInterval(state.wsHeartbeatTimer);
      state.wsHeartbeatSocket = socket;
      state.wsHeartbeatTimer = setInterval(() => {
        if (state.ws === socket && socket.readyState === WebSocket.OPEN) {
          try { socket.send(JSON.stringify({ type: 'heartbeat' })); } catch (_) { /* close handler retries */ }
        }
      }, 5000);
    });
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch (_) { return; }
      handleSocketMessage(message);
    });
    socket.addEventListener('close', () => {
      if (state.wsHeartbeatSocket === socket) {
        if (state.wsHeartbeatTimer) clearInterval(state.wsHeartbeatTimer);
        state.wsHeartbeatTimer = null;
        state.wsHeartbeatSocket = null;
      }
      if (state.ws !== socket) return;
      state.ws = null;
      if (state.roomCode && state.resumeToken && !state.isLeavingRoom) {
        setPartyConnectionStatus('reconnecting', 'CONNECTION LOST');
        schedulePartyReconnect();
      }
    });
    socket.addEventListener('error', () => {
      if (!state.roomCode) toast('Could not connect to Globe Rush. Please try again.');
      else setPartyConnectionStatus('reconnecting', 'RETRYING CONNECTION');
    });
  }
  function sendSocket(message) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) { state.wsPending = message; return; }
    state.ws.send(JSON.stringify(message));
  }

    function handleSocketMessage(message) {
    if (message.type === 'connected') {
      if (state.wsPending) { const pending = state.wsPending; state.wsPending = null; sendSocket(pending); }
    } else if (message.type === 'joined') {
      const wasReconnect = Boolean(message.reconnected || message.migrated);
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
      state.reconnectAttempts = 0;
      state.isLeavingRoom = false;
      playSound(wasReconnect ? 'toggle' : 'join');
      state.roomCode = message.roomCode;
      state.playerId = message.playerId;
      state.resumeToken = message.resumeToken || state.resumeToken;
      sessionStorage.setItem('humanity-room-code', state.roomCode);
      if (state.resumeToken) sessionStorage.setItem('humanity-room-resume-token', state.resumeToken);
      setPartyConnectionStatus('live', wasReconnect ? 'CONNECTION RESTORED' : 'LIVE CONNECTION');
      $('#room-code-display').textContent = message.roomCode;
      $('#planet-room-code').textContent = message.roomCode;
      $('#party-lobby').hidden = true;
      $('#party-room').hidden = false;
      if (!wasReconnect) {
        $('#room-lobby-state').hidden = false;
        $('#room-game-state').hidden = true;
        $('#room-results-state').hidden = true;
        clearGlobeRushEffects();
        $('#party-room').scrollIntoView({ behavior: state.animations ? 'smooth' : 'auto', block: 'start' });
      } else if (!state.room) {
        $('#room-lobby-state').hidden = false;
        $('#room-game-state').hidden = true;
        $('#room-results-state').hidden = true;
      }
      if (wasReconnect) toast(message.migrated ? 'Your queue moved to a smaller match.' : 'You are back in your Globe Rush room.');
    } else if (message.type === 'room_state') {
      const previousRoom = state.room;
      state.room = message;
      renderRoomState(message, previousRoom);
    } else if (message.type === 'queue_adjusted') {
      toast(message.message || 'The waiting group has been resized to start a match.');
    } else if (message.type === 'room_settings_saved') {
      playSound('toggle');
      $('#private-settings-feedback').textContent = 'Settings saved for this room.';
    } else if (message.type === 'timer') {
      updatePartyTimer(message.remainingMs, message.holderId, message.durationMs);
    } else if (message.type === 'answer_suggestion') {
      const input = $('#rush-answer');
      if (Number(message.requestId) !== state.partySuggestionSequence ||
          message.categoryId !== state.room?.category?.id ||
          input.value.trim() !== message.typed) return;
      const panel = $('#rush-suggestion');
      if (!message.suggestion) {
        state.pendingPartySuggestion = null;
        panel.hidden = true;
        panel.innerHTML = '';
      } else {
        state.pendingPartySuggestion = { input: message.typed, answer: message.suggestion };
        panel.innerHTML = '<span class="suggestion-copy">DID YOU MEAN?</span><button class="suggestion-choice" type="button" data-use-rush-suggestion>' +
          esc(message.suggestion) + '<span>PRESS ENTER TO USE</span></button>';
        panel.hidden = false;
        if (message.submitted) {
          $('#rush-submit').disabled = false;
          $('#rush-feedback').textContent = 'Did you mean “' + message.suggestion + '”? Press Enter to insert it, then submit again.';
          $('#rush-feedback').classList.remove('success');
        }
      }
    } else if (message.type === 'answer_accepted') {
      $('#rush-feedback').textContent = message.nickname + ' named ' + message.answer + ' · ' + message.level +
        ' · +' + message.points + ' Discovery Points' + (message.gainedHeart ? ' · +1 Stability Point!' : '');
      $('#rush-feedback').classList.add('success');
      if (message.playerId && message.playerId === state.playerId) {
        $('#rush-answer').value = '';
        clearPartySuggestion();
      }
      playSound('orb-pass');
      if (message.gainedHeart) playSound('power-up');
    } else if (message.type === 'orb_overload') {
      const stage = $('#orb-stage');
      clearTimeout(state.orbOverloadTimer);
      stage.classList.remove('pressure', 'warning', 'critical');
      stage.style.setProperty('--orb-scale', '1.42');
      stage.classList.add('overload');
      state.orbOverloadTimer = setTimeout(() => {
        stage.classList.remove('overload');
        stage.style.setProperty('--orb-scale', '1');
        state.orbOverloadTimer = null;
      }, 1450);
      $('#rush-feedback').textContent = message.nickname + ' held the Atlas Orb when it overloaded.' +
        (message.eliminated ? ' Eliminated.' : ' One Stability Point lost.');
      $('#rush-feedback').classList.remove('success');
      playSound(message.eliminated && message.nickname === nickname() ? 'eliminated' : 'overload');
    } else if (message.type === 'new_round') {
      playSound('category');
      const reason = message.reason === 'overload'
        ? 'The Orb popped · new category'
        : 'A new round is ready';
      $('#rush-feedback').textContent = reason + ' · ' + message.category.title;
      $('#rush-feedback').classList.remove('success');
      showCategoryAnnouncement(message.category, message.reason);
    } else if (message.type === 'match_ready') {
      playSound('match-ready');
      if (state.roomLaunchTimer) clearInterval(state.roomLaunchTimer);
      const duration = Math.max(0, Number(message.startsInMs || 0));
      const deadline = Date.now() + duration;
      const updateLaunchCountdown = () => {
        const remaining = Math.max(0, deadline - Date.now());
        $('#room-status-note').textContent = remaining > 0
          ? 'Match starts in ' + Math.ceil(remaining / 1000) + ' seconds · players can still join.'
          : 'Launching Globe Rush now…';
        if (remaining <= 0 && state.roomLaunchTimer) {
          clearInterval(state.roomLaunchTimer);
          state.roomLaunchTimer = null;
        }
      };
      updateLaunchCountdown();
      if (duration > 0) state.roomLaunchTimer = setInterval(updateLaunchCountdown, 200);
      $('#room-start').hidden = true;
    } else if (message.type === 'game_started') {
      playSound('match-ready');
    } else if (message.type === 'room_chat') {
      if (message.nickname !== nickname()) playSound('chat');
      renderRoomChatMessage(message);
    } else if (message.type === 'game_over') {
      const localPlayer = state.room && state.room.players.find(player => player.isYou);
      const didWin = message.results.variant === 'team-rush'
        ? Boolean(localPlayer && localPlayer.team && localPlayer.team === message.results.winningTeam)
        : Boolean(localPlayer && localPlayer.nickname === message.results.winner);
      playSound(didWin ? 'victory' : 'defeat');
      state.result = message.results;
      renderPartyResults(message.results);
      if (state.token) loadProfile(true);
    } else if (message.type === 'room_closed') {
      toast(message.message || 'This Globe Rush room has closed.');
      resetRoomUI();
    } else if (message.type === 'error') {
      if (message.code === 'reconnect_failed') {
        toast(message.message || 'The previous room seat is no longer available.');
        resetRoomUI();
        return;
      }
      playSound('miss');
      if (message.code === 'invalid_capacity' || message.code === 'settings_locked' || message.code === 'not_room_host') {
        $('#private-settings-feedback').textContent = message.message || 'Room settings could not be saved.';
      }
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
  function renderOrbCrew(room) {
    const field = $('#orb-player-field');
    const stream = $('#orb-player-stream');
    if (!field || !stream) return;
    const players = Array.isArray(room.players) ? room.players : [];
    const count = players.length;
    if (!count) { field.innerHTML = ''; stream.innerHTML = ''; field.classList.remove('is-crowded'); return; }

    const crowded = count > 6;
    field.classList.toggle('is-crowded', crowded);
    const positions = players.map((player, index) => {
      if (crowded) {
        const rowIndex = Math.floor(index / 5);
        const rowCount = Math.min(5, count - rowIndex * 5);
        const columnIndex = index % 5;
        const x = rowCount === 1 ? 50 : 12 + (76 * columnIndex / (rowCount - 1));
        return { x, y: rowIndex === 0 ? 17 : 83 };
      }
      const angle = -Math.PI / 2 + Math.PI / count + (Math.PI * 2 * index / count);
      return { x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 29 };
    });
    field.innerHTML = players.map((player, index) => {
      const holder = player.id === room.currentHolderId || player.isHolder;
      const eliminated = player.alive === false;
      const label = holder ? 'HOLDING THE ORB' : eliminated ? 'ELIMINATED' :
        player.isConnected ? 'IN ORBIT' : 'RECONNECTING';
      return '<div class="orb-player-marker' + (holder ? ' is-holder' : '') +
        (eliminated ? ' is-out' : '') + '" style="left:' + positions[index].x.toFixed(2) +
        '%;top:' + positions[index].y.toFixed(2) + '" title="' + esc(player.nickname) +
        (holder ? ' — current turn' : '') + '">' +
        '<span class="orb-player-avatar planet-avatar planet-avatar-' + planetAvatarKey(player.avatarKey) + '" aria-hidden="true"></span>' +
        '<span class="orb-player-copy"><b>' + esc(player.nickname) + '</b><small>' + label +
        '</small></span></div>';
    }).join('');

    // Clamp each card using its rendered dimensions so no nameplate can be cropped by the arena.
    const bounds = field.getBoundingClientRect();
    if (bounds.width && bounds.height) {
      [...field.querySelectorAll('.orb-player-marker')].forEach((marker, index) => {
        const insetX = (marker.offsetWidth / 2 + 7) / bounds.width * 100;
        const insetY = (marker.offsetHeight / 2 + 7) / bounds.height * 100;
        const x = Math.max(insetX, Math.min(100 - insetX, positions[index].x));
        const y = Math.max(insetY, Math.min(100 - insetY, positions[index].y));
        marker.style.left = x.toFixed(2) + '%';
        marker.style.top = y.toFixed(2) + '%';
      });
    }

    const holderIndex = players.findIndex(player => player.id === room.currentHolderId || player.isHolder);
    if (holderIndex < 0) { stream.innerHTML = ''; return; }
    const start = positions[holderIndex];
    stream.innerHTML = [0.24, 0.48, 0.72].map((fraction, index) => {
      const x = start.x + (50 - start.x) * fraction;
      const y = start.y + (50 - start.y) * fraction;
      return '<i class="orb-player-bubble bubble-' + (index + 1) +
        '" style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) +
        '%;--bubble-delay:' + (index * 0.18) + 's"></i>';
    }).join('');
  }

  function renderRoomState(room, previousRoom) {
    if (previousRoom && Array.isArray(previousRoom.players) && Array.isArray(room.players)) {
      if (room.players.length > previousRoom.players.length) playSound('join');
      else if (room.players.length < previousRoom.players.length) playSound('leave');
    }
    if (previousRoom && previousRoom.phase === 'playing' && room.phase === 'playing' &&
        previousRoom.category?.id !== room.category?.id) {
      $('#rush-answer').value = '';
      clearPartySuggestion();
    }
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
    const settings = room.settings || {};
    const variant = room.variant || 'classic';
    const startingLives = Math.max(1, Number(settings.startingLives || 2));
    const maximumLives = Math.max(startingLives, Number(settings.maxLives || 3));
    $('#planet-game-mode').textContent = variant === 'team-rush' ? 'TEAM RUSH' : variant === 'survival' ? 'SURVIVAL' : (settings.gameMode === 'sudden-death' ? 'SUDDEN DEATH' : 'CLASSIC');
    $('#planet-difficulty').textContent = String(room.currentDifficulty || settings.difficulty || 'normal').toUpperCase();
    $('#planet-theme').textContent = String(settings.categoryTheme || 'all').replace(/-/g, ' ').toUpperCase();
    $('#planet-rating').textContent = room.mode === 'ranked' || settings.ratingEnabled ? 'ON · RATED' : 'OFF · CASUAL';
    $('#planet-starting-lives').textContent = startingLives + (startingLives === 1 ? ' LIFE' : ' LIVES');
    $('#planet-max-lives').textContent = maximumLives + ' LIVES';
    $('#planet-turn-clock').textContent = Number(settings.turnDurationSeconds) > 0
      ? 'SHARED · ' + Number(settings.turnDurationSeconds) + ' SEC' : 'SHARED · RANDOM 10–30 SEC';
    $('#planet-category-rule').textContent = 'NEW CATEGORY AFTER ORB POP';
    const privateSettings = $('#planet-private-settings');
    const canEditPrivateSettings = lobby && hostIsYou && Boolean(room.isHostedRoom);
    privateSettings.hidden = !canEditPrivateSettings;
    $('#planet-room-visibility').textContent = room.visibility === 'public' ? 'PUBLIC' : 'PRIVATE';
    if (canEditPrivateSettings) {
      $('#private-capacity').value = String(capacity);
      [...$('#private-capacity').options].forEach(option => {
        option.disabled = Number(option.value) < room.players.length;
      });
      $('#private-starting-lives').value = String(startingLives);
      $('#private-max-lives').value = String(maximumLives);
      $('#private-turn-duration').value = String(Number(settings.turnDurationSeconds || 0));
      $('#private-visibility').value = room.visibility === 'public' ? 'public' : 'private';
      $('#private-game-mode').value = settings.gameMode === 'sudden-death' ? 'sudden-death' : 'classic';
      $('#private-difficulty').value = settings.difficulty || 'normal';
      $('#private-category-theme').value = settings.categoryTheme || 'all';
      $('#private-countdown').value = String(Number(settings.countdownSeconds ?? 5));
      $('#private-rated').checked = room.mode === 'ranked' || settings.ratingEnabled === true;
      $('#private-auto-start').checked = settings.autoStartWhenFull === true;
      $('#private-game-variant').value = room.variant || 'classic';
    }
    const autoStarting = room.autoStartInMs !== null && room.autoStartInMs !== undefined;
    if (!autoStarting && state.roomLaunchTimer) {
      clearInterval(state.roomLaunchTimer);
      state.roomLaunchTimer = null;
    }
    const nearlyFull = lobby && !room.isHostedRoom && room.visibility === 'private' &&
      room.players.length >= Math.max(2, Number(room.targetMin || 2), capacity - 1);
    $('#room-status-note').textContent = lobby
      ? (autoStarting
        ? 'The match countdown has started. New explorers can still join until the launch.'
        : room.players.length + ' of ' + capacity + ' explorers aboard · Invite friends with this room code.')
      : room.players.length + ' explorers on this mission.';
    const seats = Array.from({ length: capacity }, (_, index) => {
      const player = room.players[index];
      const hue = (index * 47 + 166) % 360;
      const seatClass = 'planet-seat' + (player ? ' occupied' : ' open') + (player && player.isYou ? ' is-you' : '');
      const name = player ? esc(player.nickname) : 'OPEN SLOT';
      const status = player
        ? (player.isHost ? 'HOST' : 'EXPLORER') + ' · ' + (player.isConnected ? 'ONLINE' : 'RECONNECTING')
        : 'AWAITING PLAYER';
      const avatar = player ? planetAvatarKey(player.avatarKey) : 'mercury';
      return '<div class="' + seatClass + '" style="--sprite-hue:' + hue + 'deg">' +
        '<span class="planet-seat-avatar planet-avatar planet-avatar-' + avatar + '" aria-hidden="true"></span>' +
        '<span class="planet-seat-platform" aria-hidden="true"></span>' +
        '<span class="planet-seat-name">' + name + '</span>' +
        '<span class="planet-seat-status">' + status + '</span>' +
        '</div>';
    }).join('');
    $('#room-lobby-players').innerHTML = seats;
    $('#planet-roster-count').textContent = room.players.length + ' ONLINE';
    $('#planet-player-roster').innerHTML = room.players.map(player =>
      '<div class="planet-roster-row ' + (player.isYou ? 'is-you' : '') + '">' +
      '<span class="planet-roster-dot planet-avatar planet-avatar-' + planetAvatarKey(player.avatarKey) + '"></span><span class="planet-roster-name">' + esc(player.nickname) + '</span>' +
      '<small>' + (player.isHost ? 'HOST' : (player.isConnected ? 'ONLINE' : 'OFFLINE')) + '</small></div>'
    ).join('') || '<div class="planet-roster-empty">Waiting for explorers…</div>';
    $('#room-start').hidden = !lobby || !hostIsYou || autoStarting || nearlyFull;
    $('#room-start').disabled = room.players.length < 2;
    $('#room-start').textContent = room.players.length < 2 ? 'WAITING FOR YOUR CREW' : 'START GLOBE RUSH';
    renderRoomChat(room.chatMessages || []);
    if (playing && room.category) {
      renderOrbCrew(room);
      $('#rush-round').textContent = String(room.round).padStart(2, '0');
      $('#rush-turn').textContent = String(room.turnNumber || 1).padStart(2, '0');
      $('#rush-category').textContent = room.category.prompt || room.category.title;
      const fuseDescription = room.variant === 'survival'
        ? 'SURVIVAL · ' + String(room.currentDifficulty || 'easy').toUpperCase() + ' difficulty · ' + Number(room.timerDurationMs || 22000) / 1000 + ' seconds'
        : (Number(room.settings?.turnDurationSeconds) > 0
          ? 'A shared ' + Number(room.settings.turnDurationSeconds) + '-second fuse'
          : 'One shared random 10–30 second fuse');
      const categoryNote = room.category.note ? ' ' + room.category.note : '';
      const modeNote = room.variant === 'team-rush' ? ' Team Rush · Team Nova vs Team Terra. Keep your teammates in orbit.' : room.variant === 'survival' ? ' Every two rounds the fuse gets shorter and question difficulty rises.' : '';
      $('#rush-note').textContent = fuseDescription +
        ' keeps running as the Orb is passed. Valid rare answers build your bonus-heart meter.' + modeNote + categoryNote;
      const meForMeter = room.players.find(player => player.isYou);
      const rarityProgress = Math.max(0, Math.min(100,
        Number(meForMeter?.rarityMeter || 0) / 150 * 100));
      const rarityPoints = Math.max(0, Math.min(150, Number(meForMeter?.rarityMeter || 0)));
      const usedCount = Array.isArray(room.usedAnswers) ? room.usedAnswers.length : 0;
      $('#category-cycle').innerHTML =
        '<div class="category-cycle-stat rarity-meter-stat"><span>YOUR NEXT BONUS HEART</span><b>' +
        rarityPoints + ' / 150</b><i><span style="width:' + rarityProgress + '%"></span></i></div>' +
        '<div class="category-cycle-stat used-meter-stat"><span>ANSWERS ALREADY USED</span><b>' +
        usedCount + '</b><i aria-hidden="true"></i></div>';
      $('#used-answer-list').innerHTML = room.usedAnswers.length
        ? room.usedAnswers.map(answer => '<span class="used-answer-chip">' + esc(answer) + '</span>').join('')
        : '<span class="empty-used">No answers yet.</span>';
      const maxLives = Math.max(1, Number(room.settings?.maxLives || 3));
      $('#rush-player-list').innerHTML = room.players.map(player =>
        '<div class="rush-player-row ' + (player.isHolder ? 'current' : '') + ' ' + (!player.alive ? 'out' : '') + '">' +
        '<span class="rush-player-name"><b>' + (player.isHolder ? '● ' : '') + esc(player.nickname) + (player.isYou ? ' (you)' : '') + '</b>' +
        '<small>' + (player.team ? (player.team === 'nova' ? 'TEAM NOVA · ' : 'TEAM TERRA · ') : '') + number.format(player.turnsTaken || 0) + ' turns · ' + number.format(player.answersGiven || 0) + ' valid answers</small></span>' +
        '<span class="rush-player-hearts">' + '♥'.repeat(player.hearts) + '♡'.repeat(Math.max(0,maxLives-player.hearts)) + '</span>' +
        '<span class="rush-player-score">' + number.format(player.score) + '</span></div>'
      ).join('');
      const me = room.players.find(player => player.isYou);
      const previousMe = previousRoom && previousRoom.players && previousRoom.players.find(player => player.isYou);
      const holding = Boolean(me && me.isHolder && me.alive);
      $('#rush-answer-area').hidden = false;
      const holder = room.players.find(player => player.id === room.currentHolderId);
      $('#orb-holder-label').textContent = holder ? 'THE ORB IS WITH ' + holder.nickname.toUpperCase() : 'THE ORB IS MOVING';
      $('#rush-answer').disabled = !me || !me.alive;
      $('#rush-answer').placeholder = holding ? 'Your turn — press Enter…' : 'Prepare your next answer…';
      $('#rush-submit').disabled = !holding;
      $('#rush-submit').innerHTML = holding
        ? 'PASS THE ORB <span aria-hidden="true">↗</span>'
        : 'READY FOR YOUR TURN';
      if (holding && (!previousMe || !previousMe.isHolder)) {
        playSound('your-turn');
        if ($('#rush-answer').value.trim()) {
          $('#rush-feedback').textContent = 'Your draft is ready — press Enter to pass the Orb.';
          $('#rush-feedback').classList.remove('success');
        }
      }
      if (me && !me.alive) {
        $('#rush-answer').placeholder = 'You are out of this round';
        $('#rush-feedback').textContent = 'You can follow the match, but cannot submit another answer.';
      }
      if (room.timerRemainingMs !== null) updatePartyTimer(room.timerRemainingMs, room.currentHolderId, room.timerDurationMs);
    }
    if (finished && state.result) renderPartyResults(state.result);
  }
  function updatePartyTimer(remainingMs, holderId, durationMs) {
    const soundKey = String(state.room && state.room.round || 0);
    if (soundKey !== state.rushSoundKey) { state.rushSoundKey = soundKey; state.rushSoundMarks = []; }
    const remaining = Math.max(0, Number(remainingMs || 0));
    const duration = Math.max(1, Number(durationMs || state.room?.timerDurationMs || 20000));
    const seconds = Math.ceil(remaining / 1000);
    if (seconds > 0 && seconds <= 5 && !state.rushSoundMarks.includes(seconds)) {
      state.rushSoundMarks.push(seconds);
      playSound(seconds <= 2 ? 'critical' : 'warning');
    }
    const progress = Math.max(0, Math.min(100, (remaining / duration) * 100));
    $('#rush-seconds').textContent = String(seconds);
    $('#rush-timer-label').textContent = 'SHARED FUSE';
    $('#rush-timer').setAttribute('aria-label', 'Shared fuse: ' + seconds + ' seconds remaining');
    $('#rush-timer-fill').style.width = progress + '%';
    $('#rush-timer').classList.toggle('urgent', seconds <= 4);

    const answerTrack = $('#rush-answer-time-track');
    const answerFill = $('#rush-answer-time-fill');
    if (answerTrack && answerFill) {
      answerFill.style.width = progress + '%';
      answerTrack.classList.toggle('urgent', seconds <= 5);
      answerTrack.setAttribute('aria-valuenow', String(Math.round(progress)));
    }

    const stage = $('#orb-stage');
    const pressure = Math.max(0, Math.min(1, (5000 - remaining) / 5000));
    const scale = 1 + pressure * 0.38;
    stage.style.setProperty('--orb-scale', scale.toFixed(3));
    stage.classList.toggle('pressure', remaining > 0 && remaining <= 5000);
    stage.classList.toggle('warning', seconds > 0 && seconds <= 5);
    stage.classList.toggle('critical', state.animations && seconds > 0 && seconds <= 2);

    const holder = state.room && state.room.players.find(player => player.id === holderId);
    if (holder) {
      $('#rush-timer-label').textContent = 'SHARED FUSE';
      $('#orb-holder-label').textContent = holder.isYou
        ? 'THE ORB IS WITH YOU'
        : 'THE ORB IS WITH ' + holder.nickname.toUpperCase();
    }
  }
  function showCategoryAnnouncement(category, reason) {
    const stage = $('#orb-stage');
    const banner = $('#category-announcement');
    if (!stage || !banner) return;
    clearTimeout(state.categoryAnnouncementTimer);
    clearTimeout(state.categoryAnnouncementDelayTimer);

    const reveal = () => {
      $('#category-announcement-kicker').textContent = reason === 'overload'
        ? 'THE ATLAS HAS REFORMED'
        : reason === 'round_start' ? 'THE FIRST ORBIT BEGINS' : 'THE ATLAS IS SHIFTING';
      $('#category-announcement-title').textContent = category?.title || category?.prompt || 'A new challenge awaits';
      $('#category-announcement-detail').textContent = reason === 'round_start'
        ? 'Your first world challenge starts now.'
        : 'A fresh world challenge. Get ready to pass the Orb.';
      banner.hidden = false;
      banner.classList.remove('visible');
      stage.classList.remove('category-shift');
      void banner.offsetWidth;
      banner.classList.add('visible');
      stage.classList.add('category-shift');
      state.categoryAnnouncementTimer = setTimeout(() => {
        banner.hidden = true;
        banner.classList.remove('visible');
        stage.classList.remove('category-shift');
        state.categoryAnnouncementTimer = null;
      }, 3500);
    };
    state.categoryAnnouncementDelayTimer = setTimeout(reveal, reason === 'overload' ? 700 : 0);
  }
  function clearGlobeRushEffects() {
    clearTimeout(state.categoryAnnouncementTimer);
    clearTimeout(state.categoryAnnouncementDelayTimer);
    clearTimeout(state.orbOverloadTimer);
    state.categoryAnnouncementTimer = null;
    state.categoryAnnouncementDelayTimer = null;
    state.orbOverloadTimer = null;
    const stage = $('#orb-stage');
    if (stage) {
      stage.classList.remove('pressure', 'warning', 'critical', 'overload', 'category-shift');
      stage.style.removeProperty('--orb-scale');
    }
    const banner = $('#category-announcement');
    if (banner) {
      banner.hidden = true;
      banner.classList.remove('visible');
    }
  }
  function renderPartyResults(results) {
    if (!results) return;
    $('#room-lobby-state').hidden = true;
    $('#room-game-state').hidden = true;
    $('#room-results-state').hidden = false;
    $('#rush-winner').textContent = results.winner + ' wins!';
    const teamSummary = Array.isArray(results.teams) && results.teams.length
      ? '<div class="final-team-summary">' + results.teams.map(team => '<div class="final-team-row ' + (team.id === results.winningTeam ? 'winner' : '') + '"><b>' + esc(team.name) + '</b><span>' + number.format(team.score) + ' pts</span><small>' + team.alive + ' in orbit</small></div>').join('') + '</div>'
      : '';
    $('#rush-final-ranking').innerHTML = teamSummary + results.ranking.map(row =>
      '<div class="final-ranking-row ' + (row.isWinner ? 'winner' : '') + '">' +
      '<span>' + String(row.rank).padStart(2, '0') + '</span><strong>' + esc(row.nickname) +
      '</strong><b>' + number.format(row.score) + ' pts</b><small>' + '♥'.repeat(row.hearts) + '</small></div>'
    ).join('');
    $('#room-rematch').hidden = !(state.room && state.room.players.some(player => player.isYou && player.isHost));
    loadPartyMiniRanking();
  }
  function resetRoomUI() {
    playSound('leave');
    if (state.roomLaunchTimer) clearInterval(state.roomLaunchTimer);
    state.roomLaunchTimer = null;
    clearGlobeRushEffects();
    clearPartySuggestion();
    state.room = null; state.roomCode = null; state.playerId = null; state.resumeToken = ''; state.result = null;
    state.isLeavingRoom = true;
    state.reconnectAttempts = 0;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    sessionStorage.removeItem('humanity-room-code');
    sessionStorage.removeItem('humanity-room-resume-token');
    setPartyConnectionStatus('offline', 'NOT IN A ROOM');
    if ($('#rush-answer')) $('#rush-answer').value = '';
    $('#party-room').hidden = true;
    $('#party-lobby').hidden = false;
    if (state.ws) { try { state.ws.close(); } catch (_) {} }
    state.ws = null;
    if (state.wsHeartbeatTimer) clearInterval(state.wsHeartbeatTimer);
    state.wsHeartbeatTimer = null;
    state.wsHeartbeatSocket = null;
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
  function planetAvatarKey(value) {
    const key = String(value || 'mercury').toLowerCase();
    return PLANET_AVATARS.some(planet => planet.id === key) ? key : 'mercury';
  }
  function selectedPlanetAvatar() {
    const player = state.player;
    const streak = Math.max(0, Number(player && player.dailyStreak || 0));
    const preferred = player && player.selectedAvatar
      ? String(player.selectedAvatar)
      : (localStorage.getItem('humanity-globe-avatar') || 'mercury');
    const avatar = PLANET_AVATARS.find(planet => planet.id === preferred);
    if (!avatar) return 'mercury';
    if (player && player.avatarLocked) return avatar.id;
    return avatar.streak <= streak ? avatar.id : 'mercury';
  }
  function renderPlanetAvatarOptions() {
    const root = $('#planet-avatar-options');
    if (!root) return;
    const streak = Math.max(0, Number(state.player && state.player.dailyStreak || 0));
    const selected = selectedPlanetAvatar();
    const adminAssigned = Boolean(state.player && state.player.avatarLocked);
    $('#planet-avatar-streak').textContent = streak + ' DAY ATLAS DAILY STREAK';
    root.innerHTML = (adminAssigned ? '<p class="profile-avatar-admin-note">Avatar assigned by HUMANITY administration.</p>' : '') +
      PLANET_AVATARS.map(planet => {
        const streakLocked = streak < planet.streak;
        const locked = adminAssigned || streakLocked;
        const active = selected === planet.id;
        const status = adminAssigned
          ? (active ? 'ADMIN ASSIGNED' : 'ADMIN LOCKED')
          : (streakLocked ? planet.streak + ' DAY STREAK' : planet.streak ? 'UNLOCKED' : 'STARTER');
        return '<button class="planet-avatar-choice' + (active ? ' selected' : '') + (locked ? ' locked' : '') +
          '" type="button" data-planet-avatar="' + planet.id + '"' + (locked ? ' disabled aria-disabled="true"' : '') +
          ' title="' + (adminAssigned ? 'Your avatar is locked by a HUMANITY administrator' : (streakLocked ? 'Reach a ' + planet.streak + '-day playing streak to unlock ' + planet.name : 'Choose ' + planet.name)) + '">' +
          '<span class="planet-avatar-visual planet-avatar-' + planet.id + '"></span><b>' + planet.name +
          '</b><small>' + status + '</small></button>';
      }).join('');
  }

  function queueMatch(mode, group) {
    if (mode === 'ranked' && !state.token) {
      toast('Sign in with a free account to play Ranked.');
      showAccount();
      return;
    }
    playSound('queue');
    const variant = mode === 'ranked' ? 'classic' : ($('#quick-variant')?.value || 'classic');
    connectSocket({
      type: mode === 'ranked' ? 'ranked_queue' : 'quick_play',
      mode, group, variant, nickname: nickname(), avatarKey: selectedPlanetAvatar(), token: state.token || undefined
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
        esc(room.group) + ' · ' + room.players + '/' + room.capacity + ' explorers · ' + esc(room.variant || 'classic').toUpperCase() + ' · ' +
        (room.ratingEnabled ? 'RATED' : 'CASUAL') + ' · ' + esc(room.settings?.difficulty || 'normal') + '</small></div>' +
        '<button type="button" data-join-room="' + esc(room.code) + '">Join ↗</button></div>'
      ).join('');
    }).catch(() => { $('#open-rooms-list').innerHTML = '<div class="empty-room-note">Open rooms are temporarily unavailable.</div>'; });
  }
  async function loadOnlinePlayers() {
    const count = $('#globe-online-count');
    const label = $('#globe-online-label');
    if (!count || !label) return;
    try {
      const result = await api('/party/online');
      const players = Math.max(0, Number(result.players) || 0);
      count.textContent = number.format(players);
      label.textContent = players === 1 ? 'PLAYER ONLINE NOW' : 'PLAYERS ONLINE NOW';
    } catch (_) {
      count.textContent = '—';
      label.textContent = 'LIVE PLAYER COUNT';
    }
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
        item.occurrences + '</span></strong><small>' + esc(item.question_prompt) + '</small>' +
        '<div class="admin-review-controls"><label>RARITY <select data-review-rarity="' + item.id + '">' +
        ['Familiar','Known','Uncommon','Rare','Remarkable','Exceptional'].map((name,index)=>
          '<option value="'+index+'" '+(index===2?'selected':'')+'>'+name+' · '+[10,20,40,60,80,100][index]+' pts</option>'
        ).join('')+'</select></label><label>ALIASES <input data-review-aliases="' + item.id + '" maxlength="240" placeholder="Alternative names, comma-separated"></label></div></div>' +
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
      playSound('join');
      $('#friend-username').value = '';
      toast('Friend request sent.');
      loadFriends();
    } catch (error) { toast(error.message); }
  }

  function cookieNoticeAcknowledged() {
    return document.cookie.split(';').some(item => item.trim().startsWith('humanity_cookie_notice='));
  }
  function saveAnalyticsChoice(choice) {
    const granted = choice === 'granted';
    try { localStorage.setItem('humanity-analytics-consent',granted ? 'granted' : 'denied'); } catch (_) {}
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = 'humanity_cookie_notice=1; Max-Age=15552000; Path=/; SameSite=Lax' + secure;
    const banner = $('#cookie-banner');
    if (banner) banner.hidden = true;
    if (granted) trackAnalytics('page_view',{view:state.currentView || 'daily'});
    else { try { localStorage.removeItem('humanity-analytics-id'); } catch (_) {} }
    toast(granted ? 'Optional first-party analytics enabled on this browser.' : 'Essential-only privacy choice saved.');
  }
  function openCookiePreferences() {
    const banner = $('#cookie-banner');
    if (banner) banner.hidden = false;
    closeModal('cookie-policy-modal');
  }
  function initCookieNotice() {
    const banner = $('#cookie-banner');
    let savedChoice = '';
    try { savedChoice = localStorage.getItem('humanity-analytics-consent') || ''; } catch (_) {}
    if (banner) banner.hidden = cookieNoticeAcknowledged() && Boolean(savedChoice);
    $('#cookie-notice-essential').addEventListener('click',() => saveAnalyticsChoice('denied'));
    $('#cookie-notice-accept').addEventListener('click',() => saveAnalyticsChoice('granted'));
    $('#cookie-notice-details').addEventListener('click',() => openModal('cookie-policy-modal'));
    $('#footer-cookie-policy').addEventListener('click',() => openModal('cookie-policy-modal'));
    $('#footer-privacy-policy').addEventListener('click',() => openModal('privacy-policy-modal'));
    $('#footer-cookie-preferences').addEventListener('click',openCookiePreferences);
    $('#cookie-preferences-open').addEventListener('click',openCookiePreferences);
  }

  function initEvents() {
    document.addEventListener('pointerdown', unlockAudio, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') unlockAudio();
    }, true);
    document.addEventListener('click', event => {
      const target = event.target && event.target.closest ? event.target : event.target && event.target.parentElement;
      const control = target && target.closest
        ? target.closest('button, a, summary, input[type="checkbox"], input[type="radio"], select')
        : null;
      if (!control || control.disabled || control.matches('[data-sound-silent], #setting-sound, #setting-sound-volume')) return;
      if (control.matches('[data-close-modal], #daily-start, #quick-play, #ranked-play, #unlimited-skip, #daily-hint')) return;
      if (control.matches('[data-open-practice], #account-open, #settings-open, #atlas-archive-open, #archive-open, #open-archive-from-lock, #friends-open, #admin-open')) return;
      const sound = control.matches('.nav-item') ? 'navigation'
        : control.matches('button[type="submit"], input[type="submit"]') ? 'submit'
        : control.matches('input[type="checkbox"], input[type="radio"]') ? 'toggle' : 'click';
      playSound(sound);
    }, true);
    document.addEventListener('pointerover', event => {
      const target = event.target && event.target.closest ? event.target : null;
      const control = target && target.closest ? target.closest('.nav-item, .practice-pack-card, .archive-date, .public-room-row, .planet-seat') : null;
      if (control && !control.contains(event.relatedTarget)) playSound('hover');
    }, true);
    $$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    window.addEventListener('resize', () => requestAnimationFrame(updateNavigationIndicator), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.dailyDeadlineAt) refreshDailyTimer();
    });
    $('#daily-start').addEventListener('click', startDaily);
    $$('[data-open-practice]').forEach(button=>button.addEventListener('click',()=>{
      openModal('practice-modal');loadPracticePacks();
    }));
    $('#practice-pack-list').addEventListener('click',event=>{
      const button=event.target.closest('[data-practice-pack]');
      if(button)startUnlimited(button.dataset.practicePack);
    });
    $('#unlimited-skip').addEventListener('click',skipDailyQuestion);
    $('#unlimited-finish').addEventListener('click',finishUnlimited);
    $('#daily-answer-form').addEventListener('submit', submitDailyAnswer);
    $('#daily-answer').addEventListener('input', scheduleDailySuggestion);
    $('#daily-suggestion').addEventListener('click', event => {
      if (event.target.closest('[data-use-daily-suggestion]')) useDailySuggestion();
    });
    $('#atlas-archive-open').addEventListener('click', () => { loadArchive(); openModal('archive-modal'); });
    $('#daily-next').addEventListener('click', nextDailyQuestion);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.repeat) return;
      const dailyView = $('[data-view-panel="daily"]');
      const resultPanel = $('#daily-result');
      const nextButton = $('#daily-next');
      const reaction = $('#daily-answer-reaction');
      if (!dailyView || dailyView.hidden || !reaction || reaction.hidden ||
          state.pendingNextIndex === null || event.target !== nextButton) return;
      event.preventDefault();
      nextDailyQuestion();
    });
    $('#daily-hint').addEventListener('click', useDailyHint);
    $('#daily-share').addEventListener('click', async () => {
      const edition = state.unlimited ? state.unlimited.title + ' Practice' : state.practice ? fmtDate(state.practice.date) : 'today';
      const scoreLabel = state.practice || state.unlimited ? 'practice Discovery Points' : 'provisional Discovery Points';
      const text = 'I completed the HUMANITY Atlas Daily for ' + edition + ' with ' + $('#complete-score').textContent + ' ' + scoreLabel + '.';
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
    const startingLivesControl = $('#private-starting-lives');
    const maximumLivesControl = $('#private-max-lives');
    if (startingLivesControl && maximumLivesControl) {
      startingLivesControl.addEventListener('change', () => {
        if (Number(maximumLivesControl.value) < Number(startingLivesControl.value)) {
          maximumLivesControl.value = startingLivesControl.value;
        }
      });
      maximumLivesControl.addEventListener('change', () => {
        if (Number(maximumLivesControl.value) < Number(startingLivesControl.value)) {
          startingLivesControl.value = maximumLivesControl.value;
        }
      });
    }
    $('#private-lobby-settings-form').addEventListener('submit', event => {
      event.preventDefault();
      const room = state.room;
      const host = room && room.players.some(player => player.isYou && player.isHost);
      if (!room || room.phase !== 'lobby' || !host || !room.isHostedRoom) {
        toast('Only the host can edit settings before the match starts.');
        return;
      }
      $('#private-settings-feedback').textContent = 'Saving room settings…';
      sendSocket({
        type: 'update_room_settings',
        capacity: Number($('#private-capacity').value),
        visibility: $('#private-visibility').value,
        settings: {
          startingLives: Number($('#private-starting-lives').value),
          maxLives: Number($('#private-max-lives').value),
          turnDurationSeconds: Number($('#private-turn-duration').value),
          gameMode: $('#private-game-mode').value,
          difficulty: $('#private-difficulty').value,
          categoryTheme: $('#private-category-theme').value,
          countdownSeconds: Number($('#private-countdown').value),
          ratingEnabled: $('#private-rated').checked,
          autoStartWhenFull: $('#private-auto-start').checked
        },
        variant: $('#private-game-variant').value
      });
    });
    $('#daily-archive-exit').addEventListener('click', () => {
      if (state.unlimited) finishUnlimited();
      else returnToToday();
    });
    $('#atlas-flying-rarity').addEventListener('animationend', event => {
      if (event.animationName === 'atlas-rarity-flight') clearFlyingRarity();
    });
    $('#daily-return-today').addEventListener('click', returnToToday);
    $('#quick-play').addEventListener('click', () => queueMatch('quick', $('#quick-group').value));
    $('#ranked-play').addEventListener('click', () => queueMatch('ranked', $('#ranked-group').value));
    $('#create-room-form').addEventListener('submit', event => {
      event.preventDefault();
      connectSocket({
        type: 'create_room',
        visibility: $('#host-visibility').value,
        mode: 'private',
        variant: $('#host-variant').value,
        capacity: 10,
        nickname: nickname(),
        avatarKey: selectedPlanetAvatar(),
        token: state.token || undefined,
        settings: {
          startingLives: 2, maxLives: 3, turnDurationSeconds: 0,
          maxWrongAnswersPerCategory: 2, maxTurnsPerCategory: 10,
          gameMode: 'classic', difficulty: 'normal', categoryTheme: 'all',
          countdownSeconds: 5, ratingEnabled: false, autoStartWhenFull: false
        }
      });
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
    $('#admin-open').addEventListener('click', () => { window.location.assign('./admin.html'); });
    $('#admin-refresh').addEventListener('click', loadAdmin);
    $('#admin-queue').addEventListener('click', async event => {
      const button = event.target.closest('[data-review-id]');
      if (!button) return;
      button.disabled = true;
      const row=button.closest('.admin-queue-item');
      const rarity=row&&row.querySelector('[data-review-rarity]');
      const aliases=row&&row.querySelector('[data-review-aliases]');
      try {
        await api('/admin/review/' + button.dataset.reviewId, {
          method:'POST',
          body:{
            action:button.dataset.reviewAction,
            rarity:rarity?Number(rarity.value):2,
            aliases:aliases?aliases.value.split(',').map(value=>value.trim()).filter(Boolean):[]
          }
        });
        loadAdmin();
      } catch (error) { toast(error.message); button.disabled = false; }
    });
    $('#settings-open').addEventListener('click', () => { setSettings(); openModal('settings-modal'); });
    $('#setting-sound').addEventListener('change', event => {
      state.sounds = event.target.checked;
      localStorage.setItem('humanity-sound', String(state.sounds));
      if (state.sounds) playSound('toggle');
    });
    $('#setting-sound-volume').addEventListener('input', event => {
      state.soundVolume = Math.max(0, Math.min(100, Number(event.target.value) || 0));
      localStorage.setItem('humanity-sound-volume', String(state.soundVolume));
      $('#setting-sound-volume-label').textContent = state.soundVolume + '%';
      if (state.audioMaster && state.audioContext) {
        state.audioMaster.gain.setTargetAtTime((state.soundVolume / 100) * 2.35, state.audioContext.currentTime, 0.04);
      }
    });
    $('#sound-preview').addEventListener('click', () => playSound('preview'));
    $('#setting-motion').addEventListener('change', event => {
      state.animations = event.target.checked;
      localStorage.setItem('humanity-motion', String(state.animations));
      setSettings();
    });
    $('#leave-room').addEventListener('click', () => { state.isLeavingRoom = true; sendSocket({ type: 'leave_room' }); resetRoomUI(); });
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
    $('#invite-room').addEventListener('click', async () => {
      if (!state.roomCode) return;
      const inviteUrl = new URL(location.href);
      inviteUrl.hash = 'party';
      inviteUrl.searchParams.set('room', state.roomCode);
      const shareData = {
        title: 'Join my HUMANITY Globe Rush room',
        text: 'Join my Globe Rush room in HUMANITY. Room code: ' + state.roomCode,
        url: inviteUrl.toString()
      };
      try {
        if (navigator.share) await navigator.share(shareData);
        else {
          await navigator.clipboard.writeText(shareData.url);
          toast('Invite link copied.');
        }
      } catch (_) {
        try { await navigator.clipboard.writeText(shareData.url); toast('Invite link copied.'); }
        catch (_) { toast('Room code: ' + state.roomCode); }
      }
    });
    $('#room-rematch').addEventListener('click', () => sendSocket({ type: 'rematch' }));
    $('#profile-avatar-collection').addEventListener('click', async event => {
      const button = event.target.closest('[data-profile-avatar]');
      if (!button || button.disabled) return;
      const avatarKey = button.dataset.profileAvatar;
      try {
        if (state.token) {
          const result = await api('/profile/avatar', { method: 'POST', body: { avatarKey } });
          setAccountUI(result.player);
        }
        localStorage.setItem('humanity-globe-avatar', avatarKey);
        renderProfileAvatarCollection();
        renderPlanetAvatarOptions();
        playSound('toggle');
        toast(avatarKey.charAt(0).toUpperCase() + avatarKey.slice(1) + ' selected as your planet avatar.');
      } catch (error) {
        renderProfileAvatarCollection();
        renderPlanetAvatarOptions();
        toast(error.message);
      }
    });
    $('#planet-avatar-options').addEventListener('click', async event => {
      const button = event.target.closest('[data-planet-avatar]');
      if (!button || button.disabled) return;
      const avatarKey = button.dataset.planetAvatar;
      try {
        if (state.token) {
          const result = await api('/profile/avatar', { method: 'POST', body: { avatarKey } });
          setAccountUI(result.player);
        }
        localStorage.setItem('humanity-globe-avatar', avatarKey);
        renderProfileAvatarCollection();
        renderPlanetAvatarOptions();
        playSound('toggle');
        toast(avatarKey.charAt(0).toUpperCase() + avatarKey.slice(1) + ' selected as your planet avatar.');
      } catch (error) {
        renderProfileAvatarCollection();
        renderPlanetAvatarOptions();
        toast(error.message);
      }
    });
    $('#rush-answer').addEventListener('input', schedulePartySuggestion);
    $('#rush-suggestion').addEventListener('click', event => {
      if (event.target.closest('[data-use-rush-suggestion]')) usePartySuggestion();
    });
    $('#rush-answer-form').addEventListener('submit', event => {
      event.preventDefault();
      if (usePartySuggestion()) return;
      const input = $('#rush-answer');
      const answer = input.value.trim();
      if (!answer) return;
      const room = state.room;
      const me = room && room.players.find(player => player.isYou);
      if (!room || room.phase !== 'playing' || !me || !me.alive) return;
      if (!me.isHolder) {
        $('#rush-feedback').textContent = 'Draft saved. Press Enter when the Orb reaches you.';
        $('#rush-feedback').classList.remove('success');
        return;
      }
      sendSocket({ type: 'submit_answer', answer, requestId: state.partySuggestionSequence });
      $('#rush-submit').disabled = true;
      $('#rush-feedback').textContent = 'Checking your answer…';
      $('#rush-feedback').classList.remove('success');
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
    $$('dialog.modal').forEach(dialog => {
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close', () => playSound('modal-close'));
    });
  }
  function joinRoom(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(clean)) { toast('Enter a valid six-character room code.'); return; }
    connectSocket({
      type: 'join_room', code: clean, nickname: nickname(),
      avatarKey: selectedPlanetAvatar(), token: state.token || undefined
    });
  }
  async function bootstrap() {
    const params = new URLSearchParams(location.search);
    const oauthToken = params.get('session');
    const inviteRoomCode = params.get('room');
    if (oauthToken) {
      state.token = oauthToken;
      localStorage.setItem('humanity-session-token', oauthToken);
      history.replaceState(null, '', location.pathname + location.hash);
    }
    setSettings();
    if ($('#party-display-name')) $('#party-display-name').value = localStorage.getItem('humanity-display-name') || '';
    initEvents();
    initCookieNotice();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    await Promise.all([loadAuthProviders(), loadProfile(true)]);
    await loadDaily();
    const storedRoomCode = sessionStorage.getItem('humanity-room-code');
    const storedResumeToken = sessionStorage.getItem('humanity-room-resume-token');
    if (storedRoomCode && storedResumeToken && !inviteRoomCode) {
      state.roomCode = storedRoomCode;
      state.resumeToken = storedResumeToken;
      setView('party');
      setPartyConnectionStatus('reconnecting', 'RESTORING ROOM');
      connectSocket({ type: 'reconnect', code: storedRoomCode, resumeToken: storedResumeToken });
    } else if (location.hash === '#party' || inviteRoomCode) setView('party');
    else if (location.hash === '#rankings') setView('rankings');
    else setView('daily');
    if (inviteRoomCode && /^[A-HJ-NP-Z2-9]{6}$/i.test(inviteRoomCode)) {
      $('#join-code').value = inviteRoomCode.toUpperCase();
      joinRoom(inviteRoomCode);
    }
    if (state.player) {
      $('#account-signed-out').hidden = true;
      $('#account-signed-in').hidden = false;
    }
    if (oauthToken) toast('You are signed in to HUMANITY.');
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
