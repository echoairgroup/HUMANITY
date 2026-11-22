'use strict';

const assert = require('node:assert/strict');
const WebSocket = require('ws');
const engine = require('./geography-engine');

const API_ROOT = (process.env.HUMANITY_API_ROOT || 'https://humanity-api-jyk5.onrender.com/api').replace(/\/$/, '');
const WS_URL = process.env.HUMANITY_PARTY_WS_URL || 'wss://humanity-api-jyk5.onrender.com/api/party';
const suffix = String(Date.now()).slice(-6);
const TURN_MIN_MS = 10_000;
const TURN_MAX_MS = 30_000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertRandomTurnDuration(roomState, label) {
  assert.ok(Number.isInteger(roomState.timerDurationMs), label + ' should expose an integer timer duration');
  assert.ok(roomState.timerDurationMs >= TURN_MIN_MS && roomState.timerDurationMs <= TURN_MAX_MS,
    label + ' should be randomly selected between 10 and 30 seconds');
  assert.equal(roomState.timerDurationMs % 1000, 0, label + ' should use whole seconds');
}

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

    const chatText = 'Ready to explore the deep.';
    const hostChatPromise = host.waitFor(message =>
      message.type === 'room_chat' && message.nickname === 'Host' + suffix && message.text === chatText,
      8000, 'host receives room chat'
    );
    const guestChatPromise = guest.waitFor(message =>
      message.type === 'room_chat' && message.nickname === 'Host' + suffix && message.text === chatText,
      8000, 'guest receives room chat'
    );
    host.send({ type: 'chat_message', text: chatText });
    const [hostChatMessage, guestChatMessage] = await Promise.all([hostChatPromise, guestChatPromise]);
    assert.equal(hostChatMessage.id, guestChatMessage.id, 'All room members should receive the same chat event');
    assert.equal(hostChatMessage.text, chatText);
    console.log('PASS: private room chat broadcasts to every connected player.');

    const hostPlayingPromise = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' && message.round === 1
    );
    const guestPlayingPromise = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' && message.round === 1
    );

    host.send({ type: 'start_game' });
    const [hostPlaying, guestPlaying] = await Promise.all([hostPlayingPromise, guestPlayingPromise]);
    assert.ok(hostPlaying.currentHolderId);
    assertRandomTurnDuration(hostPlaying, 'The opening shared fuse');
    assertRandomTurnDuration(guestPlaying, 'The guest opening shared fuse');
    assert.equal(guestPlaying.timerDurationMs, hostPlaying.timerDurationMs,
      'Everyone should see the same shared fuse duration');
    assert.equal(hostPlaying.turnNumber, 1);

    const firstHolder = hostPlaying.players.find(player => player.id === hostPlaying.currentHolderId);
    assert.ok(firstHolder, 'The first round should have an active Orb holder');
    const firstHolderClient = firstHolder.isHost ? host : guest;
    const correctQuestion = engine.getQuestion(hostPlaying.category.id);
    assert.ok(correctQuestion && correctQuestion.answers.length > 1,
      'The live category should have at least two approved geography answers');
    const firstAnswer = correctQuestion.answers[0].name;
    const secondAnswer = correctQuestion.answers.find(answer => answer.name !== firstAnswer)?.name;
    assert.ok(secondAnswer, 'The live category should have another unused answer');

    const acceptedHost = host.waitFor(message => message.type === 'answer_accepted', 15000, 'first accepted answer');
    const acceptedGuest = guest.waitFor(message => message.type === 'answer_accepted', 15000, 'first accepted answer on guest');
    const passedHost = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 2 && message.currentHolderId !== firstHolder.id,
      15000, 'shared fuse after a valid pass'
    );
    const passedGuest = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 2 && message.currentHolderId !== firstHolder.id,
      15000, 'guest sees shared fuse after a valid pass'
    );
    firstHolderClient.send({ type: 'submit_answer', answer: firstAnswer });
    await Promise.all([acceptedHost, acceptedGuest]);
    const [hostPassed, guestPassed] = await Promise.all([passedHost, passedGuest]);
    assert.equal(hostPassed.timerDurationMs, hostPlaying.timerDurationMs,
      'A pass above the eight-second floor must keep the original fuse duration');
    assert.equal(guestPassed.timerDurationMs, hostPlaying.timerDurationMs,
      'The other player must see the same inherited fuse duration');
    assert.ok(hostPassed.timerRemainingMs < hostPlaying.timerRemainingMs,
      'The shared fuse must continue counting down while it is passed');
    assert.ok(hostPassed.timerRemainingMs > 8000,
      'The first pass should happen while more than eight seconds remain');

    const nextHolder = hostPassed.players.find(player => player.id === hostPassed.currentHolderId);
    assert.ok(nextHolder && nextHolder.id !== firstHolder.id);
    assert.equal(nextHolder.turnsTaken, 1);
    const nextHolderClient = nextHolder.isHost ? host : guest;
    const alreadyUsedAnswer = hostPassed.usedAnswers[0];

    await pause(900);
    const duplicateErrorOne = nextHolderClient.waitFor(message =>
      message.type === 'error' && message.code === 'answer_used',
      10000, 'first duplicate answer response'
    );
    const duplicateStateOne = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 2 && message.currentHolderId === nextHolder.id,
      10000, 'host sees the same holder after a duplicate answer'
    );
    const guestDuplicateStateOne = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 2 && message.currentHolderId === nextHolder.id,
      10000, 'guest sees the same holder after a duplicate answer'
    );
    nextHolderClient.send({ type: 'submit_answer', answer: alreadyUsedAnswer });
    await duplicateErrorOne;
    const [afterDuplicateHost, afterDuplicateGuest] = await Promise.all([duplicateStateOne, guestDuplicateStateOne]);
    assert.equal(afterDuplicateHost.category.id, hostPlaying.category.id,
      'A duplicate must not change the shared category');
    assert.ok(afterDuplicateHost.timerRemainingMs < hostPassed.timerRemainingMs - 500,
      'A duplicate answer must not reset or pause the shared fuse');
    assert.equal(afterDuplicateGuest.turnNumber, 2);

    await pause(900);
    const duplicateErrorTwo = nextHolderClient.waitFor(message =>
      message.type === 'error' && message.code === 'answer_used',
      10000, 'second duplicate answer response'
    );
    const hostAfterSecondDuplicate = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 2 && message.currentHolderId === nextHolder.id,
      10000, 'category remains unchanged after two invalid attempts'
    );
    const guestAfterSecondDuplicate = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 2 && message.currentHolderId === nextHolder.id,
      10000, 'guest sees no category rotation after two invalid attempts'
    );
    nextHolderClient.send({ type: 'submit_answer', answer: alreadyUsedAnswer });
    await duplicateErrorTwo;
    const [hostStillSameRound, guestStillSameRound] = await Promise.all([
      hostAfterSecondDuplicate, guestAfterSecondDuplicate
    ]);
    assert.equal(hostStillSameRound.round, 1, 'Two invalid answers must not rotate the category');
    assert.equal(guestStillSameRound.category.id, hostPlaying.category.id);
    assert.equal(guestStillSameRound.currentHolderId, nextHolder.id);

    const hostNearFuseEnd = host.waitFor(message =>
      message.type === 'timer' && message.turnNumber === 2 &&
      message.holderId === nextHolder.id && message.remainingMs <= 7500,
      45000, 'shared fuse reaches the eight-second pass threshold'
    );
    const guestNearFuseEnd = guest.waitFor(message =>
      message.type === 'timer' && message.turnNumber === 2 &&
      message.holderId === nextHolder.id && message.remainingMs <= 7500,
      45000, 'guest sees the shared fuse reach the eight-second pass threshold'
    );
    const [hostTimerNearEnd, guestTimerNearEnd] = await Promise.all([hostNearFuseEnd, guestNearFuseEnd]);
    assert.ok(hostTimerNearEnd.remainingMs > 0 && guestTimerNearEnd.remainingMs > 0,
      'The fuse should still be live when it reaches the minimum-pass threshold');

    const acceptedFloorHost = host.waitFor(message => message.type === 'answer_accepted', 12000, 'answer accepted near fuse end');
    const acceptedFloorGuest = guest.waitFor(message => message.type === 'answer_accepted', 12000, 'guest sees answer accepted near fuse end');
    const floorPassedHost = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 3 && message.currentHolderId !== nextHolder.id,
      12000, 'Orb passes with the eight-second minimum'
    );
    const floorPassedGuest = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 1 && message.turnNumber === 3 && message.currentHolderId !== nextHolder.id,
      12000, 'guest sees the eight-second minimum after a pass'
    );
    nextHolderClient.send({ type: 'submit_answer', answer: secondAnswer });
    await Promise.all([acceptedFloorHost, acceptedFloorGuest]);
    const [hostFloorPassed, guestFloorPassed] = await Promise.all([floorPassedHost, floorPassedGuest]);
    assert.equal(hostFloorPassed.timerDurationMs, 8000,
      'Passing with fewer than eight seconds remaining must raise the fuse to eight seconds');
    assert.equal(guestFloorPassed.timerDurationMs, 8000,
      'All players must receive the same eight-second minimum fuse');
    assert.ok(hostFloorPassed.timerRemainingMs > 7000,
      'The next player should receive almost all of the eight-second minimum');
    assert.equal(hostFloorPassed.category.id, hostPlaying.category.id,
      'Passing the Orb must not change the current category');

    const holderAtPop = hostFloorPassed.players.find(player => player.id === hostFloorPassed.currentHolderId);
    assert.ok(holderAtPop && holderAtPop.id !== nextHolder.id);
    const hostNextRoundPromise = host.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 2 && message.turnNumber === 1,
      20000, 'host sees a new category after the Orb pops'
    );
    const guestNextRoundPromise = guest.waitFor(message =>
      message.type === 'room_state' && message.code === roomCode && message.phase === 'playing' &&
      message.round === 2 && message.turnNumber === 1,
      20000, 'guest sees a new category after the Orb pops'
    );
    const hostOverloadPromise = host.waitFor(message => message.type === 'orb_overload', 20000, 'host sees Orb overload');
    const guestOverloadPromise = guest.waitFor(message => message.type === 'orb_overload', 20000, 'guest sees Orb overload');
    const [hostNextRound, guestNextRound, hostOverload, guestOverload] = await Promise.all([
      hostNextRoundPromise, guestNextRoundPromise, hostOverloadPromise, guestOverloadPromise
    ]);
    assert.equal(hostOverload.hearts, 1, 'The holder should lose one heart when the Orb pops');
    assert.equal(guestOverload.hearts, 1, 'All players should see the same lost heart');
    assert.notEqual(hostNextRound.category.id, hostPlaying.category.id,
      'The category should change only after the Orb pops');
    assert.equal(hostNextRound.players.find(player => player.id === holderAtPop.id).hearts, 1,
      'The holder who was popped should retain one heart in this two-heart test room');
    assertRandomTurnDuration(hostNextRound, 'The new fuse after an overload');
    assertRandomTurnDuration(guestNextRound, 'The guest new fuse after an overload');
    assert.equal(hostNextRound.timerDurationMs, guestNextRound.timerDurationMs,
      'All players should see the same fresh fuse after an overload');
    assert.ok(hostNextRound.timerRemainingMs > hostNextRound.timerDurationMs - 1500,
      'A fresh random fuse should start after the Orb overload');

    console.log('PASS: shared fuse carry-over, no reset on duplicate answers, eight-second minimum pass, heart loss and new category after pop.');
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
