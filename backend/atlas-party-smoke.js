'use strict';

const assert = require('node:assert/strict');
const WebSocket = require('ws');
const engine = require('./geography-engine');

const API_ROOT = (process.env.HUMANITY_API_ROOT || 'https://humanity-api-jyk5.onrender.com/api').replace(/\/$/, '');
const WS_URL = process.env.HUMANITY_PARTY_WS_URL || 'wss://humanity-api-jyk5.onrender.com/api/party';
const suffix = String(Date.now()).slice(-6);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(path, headers = {}) {
  const response = await fetch(API_ROOT + path, {
    headers: { Accept: 'application/json', ...headers },
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, path + ' should return HTTP 200, got ' + response.status);
  assert.equal(payload.ok, true, path + ' should return ok=true');
  return payload;
}

function createClient(label) {
  const socket = new WebSocket(WS_URL, { handshakeTimeout: 12000 });
  const queue = [];
  const waiters = [];

  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch (_) { return; }

    if (message.type === 'timer') {
      console.log('[' + label + '] turn ' + (message.turnNumber || '?') + ': ' +
        Math.ceil((message.remainingMs || 0) / 1000) + 's left; holder=' + (message.holderId || 'none'));
    }
    if (message.type === 'orb_overload') {
      console.log('[' + label + '] Orb overload: ' + message.nickname +
        ', hearts=' + message.hearts + ', eliminated=' + message.eliminated);
    }

    const index = waiters.findIndex(waiter => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      queue.push(message);
    }
  });

  function waitFor(predicate, timeoutMs = 12000, label = 'Globe Rush message') {
    const queuedIndex = queue.findIndex(predicate);
    if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(
            'Timed out waiting for ' + label + '. Messages received: ' +
            JSON.stringify(queue.map(message => ({
              type: message.type,
              code: message.code,
              phase: message.phase,
              round: message.round,
              players: message.players?.length,
              message: message.message
            })))
          ));
        }, timeoutMs)
      };
      waiters.push(waiter);
    });
  }

  function send(payload) {
    assert.equal(socket.readyState, WebSocket.OPEN, 'WebSocket must be open before sending');
    socket.send(JSON.stringify(payload));
  }

  socket.on('close', (code, reason) => console.log('[' + label + '] socket closed: ' + code + ' ' + reason.toString()));
  socket.on('error', error => console.log('[' + label + '] socket error: ' + error.message));
  return { socket, waitFor, send };
}

async function connect(label) {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const client = createClient(label);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 12000);
        client.socket.once('open', () => { clearTimeout(timer); resolve(); });
        client.socket.once('error', error => { clearTimeout(timer); reject(error); });
      });
      await client.waitFor(message => message.type === 'connected', 10000, label + ' connection confirmation');
      console.log(label + ' connected to Globe Rush.');
      return client;
    } catch (error) {
      lastError = error;
      try { client.socket.terminate(); } catch (_) {}
      if (attempt < 10) await pause(3000);
    }
  }
  throw new Error('Could not connect ' + label + ': ' + (lastError?.message || 'unknown error'));
}

async function checkHttpSurface() {
  const health = await getJson('/health');
  assert.equal(health.database, true, 'Neon database should answer the API health query');

  const config = await getJson('/config');
  assert.equal(typeof config.auth?.google, 'boolean');
  assert.equal(typeof config.auth?.discord, 'boolean');

  const guestId = 'ci-smoke-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36));
  const daily = await getJson('/daily/current', { 'X-Humanity-Guest': guestId });
  assert.equal(daily.questionCount, 7, 'Atlas Daily should publish exactly seven questions');
  assert.equal(daily.questions.length, 7, 'Atlas Daily should return the complete seven-question edition');
  assert.match(daily.date, /^\d{4}-\d{2}-\d{2}$/);

  const rooms = await getJson('/party/rooms');
  assert.ok(Array.isArray(rooms.rooms), 'Globe Rush should return its public room list');
  console.log('PASS: API health, Neon query, public configuration, Atlas Daily edition and room-list route.');
}

async function checkLivePartyRound() {
  let host = null;
  let guest = null;
  let roomCode = null;

  try {
    host = await connect('Host');
    const hostJoinedPromise = host.waitFor(message => message.type === 'joined');
    const hostLobbyPromise = host.waitFor(message =>
      message.type === 'room_state' && message.players?.length === 1
    );

    host.send({
      type: 'create_room',
      visibility: 'public',
      mode: 'private',
      capacity: 2,
      nickname: 'Host' + suffix
    });

    const hostJoined = await hostJoinedPromise;
    roomCode = hostJoined.roomCode;
    assert.match(roomCode, /^[A-Z0-9]{6}$/);
    const initialLobby = await hostLobbyPromise;
    assert.equal(initialLobby.code, roomCode);
    assert.equal(initialLobby.phase, 'lobby');

    const listing = await getJson('/party/rooms');
    assert.ok(listing.rooms.some(room => room.code === roomCode), 'New public room should appear in the lobby list');

    guest = await connect('Guest');
    const guestJoinedPromise = guest.waitFor(message => message.type === 'joined' && message.roomCode === roomCode);
    const hostTwoPlayersPromise = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.players?.length === 2
    );
    const guestTwoPlayersPromise = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.players?.length === 2
    );

    guest.send({ type: 'join_room', code: roomCode, nickname: 'Guest' + suffix });
    await guestJoinedPromise;
    const [hostLobby, guestLobby] = await Promise.all([hostTwoPlayersPromise, guestTwoPlayersPromise]);
    assert.equal(hostLobby.players.filter(player => player.hearts === 2).length, 2);
    assert.ok(hostLobby.players.some(player => player.isYou && player.isHost));
    assert.ok(guestLobby.players.some(player => player.isYou && !player.isHost));

    const hostPlayingPromise = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' && message.round === 1
    );
    const guestPlayingPromise = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' && message.round === 1
    );

    host.send({ type: 'start_game' });
    const [hostPlaying, guestPlaying] = await Promise.all([hostPlayingPromise, guestPlayingPromise]);
    assert.ok(hostPlaying.currentHolderId);
    assert.equal(hostPlaying.timerDurationMs, 12000, 'Every player should receive a fresh 12-second turn');
    assert.equal(guestPlaying.timerDurationMs, 12000);
    assert.equal(hostPlaying.turnNumber, 1);

    const holder = hostPlaying.players.find(player => player.id === hostPlaying.currentHolderId);
    assert.ok(holder, 'The first round should have an active Orb holder');
    const holderClient = holder.isHost ? host : guest;
    const nextHolderClient = holder.isHost ? guest : host;
    const correctQuestion = engine.getQuestion(hostPlaying.category.id);
    assert.ok(correctQuestion && correctQuestion.answers.length, 'The live category should exist in the approved geography bank');

    const acceptedHost = host.waitFor(message => message.type === 'answer_accepted', 15000, 'host accepted answer');
    const acceptedGuest = guest.waitFor(message => message.type === 'answer_accepted', 15000, 'guest accepted answer');
    const passedHost = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 2 && message.currentHolderId !== holder.id,
      15000, 'fresh timer after a valid pass'
    );
    const passedGuest = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 2 && message.currentHolderId !== holder.id,
      15000, 'guest sees fresh timer after a valid pass'
    );
    holderClient.send({ type: 'submit_answer', answer: correctQuestion.answers[0].name });
    await Promise.all([acceptedHost, acceptedGuest]);
    const [hostPassed, guestPassed] = await Promise.all([passedHost, passedGuest]);
    assert.equal(hostPassed.timerDurationMs, 12000);
    assert.equal(guestPassed.timerDurationMs, 12000);
    assert.ok(hostPassed.timerRemainingMs > 10000, 'The next player should receive almost all of their own fresh time');
    const nextHolder = hostPassed.players.find(player => player.id === hostPassed.currentHolderId);
    assert.ok(nextHolder && nextHolder.id !== holder.id);
    assert.equal(nextHolder.turnsTaken, 1);

    const firstWrongClient = nextHolder.isHost ? host : guest;
    const alreadyUsedAnswer = hostPassed.usedAnswers[0];
    await pause(1300);
    const wrongOneError = firstWrongClient.waitFor(message =>
      message.type === 'error' && message.code === 'answer_used',
      10000, 'first duplicate answer response'
    );
    const hostWrongOnePromise = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.wrongAnswersThisCategory === 1,
      10000, 'host sees first incorrect answer count'
    );
    const guestWrongOnePromise = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.wrongAnswersThisCategory === 1,
      10000, 'guest sees first incorrect answer count'
    );
    firstWrongClient.send({ type: 'submit_answer', answer: alreadyUsedAnswer });
    await wrongOneError;
    const [hostWrongOne, guestWrongOne] = await Promise.all([hostWrongOnePromise, guestWrongOnePromise]);
    const afterInvalid = firstWrongClient === host ? hostWrongOne : guestWrongOne;
    assert.ok(afterInvalid.timerRemainingMs < hostPassed.timerRemainingMs - 700,
      'A duplicate answer must not reset the current player clock');
    await pause(1200);

    const wrongTwoError = firstWrongClient.waitFor(message =>
      message.type === 'error' && message.code === 'category_changed',
      10000, 'second incorrect answer triggers category rotation'
    );
    const hostCategoryChange = host.waitFor(message =>
      message.type === 'new_round' && message.reason === 'mistakes',
      10000, 'host category change reason'
    );
    const guestCategoryChange = guest.waitFor(message =>
      message.type === 'new_round' && message.reason === 'mistakes',
      10000, 'guest category change reason'
    );
    const hostNextRoundPromise = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 2 && message.turnNumber === 1,
      10000, 'host new category with reset counters'
    );
    const guestNextRoundPromise = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 2 && message.turnNumber === 1,
      10000, 'guest new category with reset counters'
    );
    firstWrongClient.send({ type: 'submit_answer', answer: alreadyUsedAnswer });
    await wrongTwoError;
    const [hostReason, guestReason, hostNextRound, guestNextRound] = await Promise.all([
      hostCategoryChange, guestCategoryChange, hostNextRoundPromise, guestNextRoundPromise
    ]);
    assert.equal(hostReason.round, 2);
    assert.equal(guestReason.round, 2);
    assert.equal(hostNextRound.round, 2);
    assert.equal(guestNextRound.round, 2);
    assert.notEqual(hostNextRound.category.id, hostPlaying.category.id, 'The category should rotate to a new prompt');
    assert.equal(hostNextRound.wrongAnswersThisCategory, 0);
    assert.equal(guestNextRound.wrongAnswersThisCategory, 0);
    assert.equal(hostNextRound.turnsThisCategory, 0);
    assert.equal(guestNextRound.turnsThisCategory, 0);
    assert.equal(hostNextRound.timerDurationMs, 12000);
    assert.ok(hostNextRound.timerRemainingMs > 10000, 'A new category starts with a fresh personal clock');

    console.log('PASS: Globe Rush personal 12-second turns, valid-pass reset, wrong-answer counting and category rotation after two mistakes.');
  } finally {
    for (const client of [host, guest]) {
      if (!client?.socket) continue;
      try {
        if (client.socket.readyState === WebSocket.OPEN) client.send({ type: 'leave_room' });
        client.socket.close();
      } catch (_) {
        try { client.socket.terminate(); } catch (_) {}
      }
    }
    if (roomCode) console.log('Globe Rush smoke-test room ' + roomCode + ' cleaned up.');
  }
}

async function main() {
  await checkHttpSurface();
  await checkLivePartyRound();
}

main().catch(error => {
  console.error('HUMANITY live smoke test failed:', error);
  process.exitCode = 1;
});
