'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { createArcade } = require('./arcade');

const WS_URL = process.env.HUMANITY_PARTY_WS_URL || 'wss://humanity-api-jyk5.onrender.com/api/party';
const API_ROOT = process.env.HUMANITY_API_ROOT || 'https://humanity-api-jyk5.onrender.com/api';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function createClient(url = WS_URL) {
  const socket = new WebSocket(url, { handshakeTimeout: 8000 });
  const queue = [];
  const waiters = [];

  socket.on('message', raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (_) {
      return;
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

  function waitFor(predicate, timeoutMs = 12000) {
    const queuedIndex = queue.findIndex(predicate);
    if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('Timed out waiting for an Atlas Party message.'));
        }, timeoutMs)
      };
      waiters.push(waiter);
    });
  }

  return { socket, waitFor };
}

async function connectWithRetry(label, url = WS_URL) {
  let lastError;
  for (let attempt = 1; attempt <= 14; attempt += 1) {
    const client = createClient(url);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket connection timed out.')), 9000);
        client.socket.once('open', () => {
          clearTimeout(timer);
          resolve();
        });
        client.socket.once('error', error => {
          clearTimeout(timer);
          reject(error);
        });
      });
      console.log(label + ' connected to Atlas Party on attempt ' + attempt + '.');
      return client;
    } catch (error) {
      lastError = error;
      try { client.socket.terminate(); } catch (_) { /* already closed */ }
      if (attempt < 14) await pause(4000);
    }
  }
  throw new Error('Could not connect ' + label + ' to Atlas Party: ' + (lastError?.message || 'unknown error'));
}

function send(client, payload) {
  if (client.socket.readyState !== WebSocket.OPEN) {
    throw new Error('Atlas Party socket is not open.');
  }
  client.socket.send(JSON.stringify(payload));
}

async function testLocalPartyRound() {
  const testCountries = [
    { code: 'NLD', name: 'Netherlands' },
    { code: 'BEL', name: 'Belgium' },
    { code: 'DEU', name: 'Germany' },
    { code: 'FRA', name: 'France' }
  ];
  const mockPool = {
    async query(sql) {
      if (String(sql).includes('SELECT payload')) return { rows: [{ payload: testCountries }] };
      return { rows: [] };
    }
  };
  const server = http.createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const arcade = createArcade({ server, pool: mockPool, allowedOrigins: new Set() });
  let host = null;
  let guest = null;

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const localUrl = 'ws://127.0.0.1:' + address.port + '/api/party';
    host = createClient(localUrl);
    guest = createClient(localUrl);
    await Promise.all([host, guest].map(client => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local game test WebSocket timed out.')), 5000);
      client.socket.once('open', () => { clearTimeout(timer); resolve(); });
      client.socket.once('error', error => { clearTimeout(timer); reject(error); });
    })));

    const suffix = String(Date.now()).slice(-5);
    const hostJoined = host.waitFor(message => message.type === 'joined');
    send(host, { type: 'create_room', visibility: 'private', nickname: 'LocalHost' + suffix });
    const hostSeat = await hostJoined;

    const guestJoined = guest.waitFor(message => message.type === 'joined');
    send(guest, { type: 'join_room', code: hostSeat.roomCode, nickname: 'LocalGuest' + suffix });
    await guestJoined;

    const [hostLobby, guestLobby] = await Promise.all([
      host.waitFor(message => message.type === 'room_state' && message.room?.players.length === 2),
      guest.waitFor(message => message.type === 'room_state' && message.room?.players.length === 2)
    ]);
    assert.equal(hostLobby.room.players.filter(player => player.lives === 3).length, 2);

    const hostPlaying = host.waitFor(message => message.type === 'room_state' && message.room?.phase === 'playing');
    const guestPlaying = guest.waitFor(message => message.type === 'room_state' && message.room?.phase === 'playing');
    send(host, { type: 'start_game' });
    const [hostStart, guestStart] = await Promise.all([hostPlaying, guestPlaying]);
    assert.equal(hostStart.room.round, 1);
    assert.equal(guestStart.room.round, 1);
    assert.ok(hostStart.room.timerDurationMs >= 18000 && hostStart.room.timerDurationMs <= 30000);

    const initialHolder = hostStart.room.currentHolderId;
    const fuseHost = host.waitFor(message => message.type === 'fuse_popped' && message.playerId === initialHolder, 35000);
    const fuseGuest = guest.waitFor(message => message.type === 'fuse_popped' && message.playerId === initialHolder, 35000);
    const [hostFuse, guestFuse] = await Promise.all([fuseHost, fuseGuest]);
    assert.equal(hostFuse.lives, 2);
    assert.equal(guestFuse.lives, 2);
    assert.equal(hostFuse.eliminated, false);

    const [hostNextRound, guestNextRound] = await Promise.all([
      host.waitFor(message => message.type === 'room_state' && message.room?.round === 2),
      guest.waitFor(message => message.type === 'room_state' && message.room?.round === 2)
    ]);
    for (const room of [hostNextRound.room, guestNextRound.room]) {
      assert.equal(room.phase, 'playing');
      assert.equal(room.players.reduce((sum, player) => sum + player.lives, 0), 5);
      assert.ok(room.players.every(player => player.lives >= 2 && player.lives <= 3));
    }
    console.log('PASS: local party start, random fuse countdown, single-life penalty and next-round transition.');
  } finally {
    for (const client of [host, guest]) {
      try { client?.socket?.close(); } catch (_) { /* already closed */ }
    }
    await pause(100);
    await arcade.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  const suffix = String(Date.now()).slice(-6);
  let host = null;
  let guest = null;
  let roomCode = null;

  try {
    host = await connectWithRetry('Host');
    const hostJoinedPromise = host.waitFor(message => message.type === 'joined');
    send(host, {
      type: 'create_room',
      visibility: 'public',
      nickname: 'AtlasHost' + suffix
    });
    const hostJoined = await hostJoinedPromise;
    roomCode = hostJoined.roomCode;
    assert.match(roomCode, /^[A-Z0-9]{6}$/);
    await host.waitFor(message =>
      message.type === 'room_state' &&
      message.room?.code === roomCode &&
      message.room.players.length === 1
    );

    const listing = await fetch(API_ROOT + '/arcade/rooms', { cache: 'no-store' });
    assert.equal(listing.status, 200, 'Public-room listing should return HTTP 200.');
    const listingData = await listing.json();
    assert.ok(listingData.rooms.some(room => room.code === roomCode), 'New public room should appear in the lobby list.');

    guest = await connectWithRetry('Guest');
    const guestJoinedPromise = guest.waitFor(message => message.type === 'joined');
    send(guest, {
      type: 'join_room',
      code: roomCode,
      nickname: 'AtlasGuest' + suffix
    });
    const guestJoined = await guestJoinedPromise;
    assert.equal(guestJoined.roomCode, roomCode);

    const [hostRoom, guestRoom] = await Promise.all([
      host.waitFor(message => message.type === 'room_state' && message.room?.players.length === 2),
      guest.waitFor(message => message.type === 'room_state' && message.room?.players.length === 2)
    ]);
    assert.equal(hostRoom.room.players.length, 2);
    assert.equal(guestRoom.room.players.length, 2);
    assert.ok(hostRoom.room.players.some(player => player.isHost && player.isYou));
    assert.ok(guestRoom.room.players.some(player => player.isYou && !player.isHost));

    const hostSeesNotReady = host.waitFor(message =>
      message.type === 'room_state' &&
      message.room.players.some(player => player.isYou === false && !player.ready)
    );
    send(guest, { type: 'ready', ready: false });
    await hostSeesNotReady;

    const hostSeesReady = host.waitFor(message =>
      message.type === 'room_state' &&
      message.room.players.some(player => player.isYou === false && player.ready)
    );
    send(guest, { type: 'ready', ready: true });
    await hostSeesReady;

    const guestRemoved = guest.waitFor(message => message.type === 'removed');
    const hostRoomAfterKick = host.waitFor(message =>
      message.type === 'room_state' && message.room.players.length === 1
    );
    send(host, { type: 'kick_player', playerId: guestJoined.playerId });
    await Promise.all([guestRemoved, hostRoomAfterKick]);

    const hostLeft = host.waitFor(message => message.type === 'left_room');
    send(host, { type: 'leave_room' });
    await hostLeft;

    console.log('PASS: public room creation, lobby discovery, guest joining, live ready-state updates and host kick.');
  } finally {
    for (const client of [host, guest]) {
      if (client?.socket && client.socket.readyState !== WebSocket.CLOSED) {
        try {
          if (client.socket.readyState === WebSocket.OPEN) send(client, { type: 'leave_room' });
          client.socket.close();
        } catch (_) {
          try { client.socket.terminate(); } catch (_) { /* already closed */ }
        }
      }
    }
    if (roomCode) console.log('Atlas Party smoke-test room ' + roomCode + ' cleaned up.');
  }

  await testLocalPartyRound();
}

main().catch(error => {
  console.error('Atlas Party smoke test failed:', error);
  process.exitCode = 1;
});
