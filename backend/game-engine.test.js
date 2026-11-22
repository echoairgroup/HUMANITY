'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./geography-engine');
const partyRules = require('./party-server');
const practiceEngine = require('./practice-engine');

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

test('the party category changes between rounds', () => {
  const first = engine.getPartyQuestion(null);
  const second = engine.getPartyQuestion(first.id);
  assert.notEqual(first.id, second.id);
  assert.ok(second.answers.length > 0);
});

test('rarity scores use the six published Discovery Levels', () => {
  assert.deepEqual(engine.POINTS_BY_LEVEL, [10, 20, 40, 60, 80, 100]);
  assert.equal(engine.LEVEL_NAMES.length, 6);
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
