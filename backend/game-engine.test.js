'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./geography-engine');
const partyRules = require('./party-server');

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
  assert.deepEqual(engine.POINTS_BY_LEVEL, [10, 20, 35, 55, 75, 100]);
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
    maxTurnsPerCategory: 10
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
    maxTurnsPerCategory: 20
  });

  assert.deepEqual(partyRules.normaliseRoomSettings({
    startingLives: 99,
    maxLives: 99,
    turnDurationSeconds: 7,
    maxWrongAnswersPerCategory: 0,
    maxTurnsPerCategory: 99
  }), {
    startingLives: 5,
    maxLives: 5,
    turnDurationSeconds: 0,
    maxWrongAnswersPerCategory: 1,
    maxTurnsPerCategory: 10
  });
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
