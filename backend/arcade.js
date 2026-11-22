'use strict';

const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CAPACITY = 8;
const STARTING_LIVES = 3;
const FUSE_MIN_MS = 18000;
const FUSE_MAX_MS = 30000;
const FUSE_GRACE_MS = 4000;
const ROOM_IDLE_MS = 3 * 60 * 1000;
const RECONNECT_GRACE_MS = 45000;
const EXPEDITION_TTL_MS = 3 * 60 * 60 * 1000;
const DAILY_PROMPT_COUNT = 5;

const TIER_POINTS = {
  common: 120,
  uncommon: 280,
  rare: 520,
  elusive: 820,
  atlas: 1200
};
const TIER_KM = {
  common: 100,
  uncommon: 280,
  rare: 520,
  elusive: 820,
  atlas: 1200
};

const GEOGRAPHY_PROMPTS = [
  {
    id: 'germany-neighbours',
    title: 'Find a country that shares a land border with Germany.',
    note: 'Germany has nine neighbouring countries in the heart of Europe.',
    answers: { NLD: 'common', BEL: 'common', LUX: 'atlas', FRA: 'uncommon', CHE: 'rare', AUT: 'uncommon', CZE: 'uncommon', POL: 'common', DNK: 'rare' }
  },
  {
    id: 'landlocked-africa',
    title: 'Find a landlocked country in Africa.',
    note: 'There are many countries on the continent without a coastline.',
    answers: { BWA: 'uncommon', BFA: 'common', BDI: 'rare', CAF: 'rare', TCD: 'uncommon', ETH: 'common', LSO: 'atlas', MWI: 'uncommon', MLI: 'common', NER: 'uncommon', RWA: 'rare', SSD: 'rare', SWZ: 'atlas', UGA: 'common', ZMB: 'common', ZWE: 'uncommon' }
  },
  {
    id: 'mediterranean-coast',
    title: 'Find a country with a coastline on the Mediterranean Sea.',
    note: 'Look around southern Europe, North Africa and the eastern Mediterranean.',
    answers: { ESP: 'common', FRA: 'common', MCO: 'atlas', ITA: 'common', SVN: 'rare', HRV: 'uncommon', BIH: 'atlas', MNE: 'elusive', ALB: 'rare', GRC: 'common', TUR: 'common', CYP: 'rare', SYR: 'rare', LBN: 'elusive', ISR: 'uncommon', EGY: 'common', LBY: 'rare', TUN: 'uncommon', DZA: 'uncommon', MAR: 'uncommon', MLT: 'atlas' }
  },
  {
    id: 'caribbean-island',
    title: 'Find an island country in the Caribbean.',
    note: 'The Caribbean Sea is dotted with island nations and archipelagos.',
    answers: { ATG: 'elusive', BHS: 'uncommon', BRB: 'rare', CUB: 'common', DMA: 'atlas', DOM: 'common', GRD: 'elusive', HTI: 'uncommon', JAM: 'common', KNA: 'atlas', LCA: 'elusive', VCT: 'elusive', TTO: 'uncommon' }
  },
  {
    id: 'borders-china',
    title: 'Find a country that shares a land border with China.',
    note: 'China has 14 land neighbours across East, Central and South Asia.',
    answers: { AFG: 'rare', BTN: 'atlas', MMR: 'uncommon', IND: 'common', KAZ: 'uncommon', KGZ: 'rare', LAO: 'rare', MNG: 'uncommon', NPL: 'rare', PRK: 'elusive', PAK: 'uncommon', RUS: 'common', TJK: 'rare', VNM: 'common' }
  },
  {
    id: 'baltic-sea',
    title: 'Find a country with a coastline on the Baltic Sea.',
    note: 'The Baltic Sea lies between Scandinavia and northern mainland Europe.',
    answers: { DNK: 'common', DEU: 'common', POL: 'common', RUS: 'uncommon', EST: 'rare', LVA: 'rare', LTU: 'rare', SWE: 'uncommon', FIN: 'uncommon' }
  },
  {
    id: 'equator',
    title: 'Find a country crossed by the Equator.',
    note: 'The Equator passes through countries in South America, Africa and Asia.',
    answers: { ECU: 'common', COL: 'uncommon', BRA: 'common', STP: 'atlas', GAB: 'rare', COG: 'rare', COD: 'uncommon', UGA: 'uncommon', KEN: 'common', SOM: 'rare', IDN: 'common', KIR: 'atlas' }
  },
  {
    id: 'switzerland-neighbours',
    title: 'Find a country that shares a land border with Switzerland.',
    note: 'Switzerland is surrounded by five countries in central Europe.',
    answers: { FRA: 'common', DEU: 'common', AUT: 'uncommon', LIE: 'atlas', ITA: 'common' }
  },
  {
    id: 'iberian-peninsula',
    title: 'Find a country on the Iberian Peninsula.',
    note: 'The peninsula occupies the southwestern corner of Europe.',
    answers: { ESP: 'common', PRT: 'uncommon', AND: 'atlas' }
  },
  {
    id: 'south-america',
    title: 'Find a country in South America.',
    note: 'Choose any sovereign country on the South American continent.',
    answers: { ARG: 'common', BOL: 'uncommon', BRA: 'common', CHL: 'uncommon', COL: 'common', ECU: 'uncommon', GUY: 'rare', PRY: 'rare', PER: 'common', SUR: 'atlas', URY: 'rare', VEN: 'uncommon' }
  },
  {
    id: 'indian-ocean-island',
    title: 'Find an island country in the Indian Ocean.',
    note: 'Think of the islands east of Africa and south of Asia.',
    answers: { COM: 'rare', MDG: 'common', MDV: 'atlas', MUS: 'rare', SYC: 'atlas', LKA: 'uncommon' }
  },
  {
    id: 'scandinavia',
    title: 'Find a country in Scandinavia or the Nordic region.',
    note: 'Look to northern Europe and the North Atlantic.',
    answers: { DNK: 'common', FIN: 'uncommon', ISL: 'rare', NOR: 'common', SWE: 'common' }
  },
  {
    id: 'black-sea',
    title: 'Find a country with a coastline on the Black Sea.',
    note: 'The Black Sea connects southeastern Europe with western Asia.',
    answers: { BGR: 'uncommon', GEO: 'rare', ROU: 'uncommon', RUS: 'common', TUR: 'common', UKR: 'common' }
  },
  {
    id: 'dutch-official',
    title: 'Find a country where Dutch is an official language.',
    note: 'Dutch is used in Europe and parts of the Caribbean and South America.',
    answers: { NLD: 'common', BEL: 'uncommon', SUR: 'atlas' }
  },
  {
    id: 'himalayan-region',
    title: 'Find a country in the Himalayan region.',
    note: 'The Himalayas stretch along the southern edge of the Tibetan Plateau.',
    answers: { BTN: 'rare', CHN: 'common', IND: 'common', NPL: 'uncommon', PAK: 'uncommon' }
  },
  {
    id: 'red-sea',
    title: 'Find a country with a coastline on the Red Sea.',
    note: 'The Red Sea separates northeast Africa from the Arabian Peninsula.',
    answers: { DJI: 'rare', EGY: 'common', ERI: 'rare', ISR: 'uncommon', JOR: 'rare', SAU: 'common', SDN: 'uncommon', YEM: 'uncommon' }
  }
];

const MYSTERY_COUNTRIES = [
  { code: 'MNG', clues: ['This is a landlocked country in East Asia.', 'It shares its only land borders with Russia and China.', 'Its capital is Ulaanbaatar.'] },
  { code: 'LSO', clues: ['This country is entirely surrounded by one other country.', 'It is a high-altitude kingdom in southern Africa.', 'Its only neighbour is South Africa, and its capital is Maseru.'] },
  { code: 'BTN', clues: ['This Himalayan country is landlocked.', 'It lies between India and China.', 'Its capital is Thimphu.'] },
  { code: 'SUR', clues: ['This country is on the northern coast of South America.', 'Dutch is its official language.', 'Its capital is Paramaribo.'] },
  { code: 'MDG', clues: ['This island country lies off the southeast coast of Africa.', 'The Mozambique Channel separates it from mainland Africa.', 'Its capital is Antananarivo.'] },
  { code: 'KGZ', clues: ['This landlocked country is in Central Asia.', 'The Tian Shan mountains cover much of its territory.', 'Its capital is Bishkek.'] },
  { code: 'NAM', clues: ['This country has a long Atlantic coastline in southwest Africa.', 'The Namib Desert runs along much of its coast.', 'Its capital is Windhoek.'] },
  { code: 'ALB', clues: ['This country is in the western Balkans.', 'It has coastlines on the Adriatic and Ionian seas.', 'Its capital is Tirana.'] },
  { code: 'NPL', clues: ['This country is landlocked in South Asia.', 'Mount Everest lies on its border with China.', 'Its capital is Kathmandu.'] },
  { code: 'LAO', clues: ['This is the only landlocked country in mainland Southeast Asia.', 'The Mekong River forms part of its western border.', 'Its capital is Vientiane.'] },
  { code: 'FJI', clues: ['This country is an archipelago in the South Pacific.', 'Its two largest islands are Viti Levu and Vanua Levu.', 'Its capital is Suva.'] },
  { code: 'AND', clues: ['This tiny country is in the Pyrenees.', 'It is located between France and Spain.', 'Its capital is Andorra la Vella.'] },
  { code: 'ERI', clues: ['This country is on the Horn of Africa.', 'It has a long Red Sea coastline.', 'Its capital is Asmara.'] },
  { code: 'GUY', clues: ['This country is on the northern coast of South America.', 'English is its official language.', 'Its capital is Georgetown.'] },
  { code: 'TJK', clues: ['This is a landlocked country in Central Asia.', 'The Pamir Mountains occupy much of its east.', 'Its capital is Dushanbe.'] },
  { code: 'MWI', clues: ['This landlocked country is in southeast Africa.', 'Lake Malawi forms much of its eastern border.', 'Its capital is Lilongwe.'] },
  { code: 'GEO', clues: ['This country lies in the Caucasus region.', 'It has a coastline on the Black Sea.', 'Its capital is Tbilisi.'] },
  { code: 'ISL', clues: ['This island country is in the North Atlantic.', 'It is known for volcanoes, glaciers and geothermal landscapes.', 'Its capital is Reykjavík.'] },
  { code: 'CPV', clues: ['This island country is in the Atlantic Ocean off West Africa.', 'Its name translates to Green Cape in Portuguese.', 'Its capital is Praia.'] },
  { code: 'WSM', clues: ['This island country is in Polynesia in the South Pacific.', 'It is west of American Samoa.', 'Its capital is Apia.'] }
];

function cleanNickname(value) {
  const nickname = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (nickname.length < 2 || nickname.length > 18) return null;
  if (!/^[\p{L}\p{N}_ .'-]+$/u.test(nickname)) return null;
  if (/^(admin|moderator|system|humanity)$/i.test(nickname)) return null;
  return nickname;
}

function normaliseAnswer(value) {
  return String(value || '').normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function countryNameEditDistance(left, right, limit) {
  const a = [...left];
  const b = [...right];
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1).fill(limit + 1);
    current[0] = i;
    let rowMinimum = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      rowMinimum = Math.min(rowMinimum, current[j]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

function hashNumber(value) {
  const hash = crypto.createHash('sha256').update(String(value)).digest();
  return hash.readUInt32BE(0);
}

function pickDailyPrompts(date, mode) {
  const pool = [...GEOGRAPHY_PROMPTS];
  if (mode === 'daily') {
    const seed = hashNumber('HUMANITY-ATLAS-' + date);
    pool.sort((a, b) => hashNumber(date + ':' + seed + ':' + a.id) - hashNumber(date + ':' + seed + ':' + b.id));
    return pool.slice(0, DAILY_PROMPT_COUNT);
  }
  const selected = [];
  let seed = hashNumber('HUMANITY-PRACTICE-' + crypto.randomUUID());
  while (selected.length < DAILY_PROMPT_COUNT && pool.length) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    selected.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return selected;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(String(value) + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function randomRoomCode() {
  let output = '';
  for (let index = 0; index < 6; index += 1) {
    output += ROOM_CODE_ALPHABET[crypto.randomInt(0, ROOM_CODE_ALPHABET.length)];
  }
  return output;
}

function safeSend(socket, payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(0, index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function createArcade({ server, pool, allowedOrigins }) {
  const rooms = new Map();
  const expeditions = new Map();
  const mysteries = new Map();
  const sockets = new WeakMap();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  let countryCatalogPromise = null;
  let lastChallengePruneAt = 0;

  async function countryCatalog() {
    if (!countryCatalogPromise) {
      countryCatalogPromise = pool.query(
        "SELECT payload FROM humanity_cache WHERE cache_key = 'countries' LIMIT 1"
      ).then(result => {
        const rows = result.rows[0] && Array.isArray(result.rows[0].payload)
          ? result.rows[0].payload : [];
        const byCode = new Map();
        const byName = new Map();
        for (const country of rows) {
          if (!country || !/^[A-Z]{3}$/.test(String(country.code || '').toUpperCase())) continue;
          const item = { code: String(country.code).toUpperCase(), name: String(country.name || country.code) };
          byCode.set(item.code, item);
          byName.set(normaliseAnswer(item.name), item);
        }
        const aliases = {
          'us': 'USA', 'u s': 'USA', 'u s a': 'USA',
          'united states': 'USA', 'united states of america': 'USA', 'america': 'USA',
          'uk': 'GBR', 'u k': 'GBR', 'britain': 'GBR', 'great britain': 'GBR',
          'united kingdom': 'GBR', 'england': 'GBR', 'scotland': 'GBR', 'wales': 'GBR',
          'the netherlands': 'NLD', 'holland': 'NLD',
          'russia': 'RUS',
          'south korea': 'KOR', 'republic of korea': 'KOR', 'korea republic': 'KOR',
          'north korea': 'PRK', 'dpr korea': 'PRK',
          'czech republic': 'CZE', 'czechia': 'CZE',
          'ivory coast': 'CIV', 'cote divoire': 'CIV',
          'dr congo': 'COD', 'drc': 'COD',
          'democratic republic of the congo': 'COD', 'congo kinshasa': 'COD',
          'republic of the congo': 'COG', 'congo brazzaville': 'COG',
          'swaziland': 'SWZ', 'eswatini': 'SWZ',
          'burma': 'MMR', 'myanmar': 'MMR',
          'cape verde': 'CPV', 'cabo verde': 'CPV',
          'east timor': 'TLS', 'timor leste': 'TLS',
          'turkiye': 'TUR', 'turkey': 'TUR',
          'vatican': 'VAT', 'vatican city': 'VAT',
          'uae': 'ARE', 'united arab emirates': 'ARE',
          'laos': 'LAO', 'the gambia': 'GMB', 'gambia': 'GMB',
          'north macedonia': 'MKD', 'macedonia': 'MKD',
          'moldova': 'MDA', 'republic of moldova': 'MDA',
          'tanzania': 'TZA', 'united republic of tanzania': 'TZA',
          'bolivia': 'BOL', 'plurinational state of bolivia': 'BOL',
          'brunei': 'BRN', 'brunei darussalam': 'BRN',
          'micronesia': 'FSM', 'federated states of micronesia': 'FSM'
        };
        for (const [alias, code] of Object.entries(aliases)) {
          if (byCode.has(code)) byName.set(alias, byCode.get(code));
        }
        return { byCode, byName };
      }).catch(error => {
        countryCatalogPromise = null;
        throw error;
      });
    }
    return countryCatalogPromise;
  }

  async function handleHttp(request, response, url) {
    if (!url.pathname.startsWith('/api/arcade/')) return false;

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/arcade/rooms') {
      sendJSON(response, 200, {
        ok: true,
        rooms: [...rooms.values()]
          .filter(room => room.visibility === 'public' && room.phase === 'lobby' && room.players.length < ROOM_CAPACITY)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 30)
          .map(room => ({ code: room.code, host: room.players.find(player => player.id === room.hostId)?.nickname || 'Explorer', players: room.players.length, capacity: ROOM_CAPACITY }))
      });
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/arcade/expedition') {
      try {
        const mode = url.searchParams.get('mode') === 'practice' ? 'practice' : 'daily';
        const date = todayUTC();
        const prompts = pickDailyPrompts(date, mode);
        const id = crypto.randomUUID();
        expeditions.set(id, {
          id, mode, date, prompts,
          answers: new Map(),
          createdAt: Date.now()
        });
        const publicPrompts = prompts.map((prompt, index) => ({
          id: prompt.id,
          index,
          title: prompt.title,
          note: prompt.note
        }));
        sendJSON(response, 200, { ok: true, challengeId: id, mode, date, prompts: publicPrompts });
      } catch (error) {
        console.error('Arcade expedition creation failed:', error.message);
        sendJSON(response, 503, { ok: false, error: 'The atlas could not prepare an expedition.' });
      }
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/arcade/expedition/answer') {
      try {
        const body = await readJSON(request);
        const challenge = expeditions.get(String(body.challengeId || ''));
        const index = Number(body.promptIndex);
        if (!challenge || Date.now() - challenge.createdAt > EXPEDITION_TTL_MS) {
          sendJSON(response, 404, { ok: false, error: 'This expedition has expired. Start a new one.' });
          return true;
        }
        if (!Number.isInteger(index) || index < 0 || index >= challenge.prompts.length) {
          sendJSON(response, 400, { ok: false, error: 'That expedition clue is not valid.' });
          return true;
        }
        if (challenge.answers.has(index)) {
          sendJSON(response, 409, { ok: false, error: 'You have already answered this clue.' });
          return true;
        }
        const code = String(body.countryCode || '').toUpperCase();
        const prompt = challenge.prompts[index];
        const tier = prompt.answers[code] || null;
        const catalog = await countryCatalog();
        const country = catalog.byCode.get(code);
        if (!country) {
          sendJSON(response, 400, { ok: false, error: 'Choose a country shown on the map.' });
          return true;
        }
        const result = {
          countryCode: code,
          countryName: country.name,
          correct: Boolean(tier),
          tier: tier || null,
          points: tier ? TIER_POINTS[tier] : 0,
          kilometres: tier ? TIER_KM[tier] : 0,
          revealed: Object.entries(prompt.answers).map(([answerCode, answerTier]) => ({
            code: answerCode,
            name: catalog.byCode.get(answerCode)?.name || answerCode,
            tier: answerTier
          }))
        };
        challenge.answers.set(index, result);
        sendJSON(response, 200, { ok: true, result });
      } catch (error) {
        console.error('Arcade expedition answer failed:', error.message);
        sendJSON(response, 503, { ok: false, error: 'The atlas could not check that answer.' });
      }
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/arcade/expedition/finish') {
      try {
        const body = await readJSON(request);
        const challenge = expeditions.get(String(body.challengeId || ''));
        if (!challenge || challenge.mode !== 'daily' || challenge.date !== todayUTC()) {
          sendJSON(response, 400, { ok: false, error: 'Only today’s daily expedition can be submitted.' });
          return true;
        }
        const nickname = cleanNickname(body.nickname);
        if (!nickname) {
          sendJSON(response, 400, { ok: false, error: 'Use a nickname between 2 and 18 characters.' });
          return true;
        }
        if (challenge.answers.size !== DAILY_PROMPT_COUNT) {
          sendJSON(response, 409, { ok: false, error: 'Finish all five map clues before submitting.' });
          return true;
        }
        const answers = [...challenge.answers.entries()].sort((a, b) => a[0] - b[0]).map(([index, value]) => ({
          prompt: challenge.prompts[index].id,
          country: value.countryCode,
          correct: value.correct,
          tier: value.tier,
          points: value.points
        }));
        const score = answers.reduce((sum, answer) => sum + answer.points, 0);
        const totalKm = answers.reduce((sum, answer) => sum + (answer.correct ? TIER_KM[answer.tier] : 0), 0);
        await pool.query(
          'INSERT INTO atlas_daily_scores (challenge_date, nickname, score, total_km, answers) VALUES ($1::date, $2, $3, $4, $5::jsonb) ' +
          'ON CONFLICT (challenge_date, lower(nickname)) DO UPDATE SET ' +
          'score = GREATEST(atlas_daily_scores.score, EXCLUDED.score), ' +
          'total_km = CASE WHEN EXCLUDED.score > atlas_daily_scores.score THEN EXCLUDED.total_km ELSE atlas_daily_scores.total_km END, ' +
          'answers = CASE WHEN EXCLUDED.score > atlas_daily_scores.score THEN EXCLUDED.answers ELSE atlas_daily_scores.answers END, ' +
          'submitted_at = NOW()',
          [challenge.date, nickname, score, totalKm, JSON.stringify(answers)]
        );
        expeditions.delete(challenge.id);
        sendJSON(response, 200, { ok: true, score, totalKm, date: challenge.date });
      } catch (error) {
        console.error('Arcade daily result save failed:', error.message);
        sendJSON(response, 503, { ok: false, error: 'Your result could not be saved right now.' });
      }
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/arcade/mystery') {
      try {
        const mode = url.searchParams.get('mode') === 'practice' ? 'practice' : 'daily';
        const date = todayUTC();
        const index = mode === 'daily'
          ? hashNumber('HUMANITY-MYSTERY-' + date) % MYSTERY_COUNTRIES.length
          : crypto.randomInt(0, MYSTERY_COUNTRIES.length);
        const target = MYSTERY_COUNTRIES[index];
        const id = crypto.randomUUID();
        mysteries.set(id, { id, mode, date, target, guesses: 0, createdAt: Date.now(), complete: false });
        sendJSON(response, 200, {
          ok: true,
          challengeId: id,
          mode,
          date,
          clue: target.clues[0],
          guessesRemaining: target.clues.length
        });
      } catch (error) {
        console.error('Mystery Country creation failed:', error.message);
        sendJSON(response, 503, { ok: false, error: 'The mystery could not be prepared.' });
      }
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/arcade/mystery/guess') {
      try {
        const body = await readJSON(request);
        const challenge = mysteries.get(String(body.challengeId || ''));
        if (!challenge || challenge.complete || Date.now() - challenge.createdAt > EXPEDITION_TTL_MS) {
          sendJSON(response, 404, { ok: false, error: 'This mystery has expired. Start a new one.' });
          return true;
        }
        const code = String(body.countryCode || '').toUpperCase();
        const catalog = await countryCatalog();
        const country = catalog.byCode.get(code);
        if (!country) {
          sendJSON(response, 400, { ok: false, error: 'Choose a country from the list.' });
          return true;
        }
        challenge.guesses += 1;
        const correct = code === challenge.target.code;
        const finished = correct || challenge.guesses >= challenge.target.clues.length;
        if (finished) challenge.complete = true;
        sendJSON(response, 200, {
          ok: true,
          correct,
          finished,
          countryName: country.name,
          answer: finished ? (catalog.byCode.get(challenge.target.code)?.name || challenge.target.code) : null,
          score: correct ? Math.max(250, 1000 - ((challenge.guesses - 1) * 250)) : 0,
          clue: finished ? null : challenge.target.clues[challenge.guesses],
          guessesRemaining: Math.max(0, challenge.target.clues.length - challenge.guesses)
        });
      } catch (error) {
        console.error('Mystery Country guess failed:', error.message);
        sendJSON(response, 503, { ok: false, error: 'The mystery could not check that guess.' });
      }
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/arcade/leaderboard') {
      try {
        const date = validDate(url.searchParams.get('date')) || todayUTC();
        const result = await pool.query(
          'SELECT nickname, MAX(score)::int AS score, MAX(total_km)::int AS total_km, MIN(submitted_at) AS submitted_at ' +
          'FROM atlas_daily_scores WHERE challenge_date = $1::date ' +
          'GROUP BY lower(nickname), nickname ORDER BY score DESC, total_km DESC, submitted_at ASC LIMIT 20',
          [date]
        );
        sendJSON(response, 200, { ok: true, date, entries: result.rows.map((row, index) => ({ rank: index + 1, ...row })) });
      } catch (error) {
        console.error('Arcade leaderboard query failed:', error.message);
        sendJSON(response, 503, { ok: false, error: 'The leaderboard is temporarily unavailable.' });
      }
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/arcade/party/leaderboard') {
      try {
        const result = await pool.query(
          'SELECT nickname, MAX(score)::int AS score, MAX(rounds_survived)::int AS rounds_survived, COUNT(*)::int AS games ' +
          'FROM atlas_party_results WHERE played_at >= NOW() - INTERVAL \'30 days\' ' +
          'GROUP BY lower(nickname), nickname ORDER BY score DESC, rounds_survived DESC LIMIT 20'
        );
        sendJSON(response, 200, { ok: true, entries: result.rows.map((row, index) => ({ rank: index + 1, ...row })) });
      } catch (error) {
        console.error('Arcade party leaderboard query failed:', error.message);
        sendJSON(response, 503, { ok: false, error: 'The party leaderboard is temporarily unavailable.' });
      }
      return true;
    }

    return false;
  }

  function sendJSON(response, status, payload) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(JSON.stringify(payload));
  }

  async function readJSON(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 12000) throw new Error('Request body too large');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    return JSON.parse(text);
  }

  function safeBroadcast(room, payload) {
    for (const player of room.players) safeSend(player.socket, payload);
  }

  function roomSnapshot(room, playerId = null) {
    return {
      code: room.code,
      visibility: room.visibility,
      phase: room.phase,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      round: room.round,
      category: room.category ? { id: room.category.id, title: room.category.title } : null,
      currentHolderId: room.currentHolderId,
      timerEndsAt: room.timerEndsAt,
      timerRemaining: room.timerEndsAt ? Math.max(0, room.timerEndsAt - Date.now()) : null,
      timerDurationMs: room.timerDurationMs || null,
      usedAnswers: room.usedAnswers,
      players: room.players.map(player => ({
        id: player.id,
        nickname: player.nickname,
        lives: player.lives,
        score: player.score,
        ready: player.ready,
        connected: Boolean(player.socket && player.socket.readyState === WebSocket.OPEN),
        eliminated: player.lives <= 0,
        isHost: player.id === room.hostId,
        isYou: player.id === playerId
      }))
    };
  }

  function sendRoomState(room) {
    for (const player of room.players) {
      safeSend(player.socket, { type: 'room_state', room: roomSnapshot(room, player.id) });
    }
    safeBroadcast(room, { type: 'public_rooms_changed' });
  }

  function findRoom(code) {
    return rooms.get(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')) || null;
  }

  function livingPlayers(room) {
    return room.players.filter(player => player.lives > 0);
  }

  function nextLivingPlayer(room, currentId) {
    const living = livingPlayers(room);
    if (!living.length) return null;
    const currentIndex = room.players.findIndex(player => player.id === currentId);
    for (let step = 1; step <= room.players.length; step += 1) {
      const candidate = room.players[(currentIndex + step + room.players.length) % room.players.length];
      if (candidate && candidate.lives > 0) return candidate;
    }
    return living[0];
  }

  function randomFuse() {
    return crypto.randomInt(FUSE_MIN_MS, FUSE_MAX_MS + 1);
  }

  function nextCategory(room) {
    const available = GEOGRAPHY_PROMPTS.filter(prompt => prompt.id !== room.lastCategoryId);
    room.category = shuffle(available)[0] || shuffle(GEOGRAPHY_PROMPTS)[0];
    room.lastCategoryId = room.category.id;
    room.usedAnswers = [];
    room.round += 1;
  }

  function startFuse(room) {
    room.timerStartedAt = Date.now();
    room.timerDurationMs = randomFuse();
    room.timerEndsAt = room.timerStartedAt + room.timerDurationMs;
  }

  async function sendPartyResults(room) {
    if (room.phase === 'finishing' || room.phase === 'finished') return;
    room.phase = 'finishing';
    const ranking = [...room.players].sort((a, b) => {
      if (a.lives !== b.lives) return b.lives - a.lives;
      if (a.score !== b.score) return b.score - a.score;
      return b.roundsSurvived - a.roundsSurvived;
    });
    for (let index = 0; index < ranking.length; index += 1) {
      const player = ranking[index];
      try {
        await pool.query(
          'INSERT INTO atlas_party_results (room_code, nickname, score, placement, rounds_survived) VALUES ($1, $2, $3, $4, $5)',
          [room.code, player.nickname, player.score, index + 1, player.roundsSurvived]
        );
      } catch (error) {
        console.error('Could not save Atlas Party result:', error.message);
      }
    }
    room.phase = 'finishing';
    room.timerEndsAt = null;
    room.currentHolderId = null;
    safeBroadcast(room, {
      type: 'game_over',
      winner: ranking[0] ? ranking[0].nickname : null,
      ranking: ranking.map((player, index) => ({
        rank: index + 1,
        nickname: player.nickname,
        score: player.score,
        roundsSurvived: player.roundsSurvived,
        lives: player.lives
      }))
    });
    sendRoomState(room);
  }

  async function handleFusePop(room) {
    if (
      room.phase !== 'playing' ||
      !room.currentHolderId ||
      !room.timerEndsAt ||
      room.fuseProcessing
    ) return;

    // Lock the expired fuse before doing anything asynchronous. Without this
    // guard the 250 ms room ticker can process the same timeout repeatedly.
    room.fuseProcessing = true;
    room.timerEndsAt = null;

    try {
      const holder = room.players.find(player => player.id === room.currentHolderId);
      if (!holder) return;

      holder.lives = Math.max(0, holder.lives - 1);
      const eliminated = holder.lives === 0;
      safeBroadcast(room, {
        type: 'fuse_popped',
        playerId: holder.id,
        nickname: holder.nickname,
        lives: holder.lives,
        eliminated
      });

      const alive = livingPlayers(room);
      if (alive.length <= 1) {
        await sendPartyResults(room);
        return;
      }

      const next = nextLivingPlayer(room, holder.id);
      if (!next) {
        await sendPartyResults(room);
        return;
      }

      room.currentHolderId = next.id;
      nextCategory(room);
      startFuse(room);
      sendRoomState(room);
    } finally {
      room.fuseProcessing = false;
    }
  }

  function makeRoom(host, visibility) {
    let code = randomRoomCode();
    while (rooms.has(code)) code = randomRoomCode();
    const room = {
      code,
      visibility,
      phase: 'lobby',
      hostId: host.id,
      maxPlayers: ROOM_CAPACITY,
      players: [host],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      round: 0,
      category: null,
      lastCategoryId: null,
      currentHolderId: null,
      timerEndsAt: null,
      usedAnswers: [],
      results: null
    };
    host.roomCode = code;
    rooms.set(code, room);
    return room;
  }

  async function resolveCountryAnswer(message) {
    const catalog = await countryCatalog();
    let country = null;
    if (message.countryCode) country = catalog.byCode.get(String(message.countryCode).toUpperCase()) || null;
    if (!country && message.answer) {
      const target = normaliseAnswer(message.answer);
      country = catalog.byName.get(target) || null;
      if (!country && target.length >= 6) {
        let bestDistance = Infinity;
        const bestCountries = new Map();
        for (const [name, candidate] of catalog.byName.entries()) {
          if (name.length < 6) continue;
          const limit = Math.max(target.length, name.length) >= 12 ? 2 : 1;
          const distance = countryNameEditDistance(target, name, limit);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCountries.clear();
            bestCountries.set(candidate.code, candidate);
          } else if (distance === bestDistance && distance !== Infinity) {
            bestCountries.set(candidate.code, candidate);
          }
        }
        const allowedDistance = Math.max(target.length, [...bestCountries.values()][0]?.name.length || 0) >= 12 ? 2 : 1;
        if (bestCountries.size === 1 && bestDistance <= allowedDistance) {
          country = [...bestCountries.values()][0];
        }
      }
    }
    return country;
  }

  function roomForSocket(socket) {
    const context = sockets.get(socket);
    if (!context || !context.roomCode || !context.playerId) return null;
    const room = rooms.get(context.roomCode);
    if (!room) return null;
    const player = room.players.find(item => item.id === context.playerId);
    return player ? { room, player } : null;
  }

  function replyError(socket, message, code = 'invalid_action') {
    safeSend(socket, { type: 'error', code, message });
  }

  async function handleSocketMessage(socket, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      replyError(socket, 'That message was not understood.');
      return;
    }
    const context = sockets.get(socket) || {};
    const now = Date.now();
    const actionNeedsThrottle = message.type !== 'start_game' && message.type !== 'leave_room';
    if (actionNeedsThrottle && context.lastActionAt && now - context.lastActionAt < 80) {
      replyError(socket, 'That action arrived too quickly. Please try once more.');
      return;
    }
    context.lastActionAt = now;
    sockets.set(socket, context);

    if (message.type === 'create_room' || message.type === 'quick_play' || message.type === 'join_room') {
      const nickname = cleanNickname(message.nickname);
      if (!nickname) {
        replyError(socket, 'Choose a nickname between 2 and 18 characters.');
        return;
      }

      if (context.roomCode) leaveRoom(socket, false);

      const player = {
        id: crypto.randomUUID(),
        nickname,
        lives: STARTING_LIVES,
        score: 0,
        roundsSurvived: 0,
        ready: true,
        socket,
        resumeToken: crypto.randomBytes(18).toString('hex')
      };

      let room = null;
      if (message.type === 'create_room') {
        room = makeRoom(player, message.visibility === 'public' ? 'public' : 'private');
      } else if (message.type === 'join_room') {
        room = findRoom(message.code);
        if (!room || room.phase !== 'lobby' || room.players.length >= ROOM_CAPACITY) {
          replyError(socket, 'That room is full or no longer accepting players.', 'room_unavailable');
          return;
        }
        if (room.players.some(item => normaliseAnswer(item.nickname) === normaliseAnswer(nickname))) {
          replyError(socket, 'That nickname is already in this room.', 'nickname_taken');
          return;
        }
        room.players.push(player);
        player.roomCode = room.code;
      } else {
        room = [...rooms.values()].find(item =>
          item.visibility === 'public' && item.phase === 'lobby' && item.players.length < ROOM_CAPACITY
        );
        if (!room) room = makeRoom(player, 'public');
        else {
          if (room.players.some(item => normaliseAnswer(item.nickname) === normaliseAnswer(nickname))) {
            replyError(socket, 'That nickname is already in this room.', 'nickname_taken');
            return;
          }
          room.players.push(player);
          player.roomCode = room.code;
        }
      }

      context.roomCode = room.code;
      context.playerId = player.id;
      sockets.set(socket, context);
      safeSend(socket, {
        type: 'joined',
        roomCode: room.code,
        playerId: player.id,
        resumeToken: player.resumeToken
      });
      room.lastActivityAt = Date.now();
      sendRoomState(room);
      return;
    }

    if (message.type === 'reconnect') {
      const room = findRoom(message.code);
      const player = room && room.players.find(item =>
        item.resumeToken && item.resumeToken === String(message.resumeToken || '')
      );
      if (!room || !player) {
        replyError(socket, 'That seat could not be restored. Rejoin the room.', 'reconnect_failed');
        return;
      }
      if (player.socket && player.socket !== socket) {
        try { player.socket.close(4001, 'Reconnected from another tab'); } catch (_) { /* noop */ }
      }
      player.socket = socket;
      context.roomCode = room.code;
      context.playerId = player.id;
      sockets.set(socket, context);
      safeSend(socket, {
        type: 'joined',
        roomCode: room.code,
        playerId: player.id,
        resumeToken: player.resumeToken
      });
      safeBroadcast(room, { type: 'player_reconnected', nickname: player.nickname });
      sendRoomState(room);
      return;
    }

    const membership = roomForSocket(socket);
    if (!membership) {
      replyError(socket, 'Join a room before using that action.');
      return;
    }
    const { room, player } = membership;
    room.lastActivityAt = Date.now();

    if (message.type === 'ready') {
      if (room.phase !== 'lobby') return;
      player.ready = Boolean(message.ready);
      sendRoomState(room);
      return;
    }

    if (message.type === 'start_game') {
      if (player.id !== room.hostId) {
        replyError(socket, 'Only the host can start the game.');
        return;
      }
      if (room.phase !== 'lobby' || room.players.length < 2) {
        replyError(socket, 'At least two players are needed to start.');
        return;
      }
      if (room.players.some(item => !item.ready)) {
        replyError(socket, 'Everyone must be ready before the game starts.');
        return;
      }
      room.phase = 'playing';
      room.players.forEach(item => {
        item.lives = STARTING_LIVES;
        item.score = 0;
        item.roundsSurvived = 0;
      });
      room.round = 0;
      nextCategory(room);
      room.currentHolderId = shuffle(livingPlayers(room))[0].id;
      startFuse(room);
      safeBroadcast(room, { type: 'game_started' });
      sendRoomState(room);
      return;
    }

    if (message.type === 'rematch') {
      if (room.phase !== 'finished') {
        replyError(socket, 'This room has not finished its game yet.');
        return;
      }
      if (player.id !== room.hostId) {
        replyError(socket, 'Only the host can start a rematch.');
        return;
      }
      room.phase = 'lobby';
      room.round = 0;
      room.category = null;
      room.lastCategoryId = null;
      room.currentHolderId = null;
      room.timerEndsAt = null;
      room.timerStartedAt = null;
      room.timerDurationMs = null;
      room.usedAnswers = [];
      room.players.forEach(item => {
        item.lives = STARTING_LIVES;
        item.score = 0;
        item.roundsSurvived = 0;
        item.ready = true;
      });
      room.lastActivityAt = Date.now();
      safeBroadcast(room, { type: 'rematch_ready' });
      sendRoomState(room);
      return;
    }

    if (message.type === 'submit_answer') {
      if (room.phase !== 'playing') return;
      if (room.currentHolderId !== player.id) {
        replyError(socket, 'It is not your turn to hold the atlas.', 'not_your_turn');
        return;
      }
      if (room.timerEndsAt <= Date.now()) {
        await handleFusePop(room);
        return;
      }
      const country = await resolveCountryAnswer(message);
      if (!country) {
        replyError(socket, 'That country name was not recognised. Check the spelling and try again.', 'unknown_country');
        return;
      }
      if (!room.category.answers[country.code]) {
        replyError(socket, country.name + ' does not fit this geography clue.', 'wrong_category');
        return;
      }
      if (room.usedAnswers.includes(country.code)) {
        replyError(socket, country.name + ' has already been named this round.', 'duplicate_answer');
        return;
      }
      const tier = room.category.answers[country.code];
      const points = TIER_POINTS[tier] / 10;
      room.usedAnswers.push(country.code);
      player.score += points;
      player.roundsSurvived = Math.max(player.roundsSurvived, room.round);
      safeBroadcast(room, {
        type: 'answer_accepted',
        nickname: player.nickname,
        country: country.name,
        tier,
        points
      });
      const next = nextLivingPlayer(room, player.id);
      if (next) room.currentHolderId = next.id;
      if (room.timerEndsAt - Date.now() < FUSE_GRACE_MS) room.timerEndsAt = Date.now() + FUSE_GRACE_MS;
      sendRoomState(room);
      return;
    }

    if (message.type === 'kick_player') {
      if (player.id !== room.hostId || room.phase !== 'lobby') {
        replyError(socket, 'Only the host can remove players from the lobby.');
        return;
      }
      const target = room.players.find(item => item.id === String(message.playerId || ''));
      if (!target || target.id === player.id) return;
      safeSend(target.socket, { type: 'removed', message: 'The host removed you from the room.' });
      removePlayer(room, target.id);
      sendRoomState(room);
      return;
    }

    if (message.type === 'leave_room') {
      leaveRoom(socket, true);
    }
  }

  function removePlayer(room, playerId) {
    const index = room.players.findIndex(player => player.id === playerId);
    if (index < 0) return;
    const [removed] = room.players.splice(index, 1);
    if (removed && removed.socket) sockets.delete(removed.socket);
    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === playerId) room.hostId = room.players[0].id;
    if (room.currentHolderId === playerId && room.phase === 'playing') {
      const next = nextLivingPlayer(room, playerId);
      room.currentHolderId = next ? next.id : null;
    }
    if (room.phase === 'playing' && livingPlayers(room).length <= 1) {
      sendPartyResults(room).catch(error => console.error('Party finalization failed:', error.message));
    } else if (room.phase !== 'finishing' && room.phase !== 'finished') {
      sendRoomState(room);
    }
  }

  function leaveRoom(socket, clearContext = true) {
    const membership = roomForSocket(socket);
    if (!membership) return;
    const { room, player } = membership;
    if (clearContext) {
      sockets.delete(socket);
      safeSend(socket, { type: 'left_room' });
    }
    removePlayer(room, player.id);
    if (rooms.has(room.code)) sendRoomState(room);
  }

  function onDisconnect(socket) {
    const context = sockets.get(socket);
    if (!context) return;
    const room = rooms.get(context.roomCode);
    const player = room && room.players.find(item => item.id === context.playerId);
    sockets.delete(socket);
    if (!room || !player || player.socket !== socket) return;
    player.socket = null;
    player.disconnectedAt = Date.now();
    if (room.hostId === player.id) {
      const replacement = room.players.find(item => item.id !== player.id && item.socket && item.socket.readyState === WebSocket.OPEN);
      if (replacement) room.hostId = replacement.id;
    }
    sendRoomState(room);
  }

  function tickRooms() {
    const now = Date.now();
    if (now - lastChallengePruneAt > 60000) {
      lastChallengePruneAt = now;
      for (const [id, challenge] of expeditions.entries()) {
        if (now - challenge.createdAt > EXPEDITION_TTL_MS) expeditions.delete(id);
      }
      for (const [id, challenge] of mysteries.entries()) {
        if (now - challenge.createdAt > EXPEDITION_TTL_MS) mysteries.delete(id);
      }
    }
    for (const [code, room] of rooms.entries()) {
      if (now - room.lastActivityAt > ROOM_IDLE_MS &&
          (room.phase === 'lobby' || room.phase === 'finished')) {
        rooms.delete(code);
        safeBroadcast(room, { type: 'room_closed', message: 'This room has expired.' });
        continue;
      }
      for (const player of [...room.players]) {
        if (!player.socket && player.disconnectedAt && now - player.disconnectedAt > RECONNECT_GRACE_MS) {
          removePlayer(room, player.id);
        }
      }
      if (room.phase === 'playing' && room.timerEndsAt && room.timerEndsAt <= now) {
        handleFusePop(room).catch(error => console.error('Fuse timer failed:', error.message));
      } else if (room.phase === 'playing' && now - (room.lastTimerBroadcast || 0) > 500) {
        room.lastTimerBroadcast = now;
        safeBroadcast(room, {
          type: 'timer',
          remainingMs: Math.max(0, room.timerEndsAt - now),
          durationMs: room.timerDurationMs || FUSE_MAX_MS,
          holderId: room.currentHolderId
        });
      }
    }
  }

  const tick = setInterval(tickRooms, 250);
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
    socket.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); }
      catch (_) { replyError(socket, 'That message was not valid JSON.'); return; }
      handleSocketMessage(socket, message).catch(error => {
        console.error('Atlas Party message failed:', error.message);
        replyError(socket, 'The room could not process that action.');
      });
    });
    socket.on('close', () => onDisconnect(socket));
    socket.on('error', error => console.warn('Atlas Party socket error:', error.message));
  });

  async function close() {
    clearInterval(tick);
    for (const socket of wss.clients) {
      try { socket.close(1001, 'Server restarting'); } catch (_) { /* noop */ }
    }
    await new Promise(resolve => wss.close(() => resolve()));
  }

  return { handleHttp, close, getActiveRooms: () => rooms.size };
}

module.exports = { createArcade };
