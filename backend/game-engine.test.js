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
