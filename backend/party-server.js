'use strict';

const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const engine = require('./geography-engine');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLAYER_TURN_MIN_SECONDS = 10;
const PLAYER_TURN_MAX_SECONDS = 30;
const MAX_WRONG_ANSWERS_PER_CATEGORY = 2;
const MAX_TURNS_PER_CATEGORY = 10;
const STARTING_HEARTS = 2;
const MAX_HEARTS = 3;
const DEFAULT_ROOM_SETTINGS = Object.freeze({
  startingLives: STARTING_HEARTS,
  maxLives: MAX_HEARTS,
  turnDurationSeconds: 0,
  maxWrongAnswersPerCategory: MAX_WRONG_ANSWERS_PER_CATEGORY,
  maxTurnsPerCategory: MAX_TURNS_PER_CATEGORY
});
const HEART_METER = [0, 5, 10, 35, 55, 100];
const ROOM_IDLE_MS = 5 * 60 * 1000;

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
  return {
    startingLives,
    maxLives: Math.max(startingLives, requestedMaxLives),
    turnDurationSeconds,
    maxWrongAnswersPerCategory,
    maxTurnsPerCategory
  };
}

function categoryRotationReason(wrongAnswers, acceptedTurns, settings = DEFAULT_ROOM_SETTINGS) {
  const rules = normaliseRoomSettings(settings);
  if (Number(wrongAnswers || 0) >= rules.maxWrongAnswersPerCategory) return 'mistakes';
  if (Number(acceptedTurns || 0) >= rules.maxTurnsPerCategory) return 'turn_limit';
  return null;
}

function createPartyServer({ server, pool, allowedOrigins, authenticateToken }) {
  const rooms = new Map();
  const sockets = new WeakMap();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false
  });

  function roomState(room, viewerId) {
    const remaining = room.timerEndsAt ? Math.max(0, room.timerEndsAt - Date.now()) : null;
    return {
      type: 'room_state',
      code: room.code,
      visibility: room.visibility,
      mode: room.mode,
      group: room.group,
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
      wrongAnswersThisCategory: room.wrongAnswersThisCategory,
      turnsThisCategory: room.turnsThisCategory,
      settings: { ...room.settings },
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
      capacity: options.capacity || 10,
      targetMin: options.targetMin || 2,
      settings: normaliseRoomSettings(options.settings),
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
        group: GROUPS[room.group] ? GROUPS[room.group].label : 'Open room',
        players: room.players.length,
        minimum: room.targetMin,
        capacity: room.capacity
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
        'INSERT INTO humanity_party_matches (id, season_id, mode, category_id, category_label, winner_player_id, player_count) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [matchId, seasonId, room.mode === 'private' ? 'private' : room.mode, room.category?.id || 'globe-rush', room.category?.category || 'Geography', winner?.playerId || null, room.players.length]
      );

      const ranked = rankPlayers(room.players);
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
        if (room.mode === 'ranked' && player.playerId) {
          const expected = 1 / (1 + Math.pow(10, (averageRating - player.rating) / 400));
          const actual = position === 1 ? 1 : position === 2 ? 0.5 : 0;
          ratingAfter = Math.max(100, Math.round(player.rating + 32 * (actual - expected)));
          await pool.query(
            'UPDATE humanity_players SET party_rating = $2, xp = xp + $3, level = GREATEST(1, FLOOR((xp + $3) / 500.0) + 1), updated_at = NOW() WHERE id = $1',
            [player.playerId, ratingAfter, position === 1 ? 120 : 35]
          );
        } else if (player.playerId) {
          await pool.query(
            'UPDATE humanity_players SET xp = xp + $2, level = GREATEST(1, FLOOR((xp + $2) / 500.0) + 1), updated_at = NOW() WHERE id = $1',
            [player.playerId, position === 1 ? 100 : 25]
          );
        }
        const playerKey = player.playerId || ('guest:' + player.id);
        await pool.query(
          'INSERT INTO humanity_party_match_players (match_id, player_key, player_id, guest_name, rank, score, hearts_left, rating_before, rating_after, xp_earned) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [matchId, playerKey, player.playerId, player.nickname, position, player.score, player.hearts, ratingBefore, ratingAfter, position === 1 ? 120 : 35]
        );
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
    const ranked = rankPlayers(room.players);
    const winner = ranked[0] && ranked[0].alive ? ranked[0] : ranked[0];
    const saved = await persistResult(room, winner);
    room.results = {
      winner: winner ? winner.nickname : 'No winner',
      matchId: saved?.matchId || null,
      seasonId: saved?.seasonId || null,
      ranking: ranked.map((player, index) => ({
        rank: index + 1,
        nickname: player.nickname,
        score: player.score,
        hearts: player.hearts,
        rating: player.ratingAfter ?? player.rating,
        isWinner: index === 0
      }))
    };
    broadcast(room, { type: 'game_over', results: room.results });
    broadcastState(room);
  }

  function startPlayerTurn(room, playerId) {
    const holder = room.players.find(player => player.id === playerId && player.alive);
    room.currentHolderId = holder ? holder.id : null;
    room.turnNumber = (room.turnNumber || 0) + 1;
    const turnSeconds = room.settings.turnDurationSeconds ||
      crypto.randomInt(PLAYER_TURN_MIN_SECONDS, PLAYER_TURN_MAX_SECONDS + 1);
    room.timerDurationMs = turnSeconds * 1000;
    room.timerEndsAt = holder ? Date.now() + room.timerDurationMs : null;
    room.lastTimerBroadcastAt = 0;
    if (holder) holder.turnsTaken += 1;
  }

  function newRound(room, afterPlayerId, reason) {
    const category = engine.getPartyQuestion(room.categoryHistory || room.lastCategoryId);
    room.category = category;
    room.lastCategoryId = category.id;
    room.categoryHistory = [...(room.categoryHistory || []), category.id];
    room.round += 1;
    room.usedAnswers = [];
    room.turnNumber = 0;
    room.wrongAnswersThisCategory = 0;
    room.turnsThisCategory = 0;
    const next = nextAlive(room, afterPlayerId);
    startPlayerTurn(room, next ? next.id : null);
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
        newRound(room, room.currentHolderId);
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
      if (room.players.filter(player => player.alive).length <= 1) {
        await finishGame(room);
        return;
      }
      newRound(room, holder.id, 'overload');
    } finally {
      room.fuseBusy = false;
    }
  }

  function startGame(room) {
    if (room.phase !== 'lobby' || room.players.length < 2) return false;
    room.phase = 'playing';
    room.players.forEach(player => {
      player.hearts = room.settings.startingLives;
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
    newRound(room, room.players[crypto.randomInt(0, room.players.length)].id);
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
    const player = {
      id: crypto.randomUUID(),
      playerId: account ? account.id : null,
      nickname,
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
      playerId: player.id
    });
    broadcastState(room);
  }

  async function joinQueue(socket, message) {
    const groupKey = GROUPS[message.group] ? message.group : 'small';
    const group = GROUPS[groupKey];
    const mode = message.mode === 'ranked' ? 'ranked' : 'quick';
    const player = await makePlayer(socket, { ...message, mode });
    if (!player) return;

    const room = [...rooms.values()].find(item => {
      const basicMatch = item.visibility === 'public' &&
        item.phase === 'lobby' &&
        item.mode === mode &&
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
        capacity: group.max,
        targetMin: group.min
      });
      const context = sockets.get(socket) || {};
      context.roomCode = created.code;
      context.playerId = player.id;
      sockets.set(socket, context);
      safeSend(socket, { type: 'joined', roomCode: created.code, playerId: player.id });
      broadcastState(created);
    }

    const joinedRoom = rooms.get((sockets.get(socket) || {}).roomCode);
    if (joinedRoom && joinedRoom.players.length >= joinedRoom.targetMin && !joinedRoom.autoStartAt) {
      joinedRoom.autoStartAt = Date.now() + 4500;
      broadcast(joinedRoom, { type: 'match_ready', startsInMs: 4500 });
    }
  }

  async function handleMessage(socket, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const context = sockets.get(socket) || {};
    const now = Date.now();
    if (context.lastActionAt && now - context.lastActionAt < 90) {
      sendError(socket, 'Please slow down and try again.', 'rate_limited');
      return;
    }
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
      const mode = message.mode === 'ranked' ? 'ranked' : 'private';
      const player = await makePlayer(socket, { ...message, mode });
      if (!player) return;
      const capacity = Math.max(2, Math.min(10, Number(message.capacity) || 10));
      const room = makeRoom(player, {
        visibility: message.visibility === 'public' ? 'public' : 'private',
        mode,
        group: 'private',
        capacity,
        targetMin: 2,
        settings: message.settings
      });
      const ownContext = sockets.get(socket) || {};
      ownContext.roomCode = room.code;
      ownContext.playerId = player.id;
      sockets.set(socket, ownContext);
      safeSend(socket, { type: 'joined', roomCode: room.code, playerId: player.id });
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
      const room = findRoom(message.code);
      const player = room && room.players.find(item =>
        item.resumeToken && item.resumeToken === String(message.resumeToken || '')
      );
      if (!room || !player) {
        sendError(socket, 'This seat is no longer available. Rejoin the room.', 'reconnect_failed');
        return;
      }
      player.socket = socket;
      const ownContext = sockets.get(socket) || {};
      ownContext.roomCode = room.code;
      ownContext.playerId = player.id;
      sockets.set(socket, ownContext);
      safeSend(socket, { type: 'joined', roomCode: room.code, playerId: player.id });
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

    if (message.type === 'update_room_settings') {
      if (player.id !== room.hostId || room.visibility !== 'private' || room.mode !== 'private') {
        sendError(socket, 'Only the host can edit settings in a private room.', 'not_room_host');
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
      room.capacity = capacity;
      room.settings = normaliseRoomSettings(message.settings);
      broadcast(room, { type: 'room_settings_saved' });
      broadcastState(room);
      return;
    }

    if (message.type === 'chat_message') {
      if (context.lastChatAt && now - context.lastChatAt < 750) {
        sendError(socket, 'Please wait a moment before sending another chat message.', 'chat_rate_limited');
        return;
      }
      const text = String(message.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (!text) return;
      context.lastChatAt = now;
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
      room.autoStartAt = null;
      startGame(room);
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
      const resolved = engine.matchAnswer(room.category, message.answer);
      if (!resolved) {
        player.invalidAnswers += 1;
        room.wrongAnswersThisCategory += 1;
        await queueUnknownAnswer(room.category, message.answer);
        const rotationReason = categoryRotationReason(room.wrongAnswersThisCategory, room.turnsThisCategory, room.settings);
        if (rotationReason) {
          sendError(socket, 'Two incorrect answers have been made. A new category is coming up.', 'category_changed');
          newRound(room, player.id, rotationReason);
          return;
        }
        sendError(socket, 'That answer is not approved. One more incorrect answer changes the category.', 'answer_not_approved');
        broadcastState(room);
        return;
      }
      if (room.usedAnswers.some(item => item.key === resolved.key)) {
        player.invalidAnswers += 1;
        room.wrongAnswersThisCategory += 1;
        const rotationReason = categoryRotationReason(room.wrongAnswersThisCategory, room.turnsThisCategory, room.settings);
        if (rotationReason) {
          sendError(socket, 'Two incorrect answers have been made. A new category is coming up.', 'category_changed');
          newRound(room, player.id, rotationReason);
          return;
        }
        sendError(socket, 'That answer was already used. One more incorrect answer changes the category.', 'answer_used');
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
        nickname: player.nickname,
        answer: resolved.name,
        level: resolved.level,
        points: resolved.points,
        gainedHeart
      });
      const rotationReason = categoryRotationReason(room.wrongAnswersThisCategory, room.turnsThisCategory, room.settings);
      if (rotationReason) {
        newRound(room, player.id, rotationReason);
        return;
      }
      const next = nextAlive(room, player.id);
      // Every player gets a fresh personal turn clock when the Orb reaches them.
      // Invalid or duplicate answers do not reset the current holder's clock.
      startPlayerTurn(room, next ? next.id : player.id);
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
        [category.id, category.prompt, answerText, answerKey]
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
    if (room.currentHolderId === player.id && room.phase === 'playing') {
      const next = nextAlive(room, player.id);
      startPlayerTurn(room, next ? next.id : null);
    }
    if (room.phase === 'playing' && room.players.filter(item => item.alive).length <= 1) {
      finishGame(room).catch(error => console.error(error.message));
    } else {
      broadcastState(room);
    }
  }

  function tickRooms() {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
      if (now - room.lastActivityAt > ROOM_IDLE_MS && (room.phase === 'lobby' || room.phase === 'finished')) {
        rooms.delete(code);
        broadcast(room, { type: 'room_closed', message: 'This room has expired.' });
        continue;
      }
      if (room.phase === 'lobby' && room.autoStartAt && room.autoStartAt <= now) {
        room.autoStartAt = null;
        if (room.players.length >= room.targetMin) startGame(room);
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
    sockets.set(socket, { connectedAt: Date.now() });
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
      if (membership) {
        membership.player.socket = null;
        membership.room.lastActivityAt = Date.now();
        broadcastState(membership.room);
      }
    });
    socket.on('error', error => console.warn('Globe Rush socket error:', error.message));
  });

  async function close() {
    clearInterval(tick);
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

module.exports = { createPartyServer, GROUPS, categoryRotationReason, normaliseRoomSettings, DEFAULT_ROOM_SETTINGS };
