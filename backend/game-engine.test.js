'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./geography-engine');
const partyRules = require('./party-server');
const practiceEngine = require('./practice-engine');
const dailyRunState = require('./daily-run-state');

test('daily generation creates seven questions with a geography-first mix', () => {
  const challenge = engine.generateDailyChallenge('2026-11-20');
  assert.equal(challenge.questions.length, 7);
  assert.equal(challenge.questions.filter(question => question.domain === 'geography').length, 6);
  assert.equal(challenge.questions.filter(question => question.domain === 'culture').length, 1);
});

test('daily challenge is deterministic for a UTC date', () => {
  const first = engine.generateDailyChallenge('2026-11-20');
  const second = engine.generateDailyChallenge('2026-11-20');
  assert.deepEqual(first.questions.map(question => question.id), second.questions.map(question => question.id));
});

test('Atlas Daily uses fresh regional questions across a rolling seven-edition window', () => {
  const editions = [];

  for (let day = 0; day < 16; day += 1) {
    const date = new Date(Date.UTC(2026, 10, day + 1)).toISOString().slice(0, 10);
    const recentIds = new Set(editions.slice(-7).flat());
    const challenge = engine.generateDailyChallenge(date, [...recentIds]);
    const ids = challenge.questions.map(question => question.id);

    assert.equal(ids.length, 7, 'every UTC edition must contain seven questions');
    assert.equal(new Set(ids).size, 7, 'a daily edition must not repeat a question');
    assert.ok(
      ids.every(id => !recentIds.has(id)),
      'an edition must not reuse questions from the previous seven editions'
    );
  }
});

test('Wikidata answer verification recognises all regional and open-ended question families', () => {
  const cases = [
    [{ id: 'european-rivers' }, ['river']],
    [{ id: 'asian-mountains' }, ['mountain', 'mountain range', 'peak', 'volcano']],
    [{ id: 'african-landmarks' }, ['landmark', 'monument', 'historic building', 'heritage site', 'memorial', 'tower', 'statue']],
    [{ id: 'north-america-countries' }, ['country', 'sovereign state']],
    [{ id: 'southeast-asia-countries' }, ['country', 'sovereign state']],
    [{ id: 'popular-snacks' }, ['snack', 'food', 'pastry', 'confectionery', 'dessert', 'street food']],
    [{ id: 'rush-world-waterfalls-v3', topicId: 'world-waterfalls' }, ['waterfall']],
    [{ id: 'rush-olympic-sports-v2', topicId: 'olympic-sports' }, ['olympic sport', 'sport at the olympic games', 'sport contested at the olympic games']]
  ];
  for (const [question, expectedTerms] of cases) {
    const profile = engine.wikidataExpectedTypes(question);
    assert.ok(profile, 'expected a Wikidata profile for ' + question.id);
    assert.deepEqual(profile.terms, expectedTerms);
  }
  assert.deepEqual(engine.wikidataExpectedTypes({ id: 'north-america-countries' }).regions, ['north america']);
  assert.deepEqual(engine.wikidataExpectedTypes({ id: 'southeast-asia-countries' }).regions, ['southeast asia']);
  assert.equal(engine.wikidataExpectedTypes({ id: 'flag-colours-blue-white-red' }), null);
});

test('popular snack question accepts Kroket and approved local aliases', () => {
  const question = engine.getQuestion('popular-snacks');
  assert.ok(question);
  assert.equal(engine.matchAnswer(question, 'Kroket').name, 'Kroket');
  assert.equal(engine.matchAnswer(question, 'croquette').name, 'Kroket');
  assert.equal(engine.matchAnswer(question, 'rundvleeskroket').name, 'Kroket');
});

test('approved matching preserves non-Latin writing systems', () => {
  const capitals = engine.getQuestion('capital-cities');
  assert.equal(engine.matchAnswer(capitals, 'Αθήνα').name, 'Athens');
  assert.equal(engine.matchAnswer(capitals, '東京').name, 'Tokyo');
  assert.equal(engine.matchAnswer(capitals, '北京市'), null);
});

test('normalisation handles accents, punctuation and spacing', () => {
  assert.equal(engine.normaliseAnswer('  Brasília  '), 'brasilia');
  assert.equal(engine.normaliseAnswer('Côte d’Ivoire'), 'cote divoire');
  assert.equal(engine.normaliseAnswer('  Việt   Nam '), 'viet nam');
});

test('unapproved answers are not accepted', () => {
  const snacks = engine.getQuestion('popular-snacks');
  assert.equal(engine.matchAnswer(snacks, 'invented snack name'), null);
});

test('Krillion-style autocorrection accepts a small typo but rejects unrelated answers', () => {
  const snacks = engine.getQuestion('popular-snacks');
  assert.equal(engine.matchAnswer(snacks, 'Kroekt').name, 'Kroket');
  assert.equal(engine.matchAnswer(snacks, 'Krokett').name, 'Kroket');
  assert.equal(engine.matchAnswer(snacks, 'zzzzzzzz'), null);
});

test('Krillion-style matching ignores articles, accents, punctuation and common plurals', () => {
  const riverQuestion = {
    category: 'European rivers',
    prompt: 'Name a river in Europe.',
    answers: [{ name: 'Thames', aliases: [], rarity: 2 }]
  };
  assert.equal(engine.matchAnswer(riverQuestion, 'The River Thames').name, 'Thames');
  assert.equal(engine.matchAnswer(riverQuestion, 'Thames River!').name, 'Thames');

  const snackQuestion = {
    category: 'Popular snacks',
    prompt: 'Name a popular snack.',
    answers: [{ name: 'Mushrooms', aliases: [], rarity: 1 }]
  };
  assert.equal(engine.matchAnswer(snackQuestion, 'Mushroom').name, 'Mushrooms');
});

test('Krillion-style matching converts number words into the matching digits', () => {
  const question = {
    category: 'Road names',
    prompt: 'Name a road.',
    answers: [{ name: 'Route 66', aliases: [], rarity: 2 }]
  };
  assert.equal(engine.matchAnswer(question, 'Route sixty six').name, 'Route 66');
});

test('ambiguous one-letter transpositions are not accepted', () => {
  const question = {
    category: 'Letter patterns',
    prompt: 'Name a letter pattern.',
    answers: [
      { name: 'bac', aliases: [], rarity: 1 },
      { name: 'acb', aliases: [], rarity: 2 }
    ]
  };
  assert.equal(engine.matchAnswer(question, 'abc'), null);
});

test('country aliases are matched across common international names', () => {
  const countryQuestion = engine.getQuestion('europe-countries');
  assert.ok(countryQuestion);
  const netherlands = countryQuestion.answers.find(item =>
    ['netherlands', 'the netherlands', 'holland'].includes(engine.normaliseAnswer(item.name))
  );
  if (netherlands) {
    assert.equal(engine.matchAnswer(countryQuestion, 'Holland').name, netherlands.name);
  }
});

test('country answer sets include multilingual aliases and all inhabited continent banks', () => {
  const europe = engine.getQuestion('europe-countries');
  assert.ok(europe);
  assert.equal(engine.matchAnswer(europe, 'Nederland').name, 'Netherlands');
  assert.equal(engine.matchAnswer(europe, 'Czech Republic').name, 'Czechia');
  assert.ok(engine.getQuestion('north-america-countries'));
  assert.ok(engine.getQuestion('oceania-countries'));
  assert.ok(engine.listWorldCountryAnswers().length >= 150);
});

test('Globe Rush uses the complete multilingual North America and Oceania country banks', () => {
  const bank = engine.listPartyQuestionBank();
  const northAmerica = bank.find(item => item.topicId === 'north-america-countries');
  const oceania = bank.find(item => item.topicId === 'oceania-countries');
  assert.ok(northAmerica && northAmerica.answerCount >= 20);
  assert.ok(oceania && oceania.answerCount >= 10);
  const northAmericaAnswers = engine.getQuestion('north-america-countries');
  assert.equal(engine.matchAnswer(northAmericaAnswers, 'México').name, 'Mexico');
  const oceaniaAnswers = engine.getQuestion('oceania-countries');
  assert.equal(engine.matchAnswer(oceaniaAnswers, 'Aotearoa').name, 'New Zealand');
});

test('Krillion-style autocorrection checks aliases and handles one missing or mistyped letter', () => {
  const rivers = engine.getQuestion('world-rivers');
  assert.equal(engine.matchAnswer(rivers, 'Amazn River').name, 'Amazon River');
  assert.equal(engine.matchAnswer(rivers, 'Amazon Rvier').name, 'Amazon River');
  assert.equal(engine.matchAnswer(rivers, 'Amazzon River').name, 'Amazon River');
  assert.equal(engine.matchAnswer(rivers, 'zzzzzzzz'), null);
});

test('autocorrection rejects a typo that is equally close to two valid answers', () => {
  const ambiguous = {
    id: 'ambiguous-typo-test',
    category: 'Names',
    prompt: 'Name an example.',
    answers: [
      { name: 'coasting', aliases: [], rarity: 0 },
      { name: 'boasting', aliases: [], rarity: 0 }
    ]
  };
  assert.equal(engine.matchAnswer(ambiguous, 'doasting'), null);
});

test('the party category changes between rounds', () => {
  const first = engine.getPartyQuestion(null);
  const second = engine.getPartyQuestion(first.id);
  assert.notEqual(first.id, second.id);
  assert.ok(second.answers.length > 0);
});

test('Atlas Daily rotates through distinct question families and exposes visual clues', () => {
  const challenge = engine.generateDailyChallenge('2026-12-15');
  assert.equal(challenge.questions.length, 7);
  assert.equal(new Set(challenge.questions.map(question => question.id)).size, 7);
  assert.ok(challenge.questions.every(question => question.type && question.category));
  const bank = engine.listQuestionBank();
  for (const id of [
    'flag-colours-blue-white-red',
    'flag-colours-red-white-green',
    'flag-colours-stars',
    'euro-countries',
    'landlocked-capitals',
    'world-heritage-sites',
    'national-parks',
    'olympic-sports'
  ]) {
    assert.ok(bank.some(question => question.id === id), 'missing question bank entry: ' + id);
  }
  assert.equal(engine.getQuestion('euro-countries').type, 'currency');
  assert.equal(engine.matchAnswer(engine.getQuestion('euro-countries'), 'Bulgaria').name, 'Bulgaria');
  for (const country of ['Andorra', 'Monaco', 'San Marino', 'Vatican City']) {
    assert.equal(engine.matchAnswer(engine.getQuestion('euro-countries'), country).name, country);
  }
  assert.equal(engine.matchAnswer(engine.getQuestion('landlocked-capitals'), 'Zagreb'), null);
  assert.equal(engine.getQuestion('flag-colours-blue-white-red').visual.kind, 'flag-colours');
});


test('Atlas Daily resumes interrupted runs but keeps completed official attempts locked', () => {
  assert.equal(dailyRunState.classifyDailyRun(null), 'start');
  assert.equal(dailyRunState.classifyDailyRun({ status: 'in_progress' }), 'resume');
  assert.equal(dailyRunState.classifyDailyRun({ status: 'completed' }), 'locked');
  assert.equal(dailyRunState.classifyDailyRun({ status: 'unknown' }), 'locked');
});

test('resuming an active Atlas question preserves its remaining time', () => {
  const run = { status: 'in_progress', question_started_at: new Date(1000), awaiting_next: false };
  assert.equal(dailyRunState.remainingSeconds(run, 15000, 25), 11);
  assert.equal(dailyRunState.remainingSeconds(run, 26000, 25), 0);
  assert.equal(dailyRunState.remainingSeconds(run, 0, 25), 25);
});

test('resuming from a paused result screen starts the next question with a fresh timer', () => {
  const run = { status: 'in_progress', question_started_at: new Date(1000), awaiting_next: true };
  assert.equal(dailyRunState.remainingSeconds(run, 45000, 25), 25);
});

test('daily resume persists paused-next-question state and restores the saved answer recap', () => {
  const backend = fs.readFileSync(path.join(__dirname, 'game-server.js'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, 'schema-geography.sql'), 'utf8');
  assert.match(backend, /awaiting_next = \$6/);
  assert.match(backend, /awaiting_next = FALSE/);
  assert.match(backend, /FROM humanity_daily_run_answers WHERE run_id = \$1 ORDER BY question_slot/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS awaiting_next BOOLEAN NOT NULL DEFAULT FALSE/);
});

test('Globe Rush variants are normalised and Survival pressure increases by round', () => {
  assert.equal(partyRules.normaliseVariant('team-rush'), 'team-rush');
  assert.equal(partyRules.normaliseVariant('survival'), 'survival');
  assert.equal(partyRules.normaliseVariant('unknown'), 'classic');
  assert.equal(partyRules.survivalFuseSeconds(1), 22);
  assert.equal(partyRules.survivalFuseSeconds(2), 22);
  assert.equal(partyRules.survivalFuseSeconds(3), 20);
  assert.equal(partyRules.survivalFuseSeconds(5), 18);
  assert.equal(partyRules.survivalFuseSeconds(30), 8);
  assert.equal(partyRules.survivalDifficulty(1), 'easy');
  assert.equal(partyRules.survivalDifficulty(3), 'normal');
  assert.equal(partyRules.survivalDifficulty(6), 'hard');
});

test('a stalled large queue with six or seven explorers is eligible for a flexible rematch', () => {
  const now = 100000;
  const room = {
    group: 'large', phase: 'lobby', fallbackApplied: false, createdAt: now - 25000,
    players: Array.from({ length: 6 }, (_, index) => ({ id: String(index) }))
  };
  assert.equal(partyRules.shouldDownshiftLargeQueue(room, now), true);
  assert.equal(partyRules.shouldDownshiftLargeQueue({ ...room, createdAt: now - 24999 }, now), false);
  assert.equal(partyRules.shouldDownshiftLargeQueue({ ...room, players: room.players.slice(0, 5) }, now), false);
  assert.equal(partyRules.shouldDownshiftLargeQueue({ ...room, players: [...room.players, { id: '7' }, { id: '8' }] }, now), false);
  assert.equal(partyRules.shouldDownshiftLargeQueue({ ...room, phase: 'playing' }, now), false);
  assert.equal(partyRules.shouldDownshiftLargeQueue({ ...room, fallbackApplied: true }, now), false);
});

test('rarity scores use the six published Discovery Levels', () => {
  assert.deepEqual(engine.POINTS_BY_LEVEL, [10, 20, 40, 60, 80, 100]);
  assert.equal(engine.LEVEL_NAMES.length, 6);
});
test('Globe Rush carries a shared fuse forward when more than eight seconds remain', () => {
  assert.equal(partyRules.inheritedFuseDurationMs(24000), 24000);
  assert.equal(partyRules.inheritedFuseDurationMs(8000), 8000);
});

test('Globe Rush restores a shared fuse to eight seconds when less than eight remain', () => {
  assert.equal(partyRules.inheritedFuseDurationMs(7999), 8000);
  assert.equal(partyRules.inheritedFuseDurationMs(1), 8000);
  assert.equal(partyRules.inheritedFuseDurationMs(0), 8000);
});



test('Globe Rush changes category after two incorrect answers', () => {
  assert.equal(partyRules.categoryRotationReason(1, 4), null);
  assert.equal(partyRules.categoryRotationReason(2, 4), 'mistakes');
});

test('Globe Rush changes category after ten accepted turns', () => {
  assert.equal(partyRules.categoryRotationReason(0, 9), null);
  assert.equal(partyRules.categoryRotationReason(0, 10), 'turn_limit');
});

test('two mistakes take priority when both category limits are reached', () => {
  assert.equal(partyRules.categoryRotationReason(2, 10), 'mistakes');
});


test('daily challenge avoids yesterday’s seven prompts', () => {
  const yesterday = engine.generateDailyChallenge('2026-11-20');
  const previousIds = yesterday.questions.map(question => question.id);
  const today = engine.generateDailyChallenge('2026-11-21', previousIds);
  const previous = new Set(previousIds);

  assert.equal(today.questions.length, 7);
  assert.equal(today.questions.some(question => previous.has(question.id)), false);
  assert.equal(today.questions.filter(question => question.domain === 'geography').length, 6);
  assert.equal(today.questions.filter(question => question.domain === 'culture').length, 1);
});

test('Globe Rush uses every category once before allowing a repeat', () => {
  const questionCount = engine.listQuestionBank().length;
  const history = [];

  for (let index = 0; index < questionCount; index += 1) {
    const next = engine.getPartyQuestion(history);
    assert.ok(next);
    assert.equal(history.includes(next.id), false);
    history.push(next.id);
  }

  const nextCycleQuestion = engine.getPartyQuestion(history);
  assert.notEqual(nextCycleQuestion.id, history[history.length - 1]);
});


test('private Globe Rush lobby settings have safe defaults', () => {
  assert.deepEqual(partyRules.normaliseRoomSettings(), {
    startingLives: 2,
    maxLives: 3,
    turnDurationSeconds: 0,
    maxWrongAnswersPerCategory: 2,
    maxTurnsPerCategory: 10,
    gameMode: 'classic',
    difficulty: 'normal',
    categoryTheme: 'all',
    countdownSeconds: 5,
    ratingEnabled: false,
    autoStartWhenFull: false
  });
});

test('private Globe Rush lobby settings are clamped and keep max lives above starting lives', () => {
  assert.deepEqual(partyRules.normaliseRoomSettings({
    startingLives: 5,
    maxLives: 2,
    turnDurationSeconds: 15,
    maxWrongAnswersPerCategory: 4,
    maxTurnsPerCategory: 20
  }), {
    startingLives: 5,
    maxLives: 5,
    turnDurationSeconds: 15,
    maxWrongAnswersPerCategory: 4,
    maxTurnsPerCategory: 20,
    gameMode: 'classic',
    difficulty: 'normal',
    categoryTheme: 'all',
    countdownSeconds: 5,
    ratingEnabled: false,
    autoStartWhenFull: false
  });

  assert.deepEqual(partyRules.normaliseRoomSettings({
    startingLives: 99,
    maxLives: 99,
    turnDurationSeconds: 7,
    maxWrongAnswersPerCategory: 0,
    maxTurnsPerCategory: 99,
    countdownSeconds: 4,
    gameMode: 'unknown',
    difficulty: 'impossible',
    categoryTheme: 'moon',
    ratingEnabled: 'yes',
    autoStartWhenFull: 1
  }), {
    startingLives: 5,
    maxLives: 6,
    turnDurationSeconds: 0,
    maxWrongAnswersPerCategory: 1,
    maxTurnsPerCategory: 10,
    gameMode: 'classic',
    difficulty: 'normal',
    categoryTheme: 'all',
    countdownSeconds: 5,
    ratingEnabled: false,
    autoStartWhenFull: false
  });
});

test('hosted Globe Rush game modes clamp lives and preserve the selected theme', () => {
  assert.deepEqual(partyRules.normaliseRoomSettings({
    gameMode: 'sudden-death',
    difficulty: 'hard',
    categoryTheme: 'landmarks',
    countdownSeconds: 10,
    ratingEnabled: true,
    autoStartWhenFull: true,
    startingLives: 4,
    maxLives: 5
  }), {
    startingLives: 1,
    maxLives: 1,
    turnDurationSeconds: 0,
    maxWrongAnswersPerCategory: 2,
    maxTurnsPerCategory: 10,
    gameMode: 'sudden-death',
    difficulty: 'hard',
    categoryTheme: 'landmarks',
    countdownSeconds: 10,
    ratingEnabled: true,
    autoStartWhenFull: true
  });
});

test('Globe Rush question selection respects hosted room category themes', () => {
  for (let index = 0; index < 20; index += 1) {
    const countries = engine.getPartyQuestion([], { categoryTheme: 'countries' });
    assert.match(countries.topicId, /countr/i);
    const cities = engine.getPartyQuestion([], { categoryTheme: 'cities' });
    assert.match(cities.topicId, /capital|cit/i);
    const culture = engine.getPartyQuestion([], { categoryTheme: 'culture' });
    assert.match(culture.topicId, /dish|snack|language/i);
  }
});

test('Globe Rush question selection applies the selected difficulty to available topics', () => {
  const easy = engine.getPartyQuestion([], { difficulty: 'easy' });
  const hard = engine.getPartyQuestion([], { difficulty: 'hard' });
  assert.ok(easy.answers.length >= 16);
  assert.ok(hard.answers.length <= 12);
});

test('private Globe Rush category rules use each room custom thresholds', () => {
  const settings = partyRules.normaliseRoomSettings({
    maxWrongAnswersPerCategory: 3,
    maxTurnsPerCategory: 15
  });
  assert.equal(partyRules.categoryRotationReason(2, 14, settings), null);
  assert.equal(partyRules.categoryRotationReason(3, 14, settings), 'mistakes');
  assert.equal(partyRules.categoryRotationReason(0, 15, settings), 'turn_limit');
});


test('Practice Lab themed packs each contain seven distinct question topics',()=>{
  const packs=practiceEngine.listPacks();
  assert.ok(packs.length>=6);
  for(const pack of packs){
    assert.ok(pack.questionCount>=7,pack.id+' should contain at least seven topics');
    const batch=practiceEngine.createBatch(pack.id,'practice-test-seed');
    assert.equal(batch.length,7);
    assert.equal(new Set(batch.map(question=>question.topicId)).size,7);
    assert.ok(batch.every(question=>question.answers.length>=3));
  }
});
test('Practice Lab batches are deterministic for a given seed',()=>{
  const a=practiceEngine.createBatch('world-mix','same-seed');
  const b=practiceEngine.createBatch('world-mix','same-seed');
  assert.deepEqual(a.map(q=>q.id),b.map(q=>q.id));
});
test('Practice Lab answer matching accepts curated aliases',()=>{
  const q=practiceEngine.createBatch('countries','alias-test').find(item=>item.answers.some(answer=>answer.aliases.length));
  assert.ok(q);
  const answer=q.answers.find(item=>item.aliases.length);
  assert.equal(engine.matchAnswer(q,answer.aliases[0]).name,answer.name);
});



test('frontend collection selectors use querySelectorAll helpers', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const collectionMethods = ['.forEach(', '.map(', '.filter(', '.some(', '.every(', '.reduce('];
  const invalid = frontend.split('\n').filter(line => {
    const start = line.indexOf('$(');
    if (start < 0 || (start > 0 && line[start - 1] === '$')) return false;
    const close = line.indexOf(')', start + 2);
    if (close < 0) return false;
    const suffix = line.slice(close + 1).trimStart();
    return collectionMethods.some(method => suffix.startsWith(method));
  });
  assert.deepEqual(invalid, []);
});

test('daily reveal and recap renderers are top-level helpers', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(frontend.includes('\n  function renderDailyAnswerReveal('));
  assert.ok(frontend.includes('\n  function renderDailyRecap('));
  assert.ok(frontend.includes('\n  function renderFlightDistribution(result)'));
  assert.ok(frontend.indexOf('function renderDailyAnswerReveal(') < frontend.indexOf('function renderFlightDistribution(result)'));
  assert.ok(frontend.indexOf('function renderDailyRecap(') < frontend.indexOf('function renderFlightDistribution(result)'));
  assert.ok(frontend.includes('renderDailyAnswerReveal(reveal || [], accepted, answer);'));
  assert.ok(frontend.includes('renderDailyRecap();'));
});

test('frontend event bindings and critical game panels exist in the HTML', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const boundIds = [];
  for (const line of frontend.split('\n')) {
    if (!line.includes('.addEventListener')) continue;
    const marker = "$('#";
    const start = line.indexOf(marker);
    if (start < 0) continue;
    const value = line.slice(start + marker.length);
    const end = value.indexOf("')");
    if (end > 0) boundIds.push(value.slice(0, end));
  }
  const missing = [...new Set(boundIds)].filter(id =>
    !html.includes('id="' + id + '"') && !html.includes("id='" + id + "'")
  );
  assert.deepEqual(missing, []);
  for (const id of ['daily-start', 'daily-answer-form', 'daily-next', 'practice-modal', 'practice-pack-list', 'settings-modal']) {
    assert.ok(html.includes('id="' + id + '"') || html.includes("id='" + id + "'"), id + ' must exist');
  }
});
