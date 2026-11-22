'use strict';

const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const engine = require('./geography-engine');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLAYER_TURN_MIN_SECONDS = 10;
const PLAYER_TURN_MAX_SECONDS = 30;
const MIN_INHERITED_FUSE_SECONDS = 8;
const MAX_WRONG_ANSWERS_PER_CATEGORY = 2;
const MAX_TURNS_PER_CATEGORY = 10;
const STARTING_HEARTS = 2;
const MAX_HEARTS = 3;
const DEFAULT_ROOM_SETTINGS = Object.freeze({
  startingLives: STARTING_HEARTS,
  maxLives: MAX_HEARTS,
  turnDurationSeconds: 0,
  maxWrongAnswersPerCategory: MAX_WRONG_ANSWERS_PER_CATEGORY,
  maxTurnsPerCategory: MAX_TURNS_PER_CATEGORY,
  gameMode: 'classic',
  difficulty: 'normal',
  categoryTheme: 'all',
  countdownSeconds: 5,
  ratingEnabled: false,
  autoStartWhenFull: false
});
const PLANET_AVATARS = [
  { key: 'mercury', streak: 0 }, { key: 'venus', streak: 3 },
  { key: 'earth', streak: 7 }, { key: 'mars', streak: 14 },
  { key: 'jupiter', streak: 30 }, { key: 'saturn', streak: 60 },
  { key: 'uranus', streak: 90 }, { key: 'neptune', streak: 150 }
];
const HEART_METER = [0, 5, 10, 35, 55, 100];
const ROOM_IDLE_MS = 5 * 60 * 1000;
const RECONNECT_GRACE_MS = 45 * 1000;
const SOCKET_HEARTBEAT_MS = 5 * 1000;
const APP_HEARTBEAT_TIMEOUT_MS = 15 * 1000;
const LARGE_QUEUE_FALLBACK_MS = 25 * 1000;
const ALLOWED_VARIANTS = new Set(['classic', 'team-rush', 'survival']);

function normaliseVariant(value) {
  const variant = String(value || '').toLowerCase();
  return ALLOWED_VARIANTS.has(variant) ? variant : 'classic';
}

function survivalFuseSeconds(round) {
  return Math.max(8, 22 - Math.floor((Math.max(1, Number(round) || 1) - 1) / 2) * 2);
}

function survivalDifficulty(round) {
  const value = Math.max(1, Number(round) || 1);
  return value <= 2 ? 'easy' : value <= 5 ? 'normal' : 'hard';
}

function shouldDownshiftLargeQueue(room, now = Date.now()) {
  return Boolean(room && room.group === 'large' && room.phase === 'lobby' && !room.fallbackApplied &&
    room.players && room.players.length >= 6 && room.players.length < 8 &&
    now - Number(room.createdAt || now) >= LARGE_QUEUE_FALLBACK_MS);
}

const GROUPS = {
  duel: { label: '1v1', min: 2, max: 2 },
  three: { label: '3 players', min: 3, max: 3 },
  small: { label: '4–6 players', min: 4, max: 6 },
  large: { label: '8–10 players', min: 8, max: 10 }
};

function safeSend(socket, payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function randomCode() {
  let result = '';
  for (let i = 0; i < 6; i += 1) {
    result += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return result;
}

function cleanName(value) {
  const name = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 18) return null;
  if (!/^[\p{L}\p{N}_ .'-]+$/u.test(name)) return null;
  if (/^(admin|moderator|system|humanity)$/i.test(name)) return null;
  return name;
}

function nextAlive(room, afterId) {
  const living = room.players.filter(player => player.alive);
  if (!living.length) return null;
  const index = room.players.findIndex(player => player.id === afterId);
  for (let step = 1; step <= room.players.length; step += 1) {
    const candidate = room.players[(Math.max(index, -1) + step) % room.players.length];
    if (candidate && candidate.alive) return candidate;
  }
  return living[0];
}

function inheritedFuseDurationMs(remainingMs) {
  const remaining = Math.max(0, Number(remainingMs) || 0);
  return remaining < MIN_INHERITED_FUSE_SECONDS * 1000
    ? MIN_INHERITED_FUSE_SECONDS * 1000
    : remaining;
}

function rankPlayers(players) {
  return [...players].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.hearts !== b.hearts) return b.hearts - a.hearts;
    if (a.score !== b.score) return b.score - a.score;
    return a.eliminatedAt - b.eliminatedAt;
  });
}

function normaliseRoomSettings(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const clampInteger = (value, fallback, minimum, maximum) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
  };
  const startingLives = clampInteger(source.startingLives, DEFAULT_ROOM_SETTINGS.startingLives, 1, 5);
  const requestedMaxLives = clampInteger(source.maxLives, DEFAULT_ROOM_SETTINGS.maxLives, 1, 6);
  const turnDuration = Number(source.turnDurationSeconds);
  const turnDurationSeconds = [0, 10, 15, 20, 25, 30].includes(turnDuration) ? turnDuration : 0;
  const maxWrongAnswersPerCategory = clampInteger(source.maxWrongAnswersPerCategory, DEFAULT_ROOM_SETTINGS.maxWrongAnswersPerCategory, 1, 5);
  const requestedTurns = Number(source.maxTurnsPerCategory);
  const maxTurnsPerCategory = [5, 10, 15, 20].includes(requestedTurns)
    ? requestedTurns : DEFAULT_ROOM_SETTINGS.maxTurnsPerCategory;
  const gameMode = ['classic', 'sudden-death'].includes(source.gameMode) ? source.gameMode : 'classic';
  const difficulty = ['easy', 'normal', 'hard'].includes(source.difficulty) ? source.difficulty : 'normal';
  const categoryTheme = ['all', 'countries', 'cities', 'nature', 'landmarks', 'culture'].includes(source.categoryTheme)
    ? source.categoryTheme : 'all';
  const requestedCountdown = Number(source.countdownSeconds);
  const countdownSeconds = [0, 3, 5, 10, 15].includes(requestedCountdown)
    ? requestedCountdown : DEFAULT_ROOM_SETTINGS.countdownSeconds;
  return {
    startingLives: gameMode === 'sudden-death' ? 1 : startingLives,
    maxLives: gameMode === 'sudden-death' ? 1 : Math.max(startingLives, requestedMaxLives),
    turnDurationSeconds,
    maxWrongAnswersPerCategory,
    maxTurnsPerCategory,
    gameMode,
    difficulty,
    categoryTheme,
    countdownSeconds,
    ratingEnabled: source.ratingEnabled === true,
    autoStartWhenFull: source.autoStartWhenFull === true
  };
}

function categoryRotationReason(wrongAnswers, acceptedTurns, settings = DEFAULT_ROOM_SETTINGS) {
  const rules = normaliseRoomSettings(settings);
  if (Number(wrongAnswers || 0) >= rules.maxWrongAnswersPerCategory) return 'mistakes';
  if (Number(acceptedTurns || 0) >= rules.maxTurnsPerCategory) return 'turn_limit';
  return null;
}

function answerEditDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return previous[b.length];
}

function findPartyAnswerSuggestion(category, rawAnswer, usedAnswers) {
  const target = engine.normaliseAnswer(rawAnswer);
  if (!category || !target || target.length < 4 || target.length > 80) return null;
  if (engine.matchAnswer(category, rawAnswer)) return null;
  const used = new Set((usedAnswers || []).map(item => engine.normaliseAnswer(item.name || item)));
  const threshold = target.length >= 8 ? 2 : 1;
  const matches = [];
  for (const entry of category.answers || []) {
    if (used.has(engine.normaliseAnswer(entry.name))) continue;
    let best = Infinity;
    for (const label of [entry.name].concat(entry.aliases || [])) {
      const candidate = engine.normaliseAnswer(label);
      const distance = candidate.startsWith(target) ? 0 : answerEditDistance(target, candidate);
      best = Math.min(best, distance);
    }
    if (best <= threshold) matches.push({ answer: entry.name, distance: best });
  }
  if (!matches.length) return null;
  const minimum = Math.min(...matches.map(item => item.distance));
  const winners = [...new Map(matches.filter(item => item.distance === minimum)
    .map(item => [engine.normaliseAnswer(item.answer), item])).values()];
  return winners.length === 1 && engine.normaliseAnswer(winners[0].answer) !== target
    ? winners[0].answer : null;
}

const PARTY_WIKIDATA_TYPES = {
  'europe-countries': ['country in europe', 'european country'],
  'africa-countries': ['country in africa', 'african country'],
  'asia-countries': ['country in asia', 'asian country'],
  'south-america-countries': ['country in south america', 'south american country'],
  'north-america-countries': ['country in north america', 'north american country'],
  'oceania-countries': ['country in oceania', 'oceanian country'],
  'world-rivers': ['river'],
  mountains: ['mountain', 'mountain range', 'volcano', 'peak'],
  islands: ['island'],
  lakes: ['lake'],
  seas: ['sea', 'ocean'],
  deserts: ['desert'],
  'capital-cities': ['capital'],
  'major-cities': ['city', 'town'],
  'world-landmarks': ['landmark', 'monument', 'bridge', 'tower', 'statue', 'heritage site'],
  'world-heritage-sites': ['world heritage site', 'unesco world heritage site'],
  'national-parks': ['national park'],
  languages: ['language'],
  'popular-dishes': ['dish', 'cuisine', 'traditional food'],
  'popular-snacks': ['snack', 'food'],
  'olympic-sports': ['sport']
};
const PARTY_WIKIDATA_CACHE = new Map();

function createPartyServer({ server, pool, allowedOrigins, authenticateToken }) {
  const rooms = new Map();
  const sockets = new WeakMap();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false
  });

  function partyQuestionKey(question) {
    return String(question && (question.topicId || question.id) || '')
      .replace(/^rush-/, '').replace(/-v\d+$/, '');
  }

  function mergePartyAnswer(question, incoming) {
    if (!question || !Array.isArray(question.answers) || !incoming || !incoming.name) return;
    const incomingNames = [incoming.name].concat(Array.isArray(incoming.aliases) ? incoming.aliases : []);
    const incomingKeys = new Set(incomingNames.map(engine.normaliseAnswer).filter(Boolean));
    const matches = question.answers.filter(entry =>
      [entry.name].concat(Array.isArray(entry.aliases) ? entry.aliases : [])
        .some(alias => incomingKeys.has(engine.normaliseAnswer(alias)))
    );

    if (matches.length === 1) {
      const existing = matches[0];
      const aliases = new Map((existing.aliases || []).map(alias => [engine.normaliseAnswer(alias), alias]));
      for (const value of incomingNames) {
        const alias = String(value || '').trim().slice(0, 80);
        const key = engine.normaliseAnswer(alias);
        if (key && key !== engine.normaliseAnswer(existing.name)) aliases.set(key, alias);
      }
      existing.aliases = [...aliases.values()].slice(0, 100);
      if (incoming.source) existing.source = incoming.source;
      return;
    }

    if (matches.length > 1) return;
    question.answers.push({
      name: String(incoming.name).trim().slice(0, 80),
      aliases: [...new Set(incomingNames.slice(1).map(value => String(value).trim().slice(0, 80)).filter(Boolean))].slice(0, 100),
      rarity: Math.max(0, Math.min(5, Number(incoming.rarity) || 0)),
      source: incoming.source || 'HUMANITY verified answer'
    });
  }

  async function loadApprovedPartyAnswers(question) {
    const questionId = partyQuestionKey(question);
    if (!questionId) return question;
    const result = await pool.query(
      'SELECT answer_text, aliases, rarity, source_url FROM humanity_approved_answers WHERE question_id = $1',
      [questionId]
    );
    for (const row of result.rows) {
      mergePartyAnswer(question, {
        name: row.answer_text,
        aliases: Array.isArray(row.aliases) ? row.aliases : [],
        rarity: row.rarity,
        source: row.source_url || 'HUMANITY approved answer'
      });
    }
    return question;
  }

  async function verifyPartyAnswer(question, rawAnswer) {
    const questionId = partyQuestionKey(question);
    const expected = PARTY_WIKIDATA_TYPES[questionId];
    const answerText = String(rawAnswer || '').trim().slice(0, 80);
    const answerKey = engine.normaliseAnswer(answerText);
    if (!expected || answerKey.length < 2 || answerKey.length > 80) return null;

    const cacheKey = questionId + ':' + answerKey;
    if (PARTY_WIKIDATA_CACHE.has(cacheKey)) return PARTY_WIKIDATA_CACHE.get(cacheKey);

    const verification = (async () => {
      try {
        const searchParams = new URLSearchParams({
          action: 'wbsearchentities',
          search: answerText,
          language: 'en',
          format: 'json',
          limit: '8'
        });
        const response = await fetch('https://www.wikidata.org/w/api.php?' + searchParams.toString(), {
          headers: { Accept: 'application/json', 'User-Agent': 'HUMANITY-Geography-Engine/1.0' },
          signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const candidate = (payload.search || []).find(item => {
          const matchedText = item.match && item.match.text ? item.match.text : '';
          const exactAlias = engine.normaliseAnswer(item.label) === answerKey ||
            engine.normaliseAnswer(matchedText) === answerKey;
          const description = String(item.description || '').toLowerCase();
          return exactAlias && expected.some(term => description.includes(term));
        });
        if (!candidate) return null;

        const aliases = new Map();
        const addAlias = value => {
          const alias = String(value || '').trim().slice(0, 80);
          const key = engine.normaliseAnswer(alias);
          if (key && key !== engine.normaliseAnswer(candidate.label)) aliases.set(key, alias);
        };
        addAlias(answerText);
        addAlias(candidate.match && candidate.match.text);

        try {
          const aliasParams = new URLSearchParams({
            action: 'wbgetentities',
            ids: candidate.id,
            props: 'labels|aliases',
            languages: 'en|nl|fr|de|es|pt|it|ru|zh|ja|ar|hi',
            format: 'json'
          });
          const aliasResponse = await fetch('https://www.wikidata.org/w/api.php?' + aliasParams.toString(), {
            headers: { Accept: 'application/json', 'User-Agent': 'HUMANITY-Geography-Engine/1.0' },
            signal: AbortSignal.timeout(3000)
          });
          if (aliasResponse.ok) {
            const aliasPayload = await aliasResponse.json();
            const entity = aliasPayload.entities && aliasPayload.entities[candidate.id];
            for (const label of Object.values(entity && entity.labels || {})) addAlias(label && label.value);
            for (const languageAliases of Object.values(entity && entity.aliases || {})) {
              for (const alias of Array.isArray(languageAliases) ? languageAliases : []) addAlias(alias && alias.value);
            }
          }
        } catch (_) {
          // The exact type-checked name remains valid when alias expansion times out.
        }

        const entry = {
          name: candidate.label,
          aliases: [...aliases.values()].slice(0, 100),
          rarity: 2,
          source: candidate.concepturi || 'Wikidata type-checked answer'
        };
        await pool.query(
          'INSERT INTO humanity_approved_answers (question_id, answer_key, answer_text, aliases, rarity, source_url, approved_by) ' +
          'VALUES ($1,$2,$3,$4::jsonb,2,$5,$6) ON CONFLICT (question_id, answer_key) DO UPDATE SET ' +
          'aliases = EXCLUDED.aliases, source_url = EXCLUDED.source_url, approved_by = EXCLUDED.approved_by',
          [questionId, engine.normaliseAnswer(entry.name), entry.name, JSON.stringify(entry.aliases), candidate.concepturi || null, 'Wikidata verified entity type']
        );
        await pool.query(
          'UPDATE humanity_answer_review_queue SET status=$2, confidence=$3, source_url=$4, reviewer_note=$5, updated_at=NOW() ' +
          'WHERE question_id=$1 AND answer_key=$6 AND status=$7',
          [questionId, 'auto_approved', 0.96, candidate.concepturi || null,
            'Exact Wikidata name/alias and expected entity type verified. Available in future Globe Rush rounds.',
            answerKey, 'pending']
        );
        return entry;
      } catch (error) {
        console.warn('Globe Rush Wikidata verification skipped:', error.message);
        return null;
      }
    })();

    PARTY_WIKIDATA_CACHE.set(cacheKey, verification);
    const result = await verification;
    if (!result) PARTY_WIKIDATA_CACHE.delete(cacheKey);
    return result;
  }


  function roomState(room, viewerId) {
    const remaining = room.timerEndsAt ? Math.max(0, room.timerEndsAt - Date.now()) : null;
    return {
      type: 'room_state',
      code: room.code,
      visibility: room.visibility,
      mode: room.mode,
      isHostedRoom: Boolean(room.isHostedRoom),
      group: room.group,
      variant: room.variant || 'classic',
      winningTeam: room.winningTeam || null,
      phase: room.phase,
      round: room.round,
      category: room.category ? {
        id: room.category.id,
        title: room.category.category,
        prompt: room.category.prompt,
        note: room.category.note
      } : null,
      currentHolderId: room.currentHolderId,
      turnNumber: room.turnNumber,
      targetMin: room.targetMin,
      autoStartInMs: room.autoStartAt ? Math.max(0, room.autoStartAt - Date.now()) : null,
      wrongAnswersThisCategory: room.wrongAnswersThisCategory,
      turnsThisCategory: room.turnsThisCategory,
      settings: { ...room.settings, difficulty: room.currentDifficulty || room.settings.difficulty },
      currentDifficulty: room.currentDifficulty || room.settings.difficulty || 'normal',
      maxWrongAnswersPerCategory: room.settings.maxWrongAnswersPerCategory,
      maxTurnsPerCategory: room.settings.maxTurnsPerCategory,
      timerRemainingMs: remaining,
      timerDurationMs: room.timerDurationMs,
      usedAnswers: room.usedAnswers.map(item => item.name),
      chatMessages: (room.chatMessages || []).slice(-30),
      targetMin: room.targetMin,
      capacity: room.capacity,
      players: room.players.map(player => ({
        id: player.id,
        nickname: player.nickname,
        avatarKey: player.avatarKey || 'mercury',
        team: player.team || null,
        hearts: player.hearts,
        score: player.score,
        rarityMeter: player.rarityMeter,
        turnsTaken: player.turnsTaken,
        answersGiven: player.answersGiven,
        invalidAnswers: player.invalidAnswers,
        alive: player.alive,
        isYou: player.id === viewerId,
        isHost: player.id === room.hostId,
        isHolder: player.id === room.currentHolderId,
        isConnected: Boolean(player.socket && player.socket.readyState === WebSocket.OPEN),
        rating: player.rating
      }))
    };
  }

  function broadcastState(room) {
    for (const player of room.players) {
      safeSend(player.socket, roomState(room, player.id));
    }
  }

  function broadcast(room, payload) {
    for (const player of room.players) safeSend(player.socket, payload);
  }

  function sendError(socket, message, code) {
    safeSend(socket, { type: 'error', code: code || 'invalid_action', message });
  }

  function makeRoom(host, options) {
    let code = randomCode();
    while (rooms.has(code)) code = randomCode();
    const room = {
      code,
      visibility: options.visibility || 'private',
      mode: options.mode || 'private',
      group: options.group || 'private',
      variant: normaliseVariant(options.variant),
      capacity: options.capacity || 10,
      targetMin: options.targetMin || 2,
      settings: normaliseRoomSettings(options.settings),
      isHostedRoom: Boolean(options.isHostedRoom),
      autoStartAt: null,
      hostId: host.id,
      phase: 'lobby',
      players: [host],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      round: 0,
      category: null,
      lastCategoryId: null,
      categoryHistory: [],
      usedAnswers: [],
      chatMessages: [],
      currentHolderId: null,
      turnNumber: 0,
      wrongAnswersThisCategory: 0,
      turnsThisCategory: 0,
      timerEndsAt: null,
      timerDurationMs: null,
      lastTimerBroadcastAt: 0,
      fuseBusy: false,
      fallbackApplied: false,
      startedAt: null,
      winningTeam: null,
      results: null
    };
    host.roomCode = code;
    rooms.set(code, room);
    return room;
  }

  function findRoom(code) {
    return rooms.get(String(code || '').trim().toUpperCase()) || null;
  }

  function openPublicRooms() {
    return [...rooms.values()]
      .filter(room => room.visibility === 'public' && room.phase === 'lobby' && room.players.length < room.capacity)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map(room => ({
        code: room.code,
        mode: room.mode,
        group: room.group === 'flex' ? room.capacity + '-player flexible match' : (GROUPS[room.group] ? GROUPS[room.group].label : 'Open room'),
        variant: room.variant || 'classic',
        players: room.players.length,
        minimum: room.targetMin,
        capacity: room.capacity,
        ratingEnabled: room.mode === 'ranked',
        settings: { difficulty: room.settings.difficulty, categoryTheme: room.settings.categoryTheme }
      }));
  }

  async function persistResult(room, winner) {
    try {
      const now = new Date();
      const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
      const seasonId = now.getUTCFullYear() + '-Q' + quarter;
      const startsAt = new Date(Date.UTC(now.getUTCFullYear(), (quarter - 1) * 3, 1));
      const endsAt = new Date(Date.UTC(now.getUTCFullYear(), quarter * 3, 0));
      await pool.query(
        'INSERT INTO humanity_seasons (id, starts_at, ends_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [seasonId, startsAt.toISOString().slice(0, 10), endsAt.toISOString().slice(0, 10)]
      );
      const matchId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO humanity_party_matches (id, season_id, mode, category_id, category_label, winner_player_id, player_count, variant, started_at, finished_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())',
        [matchId, seasonId, room.mode === 'private' ? 'private' : room.mode, room.category?.id || 'globe-rush', room.category?.category || 'Geography', winner?.playerId || null, room.players.length, room.variant || 'classic', new Date(room.startedAt || now).toISOString()]
      );

      const ranked = room.variant === 'team-rush' && room.winningTeam
        ? [...room.players].sort((a, b) => (a.team === room.winningTeam ? 0 : 1) - (b.team === room.winningTeam ? 0 : 1) || b.score - a.score)
        : rankPlayers(room.players);
      if (room.mode === 'ranked') {
        for (const player of ranked) {
          if (!player.playerId) continue;
          const current = await pool.query(
            'SELECT party_rating, party_season_id FROM humanity_players WHERE id = $1 FOR UPDATE',
            [player.playerId]
          );
          if (current.rows[0]) {
            let rating = Number(current.rows[0].party_rating || 1000);
            if (current.rows[0].party_season_id !== seasonId) {
              rating = Math.round(1000 + (rating - 1000) * 0.75);
              await pool.query(
                'UPDATE humanity_players SET party_rating = $2, party_season_id = $3, updated_at = NOW() WHERE id = $1',
                [player.playerId, rating, seasonId]
              );
            }
            player.rating = rating;
          }
        }
      }
      const rankedAccounts = ranked.filter(player => player.playerId);
      const averageRating = rankedAccounts.reduce((sum, player) => sum + player.rating, 0) /
        Math.max(1, rankedAccounts.length);

      for (let index = 0; index < ranked.length; index += 1) {
        const player = ranked[index];
        const position = index + 1;
        let ratingAfter = player.rating;
        let ratingBefore = player.rating;
        if (player.playerId) {
          const today = now.toISOString().slice(0, 10);
          const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
            .toISOString().slice(0, 10);
          const activity = await pool.query(
            'UPDATE humanity_players SET party_streak_days = CASE ' +
            'WHEN party_streak_date = $2::date THEN party_streak_days ' +
            'WHEN party_streak_date = $3::date THEN party_streak_days + 1 ELSE 1 END, ' +
            'party_streak_date = $2::date, updated_at = NOW() WHERE id = $1 RETURNING party_streak_days',
            [player.playerId, today, yesterday]
          );
          if (activity.rows[0]) player.partyStreakDays = Number(activity.rows[0].party_streak_days || 0);
        }
        const playerWon = room.variant === 'team-rush' && room.winningTeam
          ? player.team === room.winningTeam
          : position === 1;
        const xpEarned = room.mode === 'ranked' ? (position === 1 ? 120 : 35) : (playerWon ? 100 : 25);
        if (room.mode === 'ranked' && player.playerId) {
          const expected = 1 / (1 + Math.pow(10, (averageRating - player.rating) / 400));
          const actual = position === 1 ? 1 : position === 2 ? 0.5 : 0;
          ratingAfter = Math.max(100, Math.round(player.rating + 32 * (actual - expected)));
          await pool.query(
            'UPDATE humanity_players SET party_rating = $2, xp = xp + $3, level = GREATEST(1, FLOOR((xp + $3) / 500.0) + 1), updated_at = NOW() WHERE id = $1',
            [player.playerId, ratingAfter, xpEarned]
          );
        } else if (player.playerId) {
          await pool.query(
            'UPDATE humanity_players SET xp = xp + $2, level = GREATEST(1, FLOOR((xp + $2) / 500.0) + 1), updated_at = NOW() WHERE id = $1',
            [player.playerId, xpEarned]
          );
        }
        const playerKey = player.playerId || ('guest:' + player.id);
        await pool.query(
          'INSERT INTO humanity_party_match_players (match_id, player_key, player_id, guest_name, rank, score, hearts_left, rating_before, rating_after, xp_earned, won) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [matchId, playerKey, player.playerId, player.nickname, position, player.score, player.hearts, ratingBefore, ratingAfter, xpEarned, playerWon]
        );
        player.xpEarned = xpEarned;
        player.won = playerWon;
        player.ratingAfter = ratingAfter;
        player.rank = position;
      }
      return { matchId, seasonId };
    } catch (error) {
      console.error('Could not persist Globe Rush result:', error.message);
      return null;
    }
  }

  async function finishGame(room) {
    if (room.phase !== 'playing') return;
    room.phase = 'finished';
    room.timerEndsAt = null;
    room.currentHolderId = null;
    const aliveTeams = room.variant === 'team-rush'
      ? [...new Set(room.players.filter(player => player.alive).map(player => player.team).filter(Boolean))]
      : [];
    room.winningTeam = room.variant === 'team-rush' && aliveTeams.length === 1 ? aliveTeams[0] : null;
    const ranked = room.variant === 'team-rush' && room.winningTeam
      ? [...room.players].sort((a, b) => (a.team === room.winningTeam ? 0 : 1) - (b.team === room.winningTeam ? 0 : 1) || b.score - a.score)
      : rankPlayers(room.players);
    const winner = room.variant === 'team-rush' && room.winningTeam
      ? ranked.find(player => player.team === room.winningTeam)
      : ranked[0];
    const saved = await persistResult(room, winner);
    const teamNames = { nova: 'Team Nova', terra: 'Team Terra' };
    room.results = {
      variant: room.variant || 'classic',
      winner: room.variant === 'team-rush' ? (teamNames[room.winningTeam] || 'Team') : (winner ? winner.nickname : 'No winner'),
      winningTeam: room.winningTeam,
      teams: room.variant === 'team-rush' ? ['nova', 'terra'].map(team => ({
        id: team, name: teamNames[team], score: room.players.filter(player => player.team === team).reduce((sum, player) => sum + player.score, 0),
        alive: room.players.filter(player => player.team === team && player.alive).length
      })) : [],
      matchId: saved?.matchId || null,
      seasonId: saved?.seasonId || null,
      ranking: ranked.map((player, index) => ({
        rank: index + 1,
        nickname: player.nickname,
        team: player.team || null,
        score: player.score,
        hearts: player.hearts,
        rating: player.ratingAfter ?? player.rating,
        isWinner: room.variant === 'team-rush' ? player.team === room.winningTeam : index === 0
      }))
    };
    broadcast(room, { type: 'game_over', results: room.results });
    broadcastState(room);
  }

  function startPlayerTurn(room, playerId, options = {}) {
    const holder = room.players.find(player => player.id === playerId && player.alive);
    room.currentHolderId = holder ? holder.id : null;
    room.turnNumber = (room.turnNumber || 0) + 1;

    if (!holder) {
      room.timerEndsAt = null;
      room.timerDurationMs = null;
    } else if (options.startNewFuse || !room.timerEndsAt) {
      const fuseSeconds = room.variant === 'survival'
        ? survivalFuseSeconds(room.round)
        : (room.settings.turnDurationSeconds || crypto.randomInt(PLAYER_TURN_MIN_SECONDS, PLAYER_TURN_MAX_SECONDS + 1));
      room.timerDurationMs = fuseSeconds * 1000;
      room.timerEndsAt = Date.now() + room.timerDurationMs;
    } else if (options.afterPass) {
      const remainingMs = Math.max(0, room.timerEndsAt - Date.now());
      const inheritedMs = inheritedFuseDurationMs(remainingMs);
      if (inheritedMs !== remainingMs) {
        room.timerDurationMs = inheritedMs;
        room.timerEndsAt = Date.now() + inheritedMs;
      }
    }

    room.lastTimerBroadcastAt = 0;
    if (holder) holder.turnsTaken += 1;
  }

  async function newRound(room, afterPlayerId, reason) {
    room.round += 1;
    const roundSettings = room.variant === 'survival'
      ? { ...room.settings, difficulty: survivalDifficulty(room.round) }
      : room.settings;
    room.currentDifficulty = roundSettings.difficulty || room.settings.difficulty || 'normal';
    const category = engine.getPartyQuestion(room.categoryHistory || room.lastCategoryId, roundSettings);
    await loadApprovedPartyAnswers(category);
    room.category = category;
    room.lastCategoryId = category.id;
    room.categoryHistory = [...(room.categoryHistory || []), category.id];
    room.usedAnswers = [];
    room.turnNumber = 0;
    room.wrongAnswersThisCategory = 0;
    room.turnsThisCategory = 0;
    const next = nextAlive(room, afterPlayerId);
    startPlayerTurn(room, next ? next.id : null, { startNewFuse: true });
    broadcast(room, {
      type: 'new_round',
      round: room.round,
      category: {
        id: category.id,
        title: category.category,
        prompt: category.prompt,
        note: category.note
      },
      timerDurationMs: room.timerDurationMs,
      holderId: room.currentHolderId,
      reason: reason || 'round_start'
    });
    broadcastState(room);
  }

  async function popOrb(room) {
    if (room.phase !== 'playing' || room.fuseBusy) return;
    room.fuseBusy = true;
    try {
      const holder = room.players.find(player => player.id === room.currentHolderId);
      if (!holder) {
        await newRound(room, room.currentHolderId);
        return;
      }
      holder.hearts = Math.max(0, holder.hearts - 1);
      holder.alive = holder.hearts > 0;
      if (!holder.alive) holder.eliminatedAt = Date.now();
      broadcast(room, {
        type: 'orb_overload',
        nickname: holder.nickname,
        hearts: holder.hearts,
        eliminated: !holder.alive
      });
      const aliveCount = room.players.filter(player => player.alive).length;
      const remainingCompetitors = room.variant === 'team-rush'
        ? new Set(room.players.filter(player => player.alive).map(player => player.team).filter(Boolean)).size
        : aliveCount;
      if (remainingCompetitors <= 1) {
        await finishGame(room);
        return;
      }
      await newRound(room, holder.id, 'overload');
    } finally {
      room.fuseBusy = false;
    }
  }

  async function startGame(room) {
    if (room.phase !== 'lobby' || room.players.length < 2) return false;
    room.phase = 'playing';
    room.startedAt = Date.now();
    room.winningTeam = null;
    const shuffledPlayers = [...room.players];
    for (let index = shuffledPlayers.length - 1; index > 0; index -= 1) {
      const swapIndex = crypto.randomInt(0, index + 1);
      [shuffledPlayers[index], shuffledPlayers[swapIndex]] = [shuffledPlayers[swapIndex], shuffledPlayers[index]];
    }
    shuffledPlayers.forEach((player, index) => { player.team = room.variant === 'team-rush' ? (index % 2 === 0 ? 'nova' : 'terra') : null; });
    room.players.forEach(player => {
      player.hearts = room.settings.gameMode === 'sudden-death' ? 1 : room.settings.startingLives;
      player.rarityMeter = 0;
      player.score = 0;
      player.turnsTaken = 0;
      player.answersGiven = 0;
      player.invalidAnswers = 0;
      player.alive = true;
      player.eliminatedAt = 0;
    });
    room.round = 0;
    room.lastCategoryId = null;
    room.categoryHistory = [];
    await newRound(room, room.players[crypto.randomInt(0, room.players.length)].id);
    broadcast(room, { type: 'game_started' });
    return true;
  }

  async function makePlayer(socket, message) {
    let account = null;
    if (message.token) {
      try { account = await authenticateToken(String(message.token)); }
      catch (_) { account = null; }
    }
    if (message.mode === 'ranked' && !account) {
      sendError(socket, 'Ranked Globe Rush requires a free HUMANITY account.', 'account_required');
      return null;
    }
    const nickname = account ? account.username : cleanName(message.nickname);
    if (!nickname) {
      sendError(socket, 'Choose a display name between 2 and 18 characters.', 'invalid_name');
      return null;
    }
    const streakDays = account ? Math.max(0, Number(account.party_streak_days || 0)) : 0;
    const requestedAvatar = account
      ? String(account.selected_avatar || message.avatarKey || 'mercury')
      : String(message.avatarKey || 'mercury');
    const avatarIsValid = PLANET_AVATARS.some(item => item.key === requestedAvatar);
    const avatarIsUnlocked = Boolean(account && account.avatar_locked) ||
      PLANET_AVATARS.some(item => item.key === requestedAvatar && item.streak <= streakDays);
    const unlockedAvatar = avatarIsValid && avatarIsUnlocked ? requestedAvatar : 'mercury';
    const player = {
      id: crypto.randomUUID(),
      resumeToken: crypto.randomBytes(24).toString('base64url'),
      disconnectedAt: null,
      team: null,
      playerId: account ? account.id : null,
      nickname,
      avatarKey: unlockedAvatar,
      rating: account ? Number(account.party_rating || 1000) : null,
      hearts: STARTING_HEARTS,
      rarityMeter: 0,
      score: 0,
      turnsTaken: 0,
      answersGiven: 0,
      invalidAnswers: 0,
      alive: true,
      eliminatedAt: 0,
      ready: true,
      socket
    };
    return player;
  }

  function attachPlayerToRoom(socket, player, room) {
    player.roomCode = room.code;
    room.players.push(player);
    room.lastActivityAt = Date.now();
    const context = sockets.get(socket) || {};
    context.roomCode = room.code;
    context.playerId = player.id;
    sockets.set(socket, context);
    safeSend(socket, {
      type: 'joined',
      roomCode: room.code,
      playerId: player.id,
      resumeToken: player.resumeToken
    });
    const startsAutomatically = room.isHostedRoom && room.phase === 'lobby' &&
      room.settings.autoStartWhenFull && room.players.length >= room.capacity && !room.autoStartAt;
    const countdownMs = Math.max(0, Number(room.settings.countdownSeconds || 0) * 1000);
    if (startsAutomatically) room.autoStartAt = Date.now() + countdownMs;
    broadcastState(room);
    if (startsAutomatically) broadcast(room, {
      type: 'match_ready',
      startsInMs: countdownMs,
      message: countdownMs ? 'Room full · starting soon.' : 'Room full · starting now.'
    });
  }

  async function joinQueue(socket, message) {
    const groupKey = GROUPS[message.group] ? message.group : 'small';
    const group = GROUPS[groupKey];
    const mode = message.mode === 'ranked' ? 'ranked' : 'quick';
    const variant = mode === 'ranked' ? 'classic' : normaliseVariant(message.variant);
    const player = await makePlayer(socket, { ...message, mode });
    if (!player) return;

    const room = [...rooms.values()].find(item => {
      const basicMatch = item.visibility === 'public' &&
        item.phase === 'lobby' &&
        item.mode === mode &&
        (item.variant || 'classic') === variant &&
        item.group === groupKey &&
        item.players.length < item.capacity;
      if (!basicMatch || mode !== 'ranked') return basicMatch;
      const ratings = item.players.filter(existing => existing.playerId).map(existing => Number(existing.rating || 1000));
      const roomAverage = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : Number(player.rating || 1000);
      return Math.abs(roomAverage - Number(player.rating || 1000)) <= 250;
    });
    if (room) {
      if (room.players.some(item => item.playerId && item.playerId === player.playerId)) {
        sendError(socket, 'You are already in this room.', 'already_joined');
        return;
      }
      attachPlayerToRoom(socket, player, room);
    } else {
      const created = makeRoom(player, {
        visibility: 'public',
        mode,
        group: groupKey,
        variant,
        capacity: group.max,
        targetMin: group.min
      });
      const context = sockets.get(socket) || {};
      context.roomCode = created.code;
      context.playerId = player.id;
      sockets.set(socket, context);
      safeSend(socket, { type: 'joined', roomCode: created.code, playerId: player.id, resumeToken: player.resumeToken });
      broadcastState(created);
    }

    const joinedRoom = rooms.get((sockets.get(socket) || {}).roomCode);
    if (joinedRoom && joinedRoom.players.length >= joinedRoom.targetMin && !joinedRoom.autoStartAt) {
      joinedRoom.autoStartAt = Date.now() + 4500;
      broadcastState(joinedRoom);
      broadcast(joinedRoom, { type: 'match_ready', startsInMs: 4500 });
    }
  }

  async function handleMessage(socket, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const context = sockets.get(socket) || {};
    const now = Date.now();
    context.lastHeartbeatAt = now;
    sockets.set(socket, context);
    if (message.type === 'heartbeat') return;
    if (context.lastActionAt && now - context.lastActionAt < 90) {
      sendError(socket, 'Please slow down and try again.', 'rate_limited');
      return;
    }
    context.messageTimes = (context.messageTimes || []).filter(time => now - time < 10000);
    if (context.messageTimes.length >= 50) {
      sendError(socket, 'Too many actions at once. Please wait a moment.', 'message_rate_limited');
      return;
    }
    context.messageTimes.push(now);
    context.lastActionAt = now;
    sockets.set(socket, context);

    if (message.type === 'quick_play' || message.type === 'ranked_queue') {
      await joinQueue(socket, {
        ...message,
        mode: message.type === 'ranked_queue' ? 'ranked' : 'quick'
      });
      return;
    }

    if (message.type === 'create_room') {
      const initialSettings = normaliseRoomSettings(message.settings);
      const mode = initialSettings.ratingEnabled ? 'ranked' : 'private';
      const player = await makePlayer(socket, { ...message, mode });
      if (!player) return;
      const capacity = Math.max(2, Math.min(10, Number(message.capacity) || 10));
      const room = makeRoom(player, {
        visibility: message.visibility === 'public' ? 'public' : 'private',
        mode,
        group: 'private',
        capacity,
        targetMin: 2,
        settings: initialSettings,
        isHostedRoom: true,
        variant: mode === 'ranked' ? 'classic' : normaliseVariant(message.variant || message.settings?.variant)
      });
      const ownContext = sockets.get(socket) || {};
      ownContext.roomCode = room.code;
      ownContext.playerId = player.id;
      sockets.set(socket, ownContext);
      safeSend(socket, { type: 'joined', roomCode: room.code, playerId: player.id, resumeToken: player.resumeToken });
      broadcastState(room);
      return;
    }

    if (message.type === 'join_room') {
      const room = findRoom(message.code);
      if (!room || room.phase !== 'lobby' || room.players.length >= room.capacity) {
        sendError(socket, 'That room is full or is no longer accepting players.', 'room_unavailable');
        return;
      }
      const player = await makePlayer(socket, { ...message, mode: room.mode });
      if (!player) return;
      if (room.players.some(item => engine.normaliseAnswer(item.nickname) === engine.normaliseAnswer(player.nickname))) {
        sendError(socket, 'That display name is already in this room.', 'name_taken');
        return;
      }
      attachPlayerToRoom(socket, player, room);
      return;
    }

    if (message.type === 'reconnect') {
      const resumeToken = String(message.resumeToken || '');
      const room = findRoom(message.code) || [...rooms.values()].find(candidate =>
        candidate.players.some(item => item.resumeToken && item.resumeToken === resumeToken)
      );
      const player = room && room.players.find(item =>
        item.resumeToken && item.resumeToken === resumeToken
      );
      if (!room || !player) {
        sendError(socket, 'This seat is no longer available. Rejoin the room.', 'reconnect_failed');
        return;
      }
      player.socket = socket;
      player.disconnectedAt = null;
      const ownContext = sockets.get(socket) || {};
      ownContext.roomCode = room.code;
      ownContext.playerId = player.id;
      sockets.set(socket, ownContext);
      safeSend(socket, { type: 'joined', roomCode: room.code, playerId: player.id, resumeToken: player.resumeToken, reconnected: true });
      broadcastState(room);
      return;
    }

    const membership = roomForSocket(socket);
    if (!membership) {
      sendError(socket, 'Join a room before using that action.');
      return;
    }
    const { room, player } = membership;
    room.lastActivityAt = now;

    if (message.type === 'submit_answer') {
      context.answerTimes = (context.answerTimes || []).filter(time => now - time < 5000);
      if (context.answerTimes.length >= 8) {
        sendError(socket, 'Too many answers in a short time. Wait a moment and try again.', 'answer_rate_limited');
        return;
      }
      context.answerTimes.push(now);
      sockets.set(socket, context);
    }

    if (message.type === 'suggest_answer') {
      const typed = String(message.answer || '').trim().slice(0, 80);
      const categoryId = String(message.categoryId || '').slice(0, 100);
      if (room.phase !== 'playing' || !room.category || categoryId !== room.category.id) return;
      const suggestion = findPartyAnswerSuggestion(room.category, typed, room.usedAnswers);
      safeSend(socket, {
        type: 'answer_suggestion',
        requestId: Number(message.requestId) || 0,
        categoryId,
        typed,
        suggestion
      });
      return;
    }

    if (message.type === 'update_room_settings') {
      if (player.id !== room.hostId || !room.isHostedRoom) {
        sendError(socket, 'Only the host of a hosted room can edit settings.', 'not_room_host');
        return;
      }
      if (room.phase !== 'lobby') {
        sendError(socket, 'Room settings are locked once the game has started.', 'settings_locked');
        return;
      }
      const capacity = Number(message.capacity);
      if (!Number.isInteger(capacity) || capacity < room.players.length || capacity > 10 || capacity < 2) {
        sendError(socket, 'Maximum players must be between the current room size and 10.', 'invalid_capacity');
        return;
      }
      const nextSettings = normaliseRoomSettings(message.settings);
      if (nextSettings.ratingEnabled && room.players.some(existing => !existing.playerId)) {
        sendError(socket, 'Rated rooms require every explorer to sign in with a HUMANITY account first.', 'rated_requires_accounts');
        return;
      }
      room.capacity = capacity;
      room.visibility = message.visibility === 'public' ? 'public' : 'private';
      room.settings = nextSettings;
      room.variant = nextSettings.ratingEnabled ? 'classic' : normaliseVariant(message.variant || room.variant);
      room.mode = nextSettings.ratingEnabled ? 'ranked' : 'private';
      const autoStartScheduled = nextSettings.autoStartWhenFull && room.players.length >= room.capacity && !room.autoStartAt;
      if (autoStartScheduled) room.autoStartAt = Date.now() + nextSettings.countdownSeconds * 1000;
      else if (!nextSettings.autoStartWhenFull || room.players.length < room.capacity) room.autoStartAt = null;
      broadcast(room, { type: 'room_settings_saved' });
      broadcastState(room);
      if (autoStartScheduled) broadcast(room, {
        type: 'match_ready',
        startsInMs: nextSettings.countdownSeconds * 1000,
        message: 'Room full · starting soon.'
      });
      return;
    }

    if (message.type === 'chat_message') {
      context.chatTimes = (context.chatTimes || []).filter(time => now - time < 10000);
      if (context.chatTimes.length >= 6 || (context.lastChatAt && now - context.lastChatAt < 750)) {
        sendError(socket, 'Please wait a moment before sending another chat message.', 'chat_rate_limited');
        return;
      }
      const text = String(message.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (!text) return;
      context.lastChatAt = now;
      context.chatTimes.push(now);
      sockets.set(socket, context);
      const chatMessage = {
        type: 'room_chat',
        id: crypto.randomUUID(),
        nickname: player.nickname,
        text,
        createdAt: now
      };
      room.chatMessages = [...(room.chatMessages || []), chatMessage].slice(-30);
      broadcast(room, chatMessage);
      return;
    }

    if (message.type === 'start_game') {
      if (player.id !== room.hostId) {
        sendError(socket, 'Only the host can start this room.', 'not_host');
        return;
      }
      if (room.phase !== 'lobby' || room.players.length < 2) {
        sendError(socket, 'At least two explorers are needed to start.', 'not_enough_players');
        return;
      }
      if (room.autoStartAt) return;
      const countdownMs = Math.max(0, Number(room.settings.countdownSeconds || 0) * 1000);
      if (countdownMs > 0) {
        room.autoStartAt = Date.now() + countdownMs;
        broadcastState(room);
        broadcast(room, { type: 'match_ready', startsInMs: countdownMs, message: 'The host is launching the match.' });
        return;
      }
      room.autoStartAt = null;
      await startGame(room);
      return;
    }

    if (message.type === 'submit_answer') {
      if (room.phase !== 'playing' || player.id !== room.currentHolderId) {
        sendError(socket, 'The Atlas Orb is not with you right now.', 'not_your_turn');
        return;
      }
      if (room.timerEndsAt && room.timerEndsAt <= now) {
        await popOrb(room);
        return;
      }
      let resolved = engine.matchAnswer(room.category, message.answer);
      if (!resolved) {
        const verified = await verifyPartyAnswer(room.category, message.answer);
        if (verified) {
          mergePartyAnswer(room.category, verified);
          resolved = engine.matchAnswer(room.category, message.answer);
        }
      }
      if (!resolved) {
        player.invalidAnswers += 1;
        room.wrongAnswersThisCategory += 1;
        await queueUnknownAnswer(room.category, message.answer);
        sendError(socket, 'That answer is not in the verified answer set yet. Try another answer or leave it for Admin review.', 'answer_not_approved');
        broadcastState(room);
        return;
      }
      if (room.usedAnswers.some(item => item.key === resolved.key)) {
        player.invalidAnswers += 1;
        room.wrongAnswersThisCategory += 1;
        sendError(socket, 'That answer has already been used for this category. Try a different answer before the shared fuse runs out.', 'answer_used');
        broadcastState(room);
        return;
      }

      room.usedAnswers.push({ key: resolved.key, name: resolved.name });
      room.turnsThisCategory += 1;
      player.answersGiven += 1;
      player.score += resolved.points;
      player.rarityMeter += HEART_METER[resolved.rarity] || 0;
      let gainedHeart = false;
      if (player.rarityMeter >= 150 && player.hearts < room.settings.maxLives) {
        player.rarityMeter -= 150;
        player.hearts += 1;
        gainedHeart = true;
      }
      broadcast(room, {
        type: 'answer_accepted',
        playerId: player.id,
        nickname: player.nickname,
        answer: resolved.name,
        level: resolved.level,
        points: resolved.points,
        gainedHeart
      });
      const next = nextAlive(room, player.id);
      // The fuse is shared by the whole room. A pass carries the remaining time;
      // only a fuse below eight seconds is lifted back to the eight-second floor.
      startPlayerTurn(room, next ? next.id : player.id, { afterPass: true });
      broadcastState(room);
      return;
    }

    if (message.type === 'rematch') {
      if (room.phase !== 'finished' || player.id !== room.hostId) {
        sendError(socket, 'Only the host can start a rematch after a finished game.');
        return;
      }
      room.phase = 'lobby';
      room.results = null;
      room.category = null;
      room.lastCategoryId = null;
      room.categoryHistory = [];
      room.round = 0;
      room.usedAnswers = [];
      room.turnNumber = 0;
      room.wrongAnswersThisCategory = 0;
      room.turnsThisCategory = 0;
      room.players.forEach(item => {
        item.hearts = room.settings.startingLives;
        item.rarityMeter = 0;
        item.score = 0;
        item.turnsTaken = 0;
        item.answersGiven = 0;
        item.invalidAnswers = 0;
        item.alive = true;
        item.eliminatedAt = 0;
      });
      broadcastState(room);
      return;
    }

    if (message.type === 'leave_room') {
      leaveRoom(socket);
    }
  }

  function roomForSocket(socket) {
    const context = sockets.get(socket);
    if (!context || !context.roomCode || !context.playerId) return null;
    const room = rooms.get(context.roomCode);
    if (!room) return null;
    const player = room.players.find(item => item.id === context.playerId);
    return player ? { room, player } : null;
  }

  async function queueUnknownAnswer(category, raw) {
    const answerText = String(raw || '').trim().slice(0, 80);
    const answerKey = engine.normaliseAnswer(answerText);
    if (!answerKey || answerKey.length < 2) return;
    try {
      await pool.query(
        'INSERT INTO humanity_answer_review_queue (question_id, question_prompt, answer_text, answer_key) VALUES ($1,$2,$3,$4) ON CONFLICT (question_id, answer_key) DO UPDATE SET occurrences = humanity_answer_review_queue.occurrences + 1, updated_at = NOW()',
        [partyQuestionKey(category), category.prompt, answerText, answerKey]
      );
    } catch (error) {
      console.warn('Could not queue unapproved answer:', error.message);
    }
  }

  function leaveRoom(socket) {
    const membership = roomForSocket(socket);
    if (!membership) return;
    const { room, player } = membership;
    sockets.delete(socket);
    room.players = room.players.filter(item => item.id !== player.id);
    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === player.id) room.hostId = room.players[0].id;
    if (room.isHostedRoom && room.phase === 'lobby' &&
        (!room.settings.autoStartWhenFull || room.players.length < room.capacity)) {
      room.autoStartAt = null;
    } else if (!room.isHostedRoom && room.visibility === 'private' && room.phase === 'lobby') {
      const launchThreshold = Math.max(2, Number(room.targetMin || 2), Number(room.capacity || 10) - 1);
      if (room.players.length < launchThreshold) room.autoStartAt = null;
    }
    if (room.currentHolderId === player.id && room.phase === 'playing') {
      const next = nextAlive(room, player.id);
      startPlayerTurn(room, next ? next.id : null);
    }
    if (room.phase === 'playing') {
      const activeCompetitors = room.variant === 'team-rush'
        ? new Set(room.players.filter(item => item.alive).map(item => item.team).filter(Boolean)).size
        : room.players.filter(item => item.alive).length;
      if (activeCompetitors <= 1) {
        finishGame(room).catch(error => console.error(error.message));
        return;
      }
    }
    broadcastState(room);
  }

  function removeDisconnectedPlayer(room, playerId) {
    const player = room.players.find(item => item.id === playerId);
    if (!player || (player.socket && player.socket.readyState === WebSocket.OPEN)) return;
    room.players = room.players.filter(item => item.id !== playerId);
    if (!room.players.length) { rooms.delete(room.code); return; }
    if (room.hostId === playerId) room.hostId = room.players[0].id;
    if (room.currentHolderId === playerId && room.phase === 'playing') {
      const next = nextAlive(room, playerId);
      startPlayerTurn(room, next ? next.id : null);
    }
    if (room.phase === 'playing') {
      const activeCompetitors = room.variant === 'team-rush'
        ? new Set(room.players.filter(item => item.alive).map(item => item.team).filter(Boolean)).size
        : room.players.filter(item => item.alive).length;
      if (activeCompetitors <= 1) { finishGame(room).catch(error => console.error(error.message)); return; }
    }
    broadcastState(room);
  }

  function tickRooms() {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
      for (const player of [...room.players]) {
        // Detect application-level heartbeats as well as transport state. Some
        // reverse proxies can keep an upstream WebSocket looking OPEN after the
        // visitor's connection has disappeared. A client that stops sending its
        // 5-second heartbeat is marked offline within the 15-second grace window.
        const socketContext = player.socket ? (sockets.get(player.socket) || {}) : {};
        const lastHeartbeatAt = Number(socketContext.lastHeartbeatAt || socketContext.connectedAt || now);
        if (player.socket && now - lastHeartbeatAt > APP_HEARTBEAT_TIMEOUT_MS && !player.disconnectedAt) {
          const staleSocket = player.socket;
          player.socket = null;
          player.disconnectedAt = now;
          room.lastActivityAt = now;
          broadcastState(room);
          try { staleSocket.terminate(); } catch (_) { /* already closed */ }
        }
        // A WebSocket can become CLOSING/CLOSED before its close callback is
        // delivered. Detect that state on the room heartbeat as a second path,
        // so the remaining players immediately see the offline indicator.
        if (player.socket && player.socket.readyState !== WebSocket.OPEN && !player.disconnectedAt) {
          player.socket = null;
          player.disconnectedAt = now;
          room.lastActivityAt = now;
          broadcastState(room);
        }
        if (!player.socket && player.disconnectedAt && now - player.disconnectedAt >= RECONNECT_GRACE_MS) {
          removeDisconnectedPlayer(room, player.id);
        }
      }
      if (!rooms.has(code)) continue;
      if (shouldDownshiftLargeQueue(room, now)) {
        const previousCode = room.code;
        const players = [...room.players];
        const host = players.find(player => player.id === room.hostId) || players[0];
        const flexibleRoom = makeRoom(host, {
          visibility: 'public',
          mode: room.mode,
          group: 'flex',
          variant: room.variant || 'classic',
          capacity: players.length,
          targetMin: 2,
          settings: room.settings
        });
        flexibleRoom.players = players;
        flexibleRoom.targetMin = 2;
        flexibleRoom.fallbackApplied = true;
        flexibleRoom.chatMessages = room.chatMessages || [];
        flexibleRoom.createdAt = now;
        flexibleRoom.lastActivityAt = now;
        flexibleRoom.autoStartAt = now + 4500;
        for (const player of players) {
          player.roomCode = flexibleRoom.code;
          if (!player.socket) continue;
          const socketContext = sockets.get(player.socket) || {};
          socketContext.roomCode = flexibleRoom.code;
          socketContext.playerId = player.id;
          sockets.set(player.socket, socketContext);
          safeSend(player.socket, {
            type: 'queue_adjusted',
            group: 'flex',
            players: players.length,
            message: 'The 8–10 player wait group has been moved into a ' + players.length + '-player match so you can start.'
          });
          safeSend(player.socket, {
            type: 'joined',
            roomCode: flexibleRoom.code,
            playerId: player.id,
            resumeToken: player.resumeToken,
            migrated: true,
            previousRoomCode: previousCode
          });
        }
        rooms.delete(previousCode);
        broadcastState(flexibleRoom);
        broadcast(flexibleRoom, { type: 'match_ready', startsInMs: 4500, message: 'Smaller match · starting shortly.' });
        continue;
      }
      if (now - room.lastActivityAt > ROOM_IDLE_MS && (room.phase === 'lobby' || room.phase === 'finished')) {
        rooms.delete(code);
        broadcast(room, { type: 'room_closed', message: 'This room has expired.' });
        continue;
      }
      if (room.phase === 'lobby' && room.autoStartAt && room.autoStartAt <= now) {
        room.autoStartAt = null;
        if (room.players.length >= room.targetMin) {
          startGame(room).catch(error => console.error('Globe Rush auto-start failed:', error.message));
        }
      }
      if (room.phase === 'playing' && room.timerEndsAt && room.timerEndsAt <= now) {
        popOrb(room).catch(error => console.error('Atlas Orb overload failed:', error.message));
      } else if (room.phase === 'playing' && now - room.lastTimerBroadcastAt > 400) {
        room.lastTimerBroadcastAt = now;
        broadcast(room, {
          type: 'timer',
          remainingMs: Math.max(0, room.timerEndsAt - now),
          durationMs: room.timerDurationMs,
          holderId: room.currentHolderId,
          turnNumber: room.turnNumber
        });
      }
    }
  }

  const tick = setInterval(tickRooms, 200);
  tick.unref();

  server.on('upgrade', (request, socket, head) => {
    let url;
    try { url = new URL(request.url, 'http://localhost'); }
    catch (_) { socket.destroy(); return; }
    if (url.pathname !== '/api/party') return;
    const origin = request.headers.origin;
    const originAllowed = !origin || allowedOrigins.has(origin) ||
      origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
    if (!originAllowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });

  wss.on('connection', socket => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    const connectedAt = Date.now();
    sockets.set(socket, { connectedAt, lastHeartbeatAt: connectedAt });
    safeSend(socket, { type: 'connected', activeRooms: rooms.size });
    socket.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch (_) { sendError(socket, 'The message could not be read.'); return; }
      handleMessage(socket, message).catch(error => {
        console.error('Globe Rush action failed:', error.message);
        sendError(socket, 'The room could not process that action.');
      });
    });
    socket.on('close', () => {
      // A disconnected player stays in their seat briefly so a reconnect can be added later.
      const membership = roomForSocket(socket);
      if (membership && membership.player.socket === socket) {
        membership.player.socket = null;
        membership.player.disconnectedAt = Date.now();
        membership.room.lastActivityAt = Date.now();
        broadcastState(membership.room);
      }
    });
    socket.on('error', error => console.warn('Globe Rush socket error:', error.message));
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      try { socket.ping(); }
      catch (_) { socket.terminate(); }
    }
  }, SOCKET_HEARTBEAT_MS);
  heartbeat.unref();

  async function close() {
    clearInterval(tick);
    clearInterval(heartbeat);
    for (const socket of wss.clients) {
      try { socket.close(1001, 'Server restarting'); } catch (_) { /* ignored */ }
    }
    await new Promise(resolve => wss.close(() => resolve()));
  }

  function getLiveStats() {
    let players = 0;
    let activeRooms = 0;
    for (const room of rooms.values()) {
      const connectedPlayers = room.players.filter(player =>
        player.socket && player.socket.readyState === WebSocket.OPEN
      ).length;
      if (connectedPlayers > 0) {
        players += connectedPlayers;
        activeRooms += 1;
      }
    }
    return { players, rooms: activeRooms };
  }

  return {
    listRooms: openPublicRooms,
    close,
    getActiveRooms: () => rooms.size,
    getLiveStats
  };
}

module.exports = { createPartyServer, GROUPS, categoryRotationReason, normaliseRoomSettings, DEFAULT_ROOM_SETTINGS, inheritedFuseDurationMs, normaliseVariant, survivalFuseSeconds, survivalDifficulty, shouldDownshiftLargeQueue };
