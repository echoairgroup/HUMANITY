'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const engine = require('./geography-engine');
const practiceEngine = require('./practice-engine');
const { createPartyServer } = require('./party-server');
const { createAdminController } = require('./admin');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
const SITE_URL = process.env.SITE_URL || 'https://echoairgroup.github.io/HUMANITY/';
const PUBLIC_API_URL = process.env.PUBLIC_API_URL || 'https://humanity-api-jyk5.onrender.com';
const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://echoairgroup.github.io,http://localhost:8000,http://127.0.0.1:8000')
    .split(',').map(value => value.trim()).filter(Boolean)
);
const DAILY_SECONDS = 25;
const SESSION_DAYS = 30;
const PLANET_AVATAR_STREAKS = Object.freeze({
  mercury: 0, venus: 3, earth: 7, mars: 14,
  jupiter: 30, saturn: 60, uranus: 90, neptune: 150
});

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

// Neon certificates are publicly trusted. Keep hostname and certificate checks
// enabled by default instead of relying on the legacy, weaker "require" mode.
const databaseConnection = new URL(DATABASE_URL);
databaseConnection.searchParams.set(
  'sslmode',
  process.env.DATABASE_SSL === 'false' ? 'disable' : 'verify-full'
);

const pool = new Pool({
  connectionString: databaseConnection.toString(),
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

function sendJSON(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message, code) {
  sendJSON(response, status, { ok: false, error: message, code: code || 'request_failed' });
}

async function readJSON(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32768) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON body.');
    return value;
  } catch (_) {
    throw new Error('Request body must be valid JSON.');
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function bearer(request) {
  const header = String(request.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function authenticateToken(token) {
  if (!token) return null;
  const result = await pool.query(
    'SELECT p.id, p.username, p.email, p.avatar_url, p.country_code, p.xp, p.level, p.daily_streak, p.best_streak, p.party_rating, p.party_streak_days, p.role, p.selected_avatar, p.avatar_locked, p.account_status ' +
    'FROM humanity_sessions s JOIN humanity_players p ON p.id = s.player_id ' +
    "WHERE s.token_hash = $1 AND s.expires_at > NOW() AND COALESCE(p.account_status, 'active') = 'active' LIMIT 1",
    [hashToken(token)]
  );
  return result.rows[0] || null;
}

async function optionalUser(request) {
  try { return await authenticateToken(bearer(request)); }
  catch (_) { return null; }
}

async function requireUser(request, response) {
  const user = await optionalUser(request);
  if (!user) {
    sendError(response, 401, 'Sign in to use this feature.', 'authentication_required');
    return null;
  }
  return user;
}

function roleFor(user) {
  if (!user) return 'member';
  const email = String(user.email || '').toLowerCase();
  if (email && ADMIN_EMAILS.has(email)) return 'owner';
  const role = String(user.role || 'member').toLowerCase();
  return role === 'admin' || role === 'moderator' ? role : 'member';
}

async function isAdmin(user) {
  return ['owner', 'admin', 'moderator'].includes(roleFor(user));
}

function publicUser(user, admin) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatar_url,
    selectedAvatar: user.selected_avatar || 'mercury',
    avatarLocked: Boolean(user.avatar_locked),
    role: roleFor(user),
    countryCode: user.country_code,
    xp: Number(user.xp || 0),
    level: Number(user.level || 1),
    dailyStreak: Number(user.daily_streak || 0),
    bestStreak: Number(user.best_streak || 0),
    partyRating: Number(user.party_rating || 1000),
    partyStreak: Number(user.party_streak_days || 0),
    isAdmin: Boolean(admin)
  };
}

async function createSession(playerId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query(
    'INSERT INTO humanity_sessions (token_hash, player_id, expires_at) VALUES ($1,$2,$3)',
    [hashToken(token), playerId, expiresAt.toISOString()]
  );
  return token;
}

async function getIdentity(request, body) {
  const user = await optionalUser(request);
  if (user) return { user, key: 'user:' + user.id, playerId: user.id, guestId: null };

  const guestId = String(body.guestId || request.headers['x-humanity-guest'] || '').trim();
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(guestId)) return null;
  return { user: null, key: 'guest:' + guestId, playerId: null, guestId };
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value);
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : text.slice(0, 10);
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function publicDailyQuestion(question, index) {
  return engine.publicQuestion(question, index);
}

function maximumDailyScore(payload) {
  const questions = Array.isArray(payload && payload.questions) ? payload.questions : [];
  return questions.reduce((total, question) => {
    const bestAnswer = (Array.isArray(question.answers) ? question.answers : []).reduce((best, entry) => {
      const rawRarity = Number(entry.rarity);
      const rarity = Number.isFinite(rawRarity)
        ? Math.max(0, Math.min(engine.POINTS_BY_LEVEL.length - 1, Math.floor(rawRarity)))
        : 0;
      return Math.max(best, engine.POINTS_BY_LEVEL[rarity] || 0);
    }, 0);
    return total + bestAnswer;
  }, 0);
}

async function loadApprovedAnswers(questionIds) {
  if (!questionIds.length) return [];
  const result = await pool.query(
    'SELECT question_id, answer_text, aliases, rarity, source_url FROM humanity_approved_answers WHERE question_id = ANY($1::text[])',
    [questionIds]
  );
  return result.rows;
}

async function buildChallenge(date) {
  const previousDate = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const previousEdition = await pool.query(
    'SELECT payload FROM humanity_daily_challenges WHERE challenge_date = $1 LIMIT 1',
    [previousDate]
  );
  const previousQuestionIds = (previousEdition.rows[0]?.payload?.questions || []).map(item => item.id);
  const generated = engine.generateDailyChallenge(date, previousQuestionIds);
  const approved = await loadApprovedAnswers(generated.questions.map(item => item.id));
  for (const extra of approved) {
    const question = generated.questions.find(item => item.id === extra.question_id);
    if (!question) continue;
    const nameKey = engine.normaliseAnswer(extra.answer_text);
    if (question.answers.some(item => engine.normaliseAnswer(item.name) === nameKey)) continue;
    question.answers.push({
      name: extra.answer_text,
      aliases: Array.isArray(extra.aliases) ? extra.aliases : [],
      rarity: Number(extra.rarity || 1),
      source: extra.source_url || 'HUMANITY approved answer'
    });
  }
  return generated;
}

async function ensureChallenge(date) {
  const id = 'atlas-' + date;
  const existing = await pool.query(
    'SELECT id, challenge_date, payload, finalised_at FROM humanity_daily_challenges WHERE challenge_date = $1 LIMIT 1',
    [date]
  );
  if (existing.rows[0]) return existing.rows[0];

  const payload = await buildChallenge(date);
  await pool.query(
    'INSERT INTO humanity_daily_challenges (id, challenge_date, payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (challenge_date) DO NOTHING',
    [id, date, JSON.stringify(payload)]
  );
  const result = await pool.query(
    'SELECT id, challenge_date, payload, finalised_at FROM humanity_daily_challenges WHERE challenge_date = $1 LIMIT 1',
    [date]
  );
  return result.rows[0];
}

async function finaliseChallenge(challengeRow) {
  if (!challengeRow || challengeRow.finalised_at) return;
  const payload = challengeRow.payload;
  const answers = await pool.query(
    'SELECT question_id, answer_key, COUNT(*)::int AS answer_count ' +
    'FROM humanity_daily_run_answers WHERE challenge_id = $1 AND is_correct = TRUE ' +
    'GROUP BY question_id, answer_key',
    [challengeRow.id]
  );
  const totals = await pool.query(
    'SELECT question_id, COUNT(*)::int AS total_count FROM humanity_daily_run_answers ' +
    'WHERE challenge_id = $1 AND is_correct = TRUE GROUP BY question_id',
    [challengeRow.id]
  );
  const countMap = new Map();
  for (const row of answers.rows) countMap.set(row.question_id + ':' + row.answer_key, row.answer_count);
  const totalMap = new Map(totals.rows.map(row => [row.question_id, row.total_count]));

  const submitted = await pool.query(
    'SELECT id, question_id, answer_key FROM humanity_daily_run_answers WHERE challenge_id = $1 AND is_correct = TRUE',
    [challengeRow.id]
  );

  for (const row of submitted.rows) {
    const question = payload.questions.find(item => item.id === row.question_id);
    const entry = question && question.answers.find(item => engine.normaliseAnswer(item.name) === row.answer_key);
    const same = countMap.get(row.question_id + ':' + row.answer_key) || 1;
    const total = totalMap.get(row.question_id) || 0;
    const points = engine.pointsForUsage(entry, same, total);
    await pool.query(
      'UPDATE humanity_daily_run_answers SET final_points = $2 WHERE id = $1',
      [row.id, points]
    );
  }

  await pool.query(
    'UPDATE humanity_daily_runs r SET final_score = COALESCE((SELECT SUM(a.final_points) FROM humanity_daily_run_answers a WHERE a.run_id = r.id),0) ' +
    'WHERE r.challenge_id = $1',
    [challengeRow.id]
  );
  await pool.query(
    'UPDATE humanity_daily_challenges SET finalised_at = NOW() WHERE id = $1 AND finalised_at IS NULL',
    [challengeRow.id]
  );
}

async function finaliseExpiredChallenges(today) {
  const result = await pool.query(
    'SELECT id, challenge_date, payload, finalised_at FROM humanity_daily_challenges WHERE challenge_date < $1 AND finalised_at IS NULL',
    [today]
  );
  for (const row of result.rows) {
    try { await finaliseChallenge(row); }
    catch (error) { console.error('Daily score finalisation failed for ' + row.challenge_date + ':', error.message); }
  }
}

async function currentChallenge() {
  const today = utcDate();
  await finaliseExpiredChallenges(today);
  return ensureChallenge(today);
}

function runQuestion(run, challenge) {
  const index = Number(run.current_question);
  if (index >= challenge.questions.length) return null;
  return challenge.questions[index];
}

async function ownedRun(runId, identity) {
  const result = await pool.query(
    'SELECT * FROM humanity_daily_runs WHERE id = $1 AND identity_key = $2 LIMIT 1',
    [runId, identity.key]
  );
  return result.rows[0] || null;
}

async function recordUnapproved(question, answerText) {
  const clean = String(answerText || '').trim().slice(0, 80);
  const key = engine.normaliseAnswer(clean);
  if (!key || key.length < 2) return;
  try {
    await pool.query(
      'INSERT INTO humanity_answer_review_queue (question_id, question_prompt, answer_text, answer_key) VALUES ($1,$2,$3,$4) ' +
      'ON CONFLICT (question_id, answer_key) DO UPDATE SET occurrences = humanity_answer_review_queue.occurrences + 1, updated_at = NOW()',
      [question.id, question.prompt, clean, key]
    );
  } catch (error) {
    console.warn('Could not record unapproved answer:', error.message);
  }
}

function answerReveal(question) {
  return question.answers
    .map(item => ({
      answer: item.name,
      level: engine.LEVEL_NAMES[item.rarity],
      rarity: item.rarity,
      points: engine.POINTS_BY_LEVEL[item.rarity],
      aliases: Array.isArray(item.aliases) ? item.aliases : []
    }))
    .sort((a, b) => b.points - a.points || a.answer.localeCompare(b.answer));
}

async function addApprovedAnswers(questions) {
  const approved = await loadApprovedAnswers([...new Set(questions.map(item => item.id))]);
  for (const extra of approved) {
    const question = questions.find(item => item.id === extra.question_id);
    if (!question) continue;
    const canonicalKey = engine.normaliseAnswer(extra.answer_text);
    const incomingAliases = Array.isArray(extra.aliases) ? extra.aliases : [];
    const incomingNames = [extra.answer_text].concat(incomingAliases);
    const incomingKeys = new Set(incomingNames.map(engine.normaliseAnswer).filter(Boolean));
    const matches = question.answers.filter(item =>
      [item.name].concat(item.aliases || []).some(name => incomingKeys.has(engine.normaliseAnswer(name)))
    );
    if (matches.length === 1) {
      const existing = matches[0];
      const merged = new Map((existing.aliases || []).map(alias => [engine.normaliseAnswer(alias), alias]));
      for (const name of incomingNames) {
        const key = engine.normaliseAnswer(name);
        if (key && key !== engine.normaliseAnswer(existing.name)) merged.set(key, String(name).slice(0, 80));
      }
      existing.aliases = [...merged.values()].slice(0, 100);
      if (extra.source_url) existing.source = extra.source_url;
    } else if (matches.length === 0 && canonicalKey) {
      question.answers.push({
        name: extra.answer_text,
        aliases: incomingAliases,
        rarity: Math.max(0, Math.min(5, Number(extra.rarity) || 0)),
        source: extra.source_url || 'HUMANITY approved answer'
      });
    }
  }
  return questions;
}

function publicPracticeQuestion(question,index) {
  return {
    id:question.id,index,category:question.category,prompt:question.prompt,
    note:question.note,type:question.type||'geography',visual:question.visual||null,
    answerCount:question.answers.length,seconds:0,
    hints:Array.isArray(question.hints)?question.hints:[]
  };
}

async function practiceStart(request,response) {
  const body=await readJSON(request);
  const identity=await getIdentity(request,body);
  if(!identity){sendError(response,400,'A guest ID or account is required.','identity_required');return;}
  const pack=practiceEngine.getPack(body.packId);
  if(!pack){sendError(response,400,'Choose a valid Practice Lab pack.','invalid_practice_pack');return;}
  const questions=await addApprovedAnswers(practiceEngine.createBatch(pack.id,crypto.randomUUID()));
  const runId=crypto.randomUUID();
  const payload={packId:pack.id,questions,recentTopicIds:questions.map(item=>item.topicId)};
  await pool.query(
    'INSERT INTO humanity_practice_runs (id,identity_key,player_id,pack_id,payload) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [runId,identity.key,identity.playerId,pack.id,JSON.stringify(payload)]
  );
  sendJSON(response,201,{ok:true,runId,pack:{id:pack.id,title:pack.title,icon:pack.icon},
    index:0,question:publicPracticeQuestion(questions[0],0)});
}

async function practiceGuess(request,response,skip) {
  const body=await readJSON(request);
  const identity=await getIdentity(request,body);
  if(!identity){sendError(response,400,'A guest ID or account is required.','identity_required');return;}
  const result=await pool.query(
    'SELECT * FROM humanity_practice_runs WHERE id=$1 AND identity_key=$2 LIMIT 1',
    [String(body.runId||''),identity.key]
  );
  const run=result.rows[0];
  if(!run||run.status!=='active'){sendError(response,404,'This practice session is no longer active.','practice_unavailable');return;}
  const played=Number(run.questions_played||0);
  const slot=Number(run.current_question||0);
  const question=(run.payload&&run.payload.questions||[])[slot];
  if(!question||Number(body.index)!==played){
    sendError(response,409,'That practice question is no longer active.','question_out_of_sync');return;
  }
  let match=null;
  if(!skip){
    match=await resolveApprovedMatch(question,body.answer);
    if(!match){
      await recordUnapproved(question,body.answer);
      sendJSON(response,200,{ok:true,accepted:false,
        message:'That answer is not approved yet. It has been sent for review; try another answer.'});
      return;
    }
  }
  const points=match?match.points:0;
  const history=Array.isArray(run.answers)?run.answers:[];
  const record={
    question:question.prompt,category:question.category,questionId:question.id,
    answer:match?match.name:null,accepted:Boolean(match),level:match?match.level:null,
    rarity:match?match.rarity:null,points,skipped:Boolean(skip)
  };
  const nextHistory=history.concat(record).slice(-500);
  const saved=await pool.query(
    'UPDATE humanity_practice_runs SET current_question=current_question+1,questions_played=questions_played+1,'+
    'score=score+$5,answers=$6::jsonb,updated_at=NOW() '+
    'WHERE id=$1 AND identity_key=$2 AND status=$7 AND current_question=$3 AND questions_played=$4 '+
    'RETURNING score,questions_played',
    [run.id,identity.key,slot,played,points,JSON.stringify(nextHistory),'active']
  );
  if(!saved.rowCount){sendError(response,409,'That practice question was already submitted.','answer_exists');return;}
  sendJSON(response,200,{
    ok:true,accepted:Boolean(match),skipped:Boolean(skip),answer:match?match.name:null,
    level:match?match.level:null,rarity:match?match.rarity:null,provisionalPoints:points,
    sameAnswerCount:1,score:Number(saved.rows[0].score||0),
    nextIndex:Number(saved.rows[0].questions_played||0),reveal:answerReveal(question)
  });
}

async function practiceNext(request,response) {
  const body=await readJSON(request);
  const identity=await getIdentity(request,body);
  if(!identity){sendError(response,400,'A guest ID or account is required.','identity_required');return;}
  const result=await pool.query(
    'SELECT * FROM humanity_practice_runs WHERE id=$1 AND identity_key=$2 LIMIT 1',
    [String(body.runId||''),identity.key]
  );
  const run=result.rows[0];
  if(!run||run.status!=='active'){sendError(response,404,'This practice session is no longer active.','practice_unavailable');return;}
  const played=Number(run.questions_played||0);
  if(Number(body.index)!==played){sendError(response,409,'Your practice progress is out of sync.','question_out_of_sync');return;}
  let payload=run.payload;
  let slot=Number(run.current_question||0);
  if(slot>=payload.questions.length){
    const recent=Array.isArray(payload.recentTopicIds)?payload.recentTopicIds.slice(-14):[];
    const batch=await addApprovedAnswers(practiceEngine.createBatch(run.pack_id,crypto.randomUUID(),recent));
    payload={...payload,questions:batch,recentTopicIds:recent.concat(batch.map(item=>item.topicId)).slice(-14)};
    const updated=await pool.query(
      'UPDATE humanity_practice_runs SET payload=$2::jsonb,current_question=0,updated_at=NOW() '+
      'WHERE id=$1 AND identity_key=$3 AND status=$4 AND current_question=$5 AND questions_played=$6',
      [run.id,JSON.stringify(payload),identity.key,'active',slot,played]
    );
    if(!updated.rowCount){sendError(response,409,'Your practice round has already advanced.','question_out_of_sync');return;}
    slot=0;
  }
  sendJSON(response,200,{ok:true,index:played,question:publicPracticeQuestion(payload.questions[slot],played)});
}

async function practiceFinish(request,response) {
  const body=await readJSON(request);
  const identity=await getIdentity(request,body);
  if(!identity){sendError(response,400,'A guest ID or account is required.','identity_required');return;}
  const result=await pool.query(
    'UPDATE humanity_practice_runs SET status=$3,finished_at=NOW(),updated_at=NOW() '+
    'WHERE id=$1 AND identity_key=$2 AND status=$4 RETURNING score,questions_played,pack_id',
    [String(body.runId||''),identity.key,'completed','active']
  );
  if(!result.rowCount){sendError(response,404,'This practice session has already ended or could not be found.','practice_unavailable');return;}
  const row=result.rows[0],pack=practiceEngine.getPack(row.pack_id);
  const score=Number(row.score||0),questionsPlayed=Number(row.questions_played||0);
  const xpEarned=identity.playerId?Math.min(80,Math.floor(score/20)):0;
  if(identity.playerId&&xpEarned){
    await pool.query(
      'UPDATE humanity_players SET xp=xp+$2,level=GREATEST(1,FLOOR((xp+$2)/500.0)+1),updated_at=NOW() WHERE id=$1',
      [identity.playerId,xpEarned]
    );
  }
  sendJSON(response,200,{
    ok:true,score,questionsPlayed,xpEarned,
    pack:pack?{id:pack.id,title:pack.title}:{id:row.pack_id,title:'Practice Lab'}
  });
}

async function updateDailyStreak(userId, date) {
  const result = await pool.query(
    'SELECT last_daily_date, daily_streak, best_streak FROM humanity_players WHERE id = $1 FOR UPDATE',
    [userId]
  );
  const row = result.rows[0];
  if (!row) return;
  const previous = row.last_daily_date ? new Date(row.last_daily_date).toISOString().slice(0, 10) : null;
  if (previous === date) return;
  const yesterday = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const nextStreak = previous === yesterday ? Number(row.daily_streak || 0) + 1 : 1;
  await pool.query(
    'UPDATE humanity_players SET daily_streak = $2, best_streak = GREATEST(best_streak,$2), last_daily_date = $3, xp = xp + 35, level = GREATEST(1,FLOOR((xp + 35)/500.0)+1), updated_at = NOW() WHERE id = $1',
    [userId, nextStreak, date]
  );
}

const WIKIDATA_VERIFICATION_CACHE = new Map();

async function maybeVerifyWithWikidata(question, answerText) {
  const expected = {
    'europe-countries': ['country in europe', 'european country'],
    'africa-countries': ['country in africa', 'african country'],
    'asia-countries': ['country in asia', 'asian country'],
    'south-america-countries': ['country in south america', 'south american country'],
    'north-america-countries': ['country in north america', 'north american country'],
    'oceania-countries': ['country in oceania', 'oceanian country'],
    'world-rivers': ['river'],
    mountains: ['mountain', 'volcano', 'peak', 'mountain range'],
    islands: ['island'],
    lakes: ['lake'],
    seas: ['sea', 'ocean'],
    deserts: ['desert'],
    'capital-cities': ['capital'],
    'major-cities': ['city', 'town'],
    'landlocked-capitals': ['capital'],
    'world-landmarks': ['landmark', 'monument', 'tower', 'bridge', 'heritage site', 'statue'],
    'world-heritage-sites': ['world heritage site', 'unesco world heritage site'],
    'national-parks': ['national park'],
    languages: ['language'],
    'popular-dishes': ['dish', 'cuisine', 'traditional food'],
    'popular-snacks': ['snack', 'food'],
    'olympic-sports': ['sport']
  }[question.id];
  if (!expected) return null;

  const cleanAnswer = String(answerText || '').trim().slice(0, 80);
  const answerKey = engine.normaliseAnswer(cleanAnswer);
  if (!answerKey || answerKey.length < 2) return null;

  const cacheKey = question.id + ':' + answerKey;
  if (WIKIDATA_VERIFICATION_CACHE.has(cacheKey)) {
    return WIKIDATA_VERIFICATION_CACHE.get(cacheKey);
  }

  const verification = (async () => {
    try {
      const params = new URLSearchParams({
        action: 'wbsearchentities',
        search: cleanAnswer,
        language: 'en',
        format: 'json',
        limit: '5'
      });
      const response = await fetch('https://www.wikidata.org/w/api.php?' + params.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'HUMANITY-Geography-Engine/1.0 (contact: support@humanity.example)'
        },
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) return null;

      const payload = await response.json();
      const candidate = (payload.search || []).find(item => {
        const matchedText = item.match && item.match.text ? item.match.text : '';
        const exactAlias = engine.normaliseAnswer(item.label) === answerKey ||
          engine.normaliseAnswer(matchedText) === answerKey;
        return exactAlias &&
          expected.some(term => String(item.description || '').toLowerCase().includes(term));
      });
      if (!candidate) return null;

      const aliases = new Map();
      const addAlias = value => {
        const alias = String(value || '').trim().slice(0, 80);
        const normal = engine.normaliseAnswer(alias);
        if (normal && normal !== engine.normaliseAnswer(candidate.label)) aliases.set(normal, alias);
      };
      addAlias(cleanAnswer);
      addAlias(candidate.match && candidate.match.text);

      // Search can find a local/alternate name. Expand that entity's official
      // labels and aliases across languages so later players get the same match.
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
        // The exact typed entity match remains usable if alias expansion times out.
      }

      const key = engine.normaliseAnswer(candidate.label);
      const approvedAliases = [...aliases.values()].slice(0, 100);
      await pool.query(
        'INSERT INTO humanity_approved_answers (question_id, answer_key, answer_text, aliases, rarity, source_url, approved_by) ' +
        'VALUES ($1,$2,$3,$4::jsonb,2,$5,$6) ON CONFLICT (question_id, answer_key) DO UPDATE SET ' +
        'aliases = EXCLUDED.aliases, source_url = EXCLUDED.source_url, approved_by = EXCLUDED.approved_by',
        [question.id, key, candidate.label, JSON.stringify(approvedAliases), candidate.concepturi || null, 'automatic Wikidata type match']
      );
      await pool.query(
        'UPDATE humanity_answer_review_queue SET status = $2, confidence = $3, source_url = $4, reviewer_note = $5, updated_at = NOW() ' +
        'WHERE question_id = $1 AND answer_key = $6 AND status = $7',
        [
          question.id, 'auto_approved', 0.96, candidate.concepturi || null,
          'Exact entity label and expected geography type verified in Wikidata.',
          answerKey, 'pending'
        ]
      );
      return {
        name: candidate.label,
        aliases: approvedAliases,
        rarity: 2,
        source: candidate.concepturi || 'Wikidata exact-label/alias and expected entity-type verification'
      };
    } catch (error) {
      console.warn('Wikidata verification skipped:', error.message);
      return null;
    }
  })();

  WIKIDATA_VERIFICATION_CACHE.set(cacheKey, verification);
  const result = await verification;
  if (!result) WIKIDATA_VERIFICATION_CACHE.delete(cacheKey);
  return result;
}

async function resolveApprovedMatch(question, answerText) {
  await addApprovedAnswers([question]);
  let match = engine.matchAnswer(question, answerText);
  if (match) return match;

  const verified = await maybeVerifyWithWikidata(question, answerText);
  if (verified) {
    await addApprovedAnswers([question]);
    match = engine.matchAnswer(question, answerText);
  }
  return match;
}
function sessionCookieToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function createOAuthState(provider, redirectUri) {
  const payload = Buffer.from(JSON.stringify({
    provider, redirectUri, issuedAt: Date.now(),
    nonce: crypto.randomBytes(18).toString('base64url')
  })).toString('base64url');
  const secret = process.env.OAUTH_STATE_SECRET || DATABASE_URL;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function verifyOAuthState(value, provider) {
  const parts = String(value || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const secret = process.env.OAUTH_STATE_SECRET || DATABASE_URL;
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const state = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const age = Date.now() - Number(state.issuedAt);
    if (state.provider !== provider || !state.redirectUri || !state.nonce ||
        !Number.isFinite(age) || age < 0 || age > 600000) return null;
    return state;
  } catch (_) { return null; }
}

async function handleRegister(request, response) {
  const body = await readJSON(request);
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[\p{L}\p{N}_-]{3,18}$/u.test(username)) {
    sendError(response, 400, 'Username must be 3–18 letters, numbers, underscores or hyphens.', 'invalid_username');
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError(response, 400, 'Enter a valid email address.', 'invalid_email');
    return;
  }
  if (password.length < 10 || password.length > 128) {
    sendError(response, 400, 'Password must be between 10 and 128 characters.', 'invalid_password');
    return;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 64);
  const id = crypto.randomUUID();
  try {
    const result = await pool.query(
      'INSERT INTO humanity_players (id, username, email, password_salt, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, email, avatar_url, country_code, xp, level, daily_streak, best_streak, party_rating, party_streak_days, role, selected_avatar, avatar_locked, account_status',
      [id, username, email || null, salt, Buffer.from(digest).toString('hex')]
    );
    const token = await createSession(id);
    sendJSON(response, 201, { ok: true, token, player: publicUser(result.rows[0], false) });
  } catch (error) {
    if (error.code === '23505') sendError(response, 409, 'That username or email is already in use.', 'account_exists');
    else throw error;
  }
}

async function handleLogin(request, response) {
  const body = await readJSON(request);
  const identifier = String(body.identifier || '').trim();
  const password = String(body.password || '');
  if (!identifier || !password) {
    sendError(response, 400, 'Enter your username or email and password.', 'missing_credentials');
    return;
  }
  const result = await pool.query(
    'SELECT id, username, email, password_salt, password_hash, avatar_url, country_code, xp, level, daily_streak, best_streak, party_rating, party_streak_days, role, selected_avatar, avatar_locked, account_status ' +
    'FROM humanity_players WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
    [identifier]
  );
  const player = result.rows[0];
  if (!player || !player.password_hash || !player.password_salt) {
    sendError(response, 401, 'Those sign-in details were not recognised.', 'invalid_credentials');
    return;
  }
  const digest = await scrypt(password, player.password_salt, 64);
  const expected = Buffer.from(player.password_hash, 'hex');
  if (expected.length !== digest.length || !crypto.timingSafeEqual(expected, digest)) {
    sendError(response, 401, 'Those sign-in details were not recognised.', 'invalid_credentials');
    return;
  }
  if (player.account_status !== 'active') {
    sendError(response, 403, 'This HUMANITY account is currently suspended. Contact the site administrator for help.', 'account_suspended');
    return;
  }
  const token = await createSession(player.id);
  sendJSON(response, 200, { ok: true, token, player: publicUser(player, await isAdmin(player)) });
}

async function beginOAuth(provider, response) {
  const google = provider === 'google';
  const clientId = google ? process.env.GOOGLE_CLIENT_ID : process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    sendError(response, 503, provider + ' sign-in is not configured yet. Add its OAuth credentials to the Render service.', 'oauth_not_configured');
    return;
  }
  const redirectUri = process.env[google ? 'GOOGLE_REDIRECT_URI' : 'DISCORD_REDIRECT_URI'] ||
    PUBLIC_API_URL + '/api/auth/' + provider + '/callback';
  const state = createOAuthState(provider, redirectUri);
  const target = google
    ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
    : new URL('https://discord.com/oauth2/authorize');
  target.searchParams.set('client_id', clientId);
  target.searchParams.set('redirect_uri', redirectUri);
  target.searchParams.set('response_type', 'code');
  target.searchParams.set('scope', google ? 'openid email profile' : 'identify email');
  target.searchParams.set('state', state);
  if (google) target.searchParams.set('prompt', 'select_account');
  response.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' });
  response.end();
}

async function upsertOAuthPlayer(provider, profile) {
  const isGoogle = provider === 'google';
  const providerId = String(isGoogle ? profile.sub : profile.id);
  const emailIsVerified = isGoogle ? profile.email_verified === true : profile.verified === true;
  const email = emailIsVerified ? (String(profile.email || '').toLowerCase() || null) : null;
  const avatar = isGoogle ? (profile.picture || null) :
    (profile.avatar ? 'https://cdn.discordapp.com/avatars/' + profile.id + '/' + profile.avatar + '.png' : null);
  const providerColumn = isGoogle ? 'google_sub' : 'discord_id';

  let found = await pool.query(
    'SELECT id, username, email, avatar_url, country_code, xp, level, daily_streak, best_streak, party_rating, party_streak_days, role, selected_avatar, avatar_locked, account_status FROM humanity_players WHERE ' +
    providerColumn + ' = $1 OR ($2::text IS NOT NULL AND email = $2) LIMIT 1',
    [providerId, email]
  );
  if (found.rows[0]) {
    await pool.query(
      'UPDATE humanity_players SET ' + providerColumn + ' = $2, avatar_url = COALESCE($3,avatar_url), email = COALESCE(email,$4), updated_at = NOW() WHERE id = $1',
      [found.rows[0].id, providerId, avatar, email]
    );
    return found.rows[0];
  }

  const base = String(profile.name || profile.global_name || profile.username || (email ? email.split('@')[0] : provider + ' explorer'))
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14) || 'Explorer';
  let username = base;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const exists = await pool.query('SELECT 1 FROM humanity_players WHERE LOWER(username)=LOWER($1)', [username]);
    if (!exists.rowCount) break;
    username = base.slice(0, 12) + '_' + crypto.randomInt(10, 99);
  }
  const id = crypto.randomUUID();
  const columns = isGoogle ? 'google_sub' : 'discord_id';
  const result = await pool.query(
    'INSERT INTO humanity_players (id, username, email, avatar_url, ' + columns + ') VALUES ($1,$2,$3,$4,$5) ' +
    'RETURNING id, username, email, avatar_url, country_code, xp, level, daily_streak, best_streak, party_rating, party_streak_days, role, selected_avatar, avatar_locked, account_status',
    [id, username, email, avatar, providerId]
  );
  return result.rows[0];
}

async function finishOAuth(provider, request, response, url) {
  const state = verifyOAuthState(url.searchParams.get('state'), provider);
  const code = url.searchParams.get('code');
  if (!state || !code) {
    sendError(response, 400, 'The sign-in session expired. Start sign-in again.', 'invalid_oauth_state');
    return;
  }

  const google = provider === 'google';
  const tokenUrl = google ? 'https://oauth2.googleapis.com/token' : 'https://discord.com/api/oauth2/token';
  const clientId = process.env[google ? 'GOOGLE_CLIENT_ID' : 'DISCORD_CLIENT_ID'];
  const clientSecret = process.env[google ? 'GOOGLE_CLIENT_SECRET' : 'DISCORD_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    sendError(response, 503, provider + ' sign-in is not configured yet.', 'oauth_not_configured');
    return;
  }
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: state.redirectUri
  });
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form
  });
  if (!tokenResponse.ok) throw new Error(provider + ' token exchange failed.');
  const tokenData = await tokenResponse.json();
  const profileResponse = await fetch(
    google ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://discord.com/api/users/@me',
    { headers: { Authorization: 'Bearer ' + tokenData.access_token, Accept: 'application/json' } }
  );
  if (!profileResponse.ok) throw new Error(provider + ' profile request failed.');
  const profile = await profileResponse.json();
  const player = await upsertOAuthPlayer(provider, profile);
  if (player.account_status !== 'active') {
    sendError(response, 403, 'This HUMANITY account is currently suspended. Contact the site administrator for help.', 'account_suspended');
    return;
  }
  const token = await createSession(player.id);
  response.writeHead(302, { Location: SITE_URL + (SITE_URL.includes('?') ? '&' : '?') + 'session=' + encodeURIComponent(token), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  response.end();
}

async function dailyStart(request, response) {
  const body = await readJSON(request);
  const identity = await getIdentity(request, body);
  if (!identity) {
    sendError(response, 400, 'A guest ID or account is required to start your daily attempt.', 'identity_required');
    return;
  }
  const challenge = await currentChallenge();
  const existing = await pool.query(
    'SELECT id, status, current_question, provisional_score, final_score FROM humanity_daily_runs WHERE challenge_id = $1 AND identity_key = $2 LIMIT 1',
    [challenge.id, identity.key]
  );
  if (existing.rows[0]) {
    sendJSON(response, 409, {
      ok: false,
      alreadyPlayed: true,
      error: 'Your official Atlas Daily attempt for today has already started.',
      run: existing.rows[0]
    });
    return;
  }
  const runId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO humanity_daily_runs (id, challenge_id, identity_key, player_id, guest_id) VALUES ($1,$2,$3,$4,$5)',
    [runId, challenge.id, identity.key, identity.playerId, identity.guestId]
  );
  const question = challenge.payload.questions[0];
  sendJSON(response, 201, {
    ok: true,
    runId,
    date: utcDate(),
    index: 0,
    question: publicDailyQuestion(question, 0),
    maxPossibleScore: maximumDailyScore(challenge.payload),
    seconds: DAILY_SECONDS
  });
}

async function dailyGuess(request, response, skip) {
  const body = await readJSON(request);
  const identity = await getIdentity(request, body);
  if (!identity) {
    sendError(response, 400, 'A guest ID or account is required.', 'identity_required');
    return;
  }
  const run = await ownedRun(String(body.runId || ''), identity);
  if (!run || run.status !== 'in_progress') {
    sendError(response, 404, 'This Daily attempt is no longer active.', 'run_unavailable');
    return;
  }
  const challengeResult = await pool.query(
    'SELECT payload, challenge_date FROM humanity_daily_challenges WHERE id = $1 LIMIT 1',
    [run.challenge_id]
  );
  const challenge = challengeResult.rows[0];
  if (!challenge) {
    sendError(response, 404, 'The Daily Challenge could not be found.', 'challenge_missing');
    return;
  }
  const question = runQuestion(run, challenge.payload);
  const index = Number(run.current_question);
  if (!question || Number(body.index) !== index) {
    sendError(response, 409, 'That question is no longer active.', 'question_out_of_sync');
    return;
  }

  const elapsed = Date.now() - new Date(run.question_started_at).getTime();
  if (!skip && elapsed > DAILY_SECONDS * 1000 + 1500) {
    skip = true;
  }
  if (!skip) {
    const match = await resolveApprovedMatch(question, body.answer);
    if (!match) {
      await recordUnapproved(question, body.answer);
      sendJSON(response, 200, {
        ok: true,
        accepted: false,
        message: 'Not in the approved answer set. Try another answer while the timer is running.'
      });
      return;
    }
    const inserted = await pool.query(
      'INSERT INTO humanity_daily_run_answers (run_id, challenge_id, identity_key, question_id, question_slot, answer_key, answer_text, is_correct, provisional_points) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8) ON CONFLICT (run_id, question_slot) DO NOTHING RETURNING id',
      [run.id, run.challenge_id, identity.key, question.id, index, match.key, match.name, match.points]
    );
    if (!inserted.rowCount) {
      sendError(response, 409, 'This question has already been completed.', 'answer_exists');
      return;
    }
    const nextIndex = index + 1;
    const complete = nextIndex >= challenge.payload.questions.length;
    await pool.query(
      'UPDATE humanity_daily_runs SET current_question = $2, provisional_score = provisional_score + $3, status = $4, completed_at = CASE WHEN $4 = $5 THEN NOW() ELSE completed_at END WHERE id = $1',
      [run.id, nextIndex, match.points, complete ? 'completed' : 'in_progress', 'completed']
    );
    if (complete && identity.playerId) await updateDailyStreak(identity.playerId, isoDate(challenge.challenge_date));
    const usage = await pool.query(
      'SELECT COUNT(*)::int AS count FROM humanity_daily_run_answers WHERE challenge_id = $1 AND question_id = $2 AND answer_key = $3 AND is_correct = TRUE',
      [run.challenge_id, question.id, match.key]
    );
    sendJSON(response, 200, {
      ok: true,
      accepted: true,
      answer: match.name,
      level: match.level,
      rarity: match.rarity,
      provisionalPoints: match.points,
      sameAnswerCount: usage.rows[0].count,
      completed: complete,
      nextIndex,
      nextQuestion: complete ? null : publicDailyQuestion(challenge.payload.questions[nextIndex], nextIndex),
      reveal: answerReveal(question)
    });
    return;
  }

  await pool.query(
    'INSERT INTO humanity_daily_run_answers (run_id, challenge_id, identity_key, question_id, question_slot, answer_key, answer_text, is_correct, provisional_points) ' +
    'VALUES ($1,$2,$3,$4,$5,NULL,NULL,FALSE,0) ON CONFLICT (run_id, question_slot) DO NOTHING',
    [run.id, run.challenge_id, identity.key, question.id, index]
  );
  const nextIndex = index + 1;
  const complete = nextIndex >= challenge.payload.questions.length;
  await pool.query(
    'UPDATE humanity_daily_runs SET current_question = $2, status = $3, completed_at = CASE WHEN $3 = $4 THEN NOW() ELSE completed_at END WHERE id = $1',
    [run.id, nextIndex, complete ? 'completed' : 'in_progress', 'completed']
  );
  if (complete && identity.playerId) await updateDailyStreak(identity.playerId, isoDate(challenge.challenge_date));
  sendJSON(response, 200, {
    ok: true,
    accepted: false,
    skipped: true,
    completed: complete,
    nextIndex,
    nextQuestion: complete ? null : publicDailyQuestion(challenge.payload.questions[nextIndex], nextIndex),
    reveal: answerReveal(question)
  });
}


function suggestionEditDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[a.length][b.length];
}

function findDailyAnswerSuggestion(question, rawAnswer) {
  const target = engine.normaliseAnswer(rawAnswer);
  if (!target || target.length < 4 || engine.matchAnswer(question, rawAnswer)) return null;
  const threshold = target.length >= 8 ? 2 : 1;
  const matches = [];
  for (const entry of question.answers || []) {
    const names = [entry.name].concat(entry.aliases || []);
    let best = Infinity;
    for (const name of names) {
      const candidate = engine.normaliseAnswer(name);
      if (candidate === target) return null;
      const prefix = target.length >= 4 && candidate.length > target.length && candidate.startsWith(target);
      const distance = prefix ? 0 : suggestionEditDistance(target, candidate);
      best = Math.min(best, distance);
    }
    if (best <= threshold) matches.push({ answer: entry.name, distance: best });
  }
  if (!matches.length) return null;
  const minimum = Math.min(...matches.map(item => item.distance));
  const winners = [...new Map(
    matches.filter(item => item.distance === minimum).map(item => [engine.normaliseAnswer(item.answer), item])
  ).values()];
  return winners.length === 1 ? winners[0].answer : null;
}

async function dailySuggest(request, response) {
  const body = await readJSON(request);
  const identity = await getIdentity(request, body);
  if (!identity) {
    sendError(response, 400, 'A guest ID or account is required.', 'identity_required');
    return;
  }
  const run = await ownedRun(String(body.runId || ''), identity);
  if (!run || run.status !== 'in_progress') {
    sendError(response, 404, 'This Daily attempt is no longer active.', 'run_unavailable');
    return;
  }
  const result = await pool.query(
    'SELECT payload FROM humanity_daily_challenges WHERE id = $1 LIMIT 1',
    [run.challenge_id]
  );
  const question = result.rows[0] ? runQuestion(run, result.rows[0].payload) : null;
  if (!question || Number(body.index) !== Number(run.current_question)) {
    sendJSON(response, 200, { ok: true, suggestion: null });
    return;
  }
  const answer = findDailyAnswerSuggestion(question, body.answer);
  sendJSON(response, 200, { ok: true, suggestion: answer ? { answer } : null });
}

async function dailyHint(request, response) {
  const body = await readJSON(request);
  const identity = await getIdentity(request, body);
  if (!identity) {
    sendError(response, 400, 'A guest ID or account is required.', 'identity_required');
    return;
  }
  const run = await ownedRun(String(body.runId || ''), identity);
  if (!run || run.status !== 'in_progress') {
    sendError(response, 404, 'This Daily attempt is no longer active.', 'run_unavailable');
    return;
  }
  if (run.hint_used) {
    sendError(response, 409, 'Your one hint has already been used.', 'hint_used');
    return;
  }
  const result = await pool.query('SELECT payload FROM humanity_daily_challenges WHERE id = $1', [run.challenge_id]);
  const question = runQuestion(run, result.rows[0].payload);
  await pool.query('UPDATE humanity_daily_runs SET hint_used = TRUE WHERE id = $1', [run.id]);
  sendJSON(response, 200, { ok: true, examples: question.hints || [] });
}

async function dailyArchive(response) {
  const result = await pool.query(
    'SELECT challenge_date, finalised_at FROM humanity_daily_challenges WHERE challenge_date < $1 ORDER BY challenge_date DESC LIMIT 60',
    [utcDate()]
  );
  sendJSON(response, 200, {
    ok: true,
    entries: result.rows.map(row => ({
      date: isoDate(row.challenge_date),
      finalised: Boolean(row.finalised_at)
    }))
  });
}

async function dailyLeaderboard(response, date) {
  const day = date || utcDate();
  const result = await pool.query(
    'SELECT ROW_NUMBER() OVER (ORDER BY COALESCE(r.final_score,r.provisional_score) DESC, r.completed_at ASC NULLS LAST) AS rank, ' +
    'p.username AS username, ' +
    'COALESCE(r.final_score,r.provisional_score) AS score, r.status, r.completed_at, r.player_id ' +
    'FROM humanity_daily_runs r JOIN humanity_daily_challenges c ON c.id = r.challenge_id ' +
    'JOIN humanity_players p ON p.id = r.player_id WHERE c.challenge_date = $1 AND r.status = $2 ' +
    'ORDER BY score DESC, r.completed_at ASC NULLS LAST LIMIT 50',
    [day, 'completed']
  );
  sendJSON(response, 200, { ok: true, date: day, entries: result.rows });
}

async function dailyFlightDistribution(response, date) {
  const day = date || utcDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    sendError(response, 400, 'A valid UTC edition date is required.', 'invalid_date');
    return;
  }
  const [result, challengeResult] = await Promise.all([
    pool.query(
      'SELECT COALESCE(r.final_score, r.provisional_score, 0)::int AS score ' +
      'FROM humanity_daily_runs r ' +
      'JOIN humanity_daily_challenges c ON c.id = r.challenge_id ' +
      'WHERE c.challenge_date = $1 AND r.status = $2',
      [day, 'completed']
    ),
    pool.query('SELECT payload FROM humanity_daily_challenges WHERE challenge_date = $1 LIMIT 1', [day])
  ]);
  const scores = result.rows.map(row => Math.max(0, Math.min(700, Number(row.score) || 0)));
  const theoreticalMaximum = maximumDailyScore(challengeResult.rows[0] && challengeResult.rows[0].payload);
  const observedMaximum = scores.length ? Math.max(...scores) : 0;
  const maxScore = Math.max(1, theoreticalMaximum, observedMaximum);
  const bucketCount = Math.max(1, Math.ceil(maxScore / 100));
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const min = index * 100;
    const max = index === bucketCount - 1 ? maxScore : min + 99;
    return { min, max, label: min === max ? String(min) : min + '–' + max, count: 0 };
  });
  scores.forEach(score => {
    const index = Math.min(buckets.length - 1, Math.floor(score / 100));
    buckets[index].count += 1;
  });
  const total = scores.reduce((sum, score) => sum + score, 0);
  const averageScore = scores.length ? Math.round((total / scores.length) * 10) / 10 : null;
  const maximumCount = buckets.reduce((maximum, bucket) => Math.max(maximum, bucket.count), 0);
  const tiedBuckets = buckets.filter(bucket => bucket.count === maximumCount && maximumCount > 0);
  const mostCommon = tiedBuckets.length
    ? tiedBuckets.sort((a, b) => {
        const midpointA = (a.min + a.max) / 2;
        const midpointB = (b.min + b.max) / 2;
        return Math.abs(midpointA - (averageScore || 0)) - Math.abs(midpointB - (averageScore || 0));
      })[0]
    : null;
  sendJSON(response, 200, {
    ok: true,
    date: day,
    participants: scores.length,
    averageScore,
    maxScore,
    mostCommon: mostCommon ? {
      min: mostCommon.min, max: mostCommon.max, label: mostCommon.label, count: mostCommon.count
    } : null,
    buckets
  });
}


const handleAdmin = createAdminController({
  pool, sendJSON, sendError, readJSON, isAdmin, roleFor, engine,
  adminEmails: ADMIN_EMAILS
});

async function handleAPI(request, response, url, party) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/config') {
    sendJSON(response, 200, {
      ok: true,
      auth: {
        google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)
      }
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const db = await pool.query('SELECT 1 AS connected');
    sendJSON(response, 200, {
      ok: true,
      service: 'HUMANITY Geography API',
      database: Boolean(db.rows[0].connected),
      uptimeSeconds: Math.floor(process.uptime()),
      currentDateUTC: utcDate(),
      activeRooms: party.getActiveRooms()
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/practice/packs') {
    sendJSON(response,200,{ok:true,packs:practiceEngine.listPacks()});return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/practice/start') {
    await practiceStart(request,response);return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/practice/answer') {
    await practiceGuess(request,response,false);return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/practice/skip') {
    await practiceGuess(request,response,true);return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/practice/next') {
    await practiceNext(request,response);return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/practice/finish') {
    await practiceFinish(request,response);return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    await handleRegister(request, response);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    await handleLogin(request, response);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = bearer(request);
    if (token) await pool.query('DELETE FROM humanity_sessions WHERE token_hash = $1', [hashToken(token)]);
    sendJSON(response, 200, { ok: true });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = await optionalUser(request);
    if (!user) {
      sendError(response, 401, 'You are signed out.', 'not_signed_in');
      return true;
    }
    sendJSON(response, 200, { ok: true, player: publicUser(user, await isAdmin(user)) });
    return true;
  }
  const oauth = url.pathname.match(/^\/api\/auth\/(google|discord)(?:\/callback)?$/);
  if (oauth && request.method === 'GET') {
    const provider = oauth[1];
    if (url.pathname.endsWith('/callback')) await finishOAuth(provider, request, response, url);
    else await beginOAuth(provider, response);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/daily/current') {
    const challenge = await currentChallenge();
    const identity = await getIdentity(request, {});
    let played = null;
    if (identity) {
      const previous = await pool.query(
        'SELECT status, provisional_score, final_score, completed_at FROM humanity_daily_runs WHERE challenge_id = $1 AND identity_key = $2 LIMIT 1',
        [challenge.id, identity.key]
      );
      played = previous.rows[0] || null;
    }
    sendJSON(response, 200, {
      ok: true,
      date: isoDate(challenge.challenge_date),
      finalised: Boolean(challenge.finalised_at),
      questionCount: challenge.payload.questions.length,
      questions: challenge.payload.questions.map(publicDailyQuestion),
      played
    });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/daily/start') {
    await dailyStart(request, response);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/daily/answer') {
    await dailyGuess(request, response, false);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/daily/skip') {
    await dailyGuess(request, response, true);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/daily/next') {
    const body = await readJSON(request);
    const identity = await getIdentity(request, body);
    if (!identity) {
      sendError(response, 400, 'A guest ID or account is required.', 'identity_required');
      return true;
    }
    const run = await ownedRun(String(body.runId || ''), identity);
    if (!run || run.status !== 'in_progress') {
      sendError(response, 404, 'This Daily attempt is no longer active.', 'run_unavailable');
      return true;
    }
    const result = await pool.query('SELECT payload FROM humanity_daily_challenges WHERE id = $1 LIMIT 1', [run.challenge_id]);
    const question = runQuestion(run, result.rows[0] && result.rows[0].payload);
    if (!question || Number(body.index) !== Number(run.current_question)) {
      sendError(response, 409, 'That question is no longer active.', 'question_out_of_sync');
      return true;
    }
    await pool.query('UPDATE humanity_daily_runs SET question_started_at = NOW() WHERE id = $1', [run.id]);
    sendJSON(response, 200, {
      ok: true,
      index: Number(run.current_question),
      question: publicDailyQuestion(question, Number(run.current_question)),
      seconds: DAILY_SECONDS
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/daily/suggest') {
    await dailySuggest(request, response);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/daily/hint') {
    await dailyHint(request, response);
    return true;
  }
  const archiveDate = url.pathname.match(/^\/api\/daily\/archive\/(\d{4}-\d{2}-\d{2})$/);
  if (request.method === 'GET' && archiveDate) {
    const date = archiveDate[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= utcDate()) {
      sendError(response, 400, 'Only completed Daily editions can be replayed.', 'archive_date_invalid');
      return true;
    }
    const found = await pool.query(
      'SELECT payload, finalised_at FROM humanity_daily_challenges WHERE challenge_date = $1 LIMIT 1',
      [date]
    );
    if (!found.rows[0]) {
      sendError(response, 404, 'That Daily edition is not in the archive.', 'archive_missing');
      return true;
    }
    const payload = found.rows[0].payload;
    sendJSON(response, 200, {
      ok: true,
      date,
      finalised: Boolean(found.rows[0].finalised_at),
      questions: payload.questions.map((question, index) => ({
        ...publicDailyQuestion(question, index),
        answers: answerReveal(question).map(item => ({
          answer: item.answer,
          aliases: (question.answers.find(entry => entry.name === item.answer) || {}).aliases || [],
          level: item.level,
          rarity: item.rarity,
          points: item.points
        }))
      }))
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/daily/archive') {
    await dailyArchive(response);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/daily/leaderboard') {
    await dailyLeaderboard(response, url.searchParams.get('date'));
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/daily/flight-distribution') {
    await dailyFlightDistribution(response, url.searchParams.get('date'));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/party/online') {
    const stats = party.getLiveStats();
    sendJSON(response, 200, { ok: true, players: stats.players, rooms: stats.rooms });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/party/rooms') {
    sendJSON(response, 200, { ok: true, rooms: party.listRooms() });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/leaderboards/party') {
    const result = await pool.query(
      'SELECT ROW_NUMBER() OVER (ORDER BY SUM(mp.score) DESC) AS rank, p.username, p.party_rating AS rating, COUNT(*)::int AS games, SUM(mp.score)::int AS score ' +
      'FROM humanity_party_match_players mp JOIN humanity_players p ON p.id = mp.player_id ' +
      'GROUP BY p.id ORDER BY score DESC LIMIT 50'
    );
    sendJSON(response, 200, { ok: true, entries: result.rows });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/leaderboards/global') {
    const period = url.searchParams.get('period') || 'daily';
    const identity = await optionalUser(request);
    const dateClause = period === 'weekly' ? "c.challenge_date >= CURRENT_DATE - INTERVAL '6 days'"
      : period === 'monthly' ? "c.challenge_date >= CURRENT_DATE - INTERVAL '29 days'"
      : period === 'daily' ? 'c.challenge_date = CURRENT_DATE'
      : 'TRUE';

    if (period === 'country') {
      const result = await pool.query(
        'SELECT ROW_NUMBER() OVER (ORDER BY SUM(COALESCE(r.final_score,r.provisional_score)) DESC) AS rank, ' +
        'p.country_code AS country, SUM(COALESCE(r.final_score,r.provisional_score))::int AS score, COUNT(*)::int AS games ' +
        'FROM humanity_daily_runs r JOIN humanity_players p ON p.id = r.player_id ' +
        'JOIN humanity_daily_challenges c ON c.id = r.challenge_id ' +
        'WHERE r.status = $1 AND p.country_code IS NOT NULL GROUP BY p.country_code ' +
        'ORDER BY score DESC LIMIT 50',
        ['completed']
      );
      sendJSON(response, 200, { ok: true, period, entries: result.rows });
      return true;
    }

    if (period === 'friends') {
      if (!identity) {
        sendError(response, 401, 'Sign in to see your friends ranking.', 'authentication_required');
        return true;
      }
      const result = await pool.query(
        'SELECT ROW_NUMBER() OVER (ORDER BY SUM(COALESCE(r.final_score,r.provisional_score)) DESC) AS rank, p.username, ' +
        'SUM(COALESCE(r.final_score,r.provisional_score))::int AS score, COUNT(*)::int AS games ' +
        'FROM humanity_daily_runs r JOIN humanity_players p ON p.id = r.player_id ' +
        'JOIN humanity_daily_challenges c ON c.id = r.challenge_id ' +
        'WHERE r.status = $1 AND ' + dateClause + ' AND (p.id = $2 OR p.id IN (' +
        "SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END FROM humanity_friendships " +
        "WHERE (requester_id = $2 OR addressee_id = $2) AND status = 'accepted')) " +
        'GROUP BY p.id ORDER BY score DESC LIMIT 50',
        ['completed', identity.id]
      );
      sendJSON(response, 200, { ok: true, period, entries: result.rows });
      return true;
    }

    const result = await pool.query(
      'SELECT ROW_NUMBER() OVER (ORDER BY SUM(COALESCE(r.final_score,r.provisional_score))::int DESC) AS rank, p.username, ' +
      'SUM(COALESCE(r.final_score,r.provisional_score))::int AS score, COUNT(*)::int AS games ' +
      'FROM humanity_daily_runs r JOIN humanity_players p ON p.id = r.player_id ' +
      'JOIN humanity_daily_challenges c ON c.id = r.challenge_id ' +
      'WHERE r.status = $1 AND ' + dateClause + ' GROUP BY p.id ORDER BY score DESC LIMIT 50',
      ['completed']
    );
    sendJSON(response, 200, { ok: true, period, entries: result.rows });
    return true;
  }
  if (url.pathname.startsWith('/api/admin/')) {
    const user = await requireUser(request, response);
    if (!user) return true;
    const handled = await handleAdmin(request, response, url, user);
    if (handled) return true;
    sendError(response, 404, 'Admin endpoint not found.', 'not_found');
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/profile/avatar') {
    const user = await requireUser(request, response);
    if (!user) return true;
    const body = await readJSON(request);
    const avatarKey = String(body.avatarKey || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(PLANET_AVATAR_STREAKS, avatarKey)) {
      sendError(response, 400, 'Choose a valid planet avatar.', 'invalid_avatar');
      return true;
    }
    if (user.avatar_locked && !(await isAdmin(user))) {
      sendError(response, 403, 'Your planet avatar was assigned by a HUMANITY administrator and is locked.', 'avatar_locked');
      return true;
    }
    const minimumStreak = PLANET_AVATAR_STREAKS[avatarKey];
    if (Number(user.party_streak_days || 0) < minimumStreak && !(await isAdmin(user))) {
      sendError(response, 403, 'Reach the required Globe Rush streak to unlock this planet.', 'avatar_locked');
      return true;
    }
    const updated = await pool.query(
      'UPDATE humanity_players SET selected_avatar = $2, updated_at = NOW() WHERE id = $1 RETURNING id, username, email, avatar_url, country_code, xp, level, daily_streak, best_streak, party_rating, party_streak_days, role, selected_avatar, avatar_locked, account_status',
      [user.id, avatarKey]
    );
    sendJSON(response, 200, { ok: true, player: publicUser(updated.rows[0], await isAdmin(updated.rows[0])) });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/profile/me') {
    const user = await requireUser(request, response);
    if (!user) return true;
    const [daily,party,friends,answerStats,partyWins,practiceGames,playtime,teamRushWins,survivalGames,recentActivity]=await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count, COALESCE(MAX(final_score),MAX(provisional_score),0)::int AS best FROM humanity_daily_runs WHERE player_id = $1 AND status = $2',[user.id,'completed']),
      pool.query('SELECT COUNT(*)::int AS count FROM humanity_party_match_players WHERE player_id=$1',[user.id]),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_friendships WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'",[user.id]),
      pool.query('SELECT COUNT(*) FILTER (WHERE a.provisional_points>=80)::int AS rare, COUNT(*) FILTER (WHERE a.provisional_points>=100)::int AS exceptional FROM humanity_daily_run_answers a JOIN humanity_daily_runs r ON r.id=a.run_id WHERE r.player_id=$1 AND a.is_correct=TRUE',[user.id]),
      pool.query('SELECT COUNT(*)::int AS count FROM humanity_party_match_players WHERE player_id=$1 AND (won=TRUE OR rank=1)',[user.id]),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_practice_runs WHERE player_id=$1 AND status='completed'",[user.id]),
      pool.query(
        'SELECT COALESCE(SUM(seconds),0)::bigint AS seconds FROM ('+
        'SELECT GREATEST(0,EXTRACT(EPOCH FROM (completed_at-started_at))) AS seconds FROM humanity_daily_runs WHERE player_id=$1 AND status=\'completed\' AND completed_at IS NOT NULL '+
        'UNION ALL SELECT GREATEST(0,EXTRACT(EPOCH FROM (m.finished_at-m.started_at))) AS seconds FROM humanity_party_matches m JOIN humanity_party_match_players p ON p.match_id=m.id WHERE p.player_id=$1 '+
        'UNION ALL SELECT GREATEST(0,EXTRACT(EPOCH FROM (finished_at-created_at))) AS seconds FROM humanity_practice_runs WHERE player_id=$1 AND status=\'completed\' AND finished_at IS NOT NULL'+
        ') sessions',[user.id]
      ),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_party_match_players p JOIN humanity_party_matches m ON m.id=p.match_id WHERE p.player_id=$1 AND p.won=TRUE AND m.variant='team-rush'",[user.id]),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_party_match_players p JOIN humanity_party_matches m ON m.id=p.match_id WHERE p.player_id=$1 AND m.variant='survival'",[user.id]),
      pool.query(
        "SELECT kind, occurred_at, score, variant, game_mode, result, player_rank FROM ("+
        "SELECT 'atlas-daily'::text AS kind, c.challenge_date::timestamp AT TIME ZONE 'UTC' AS occurred_at, "+
        "COALESCE(r.final_score,r.provisional_score,0)::int AS score, NULL::text AS variant, NULL::text AS game_mode, "+
        "'COMPLETED'::text AS result, NULL::int AS player_rank "+
        "FROM humanity_daily_runs r JOIN humanity_daily_challenges c ON c.id=r.challenge_id "+
        "WHERE r.player_id=$1 AND r.status='completed' "+
        "UNION ALL "+
        "SELECT 'globe-rush'::text AS kind, m.finished_at AS occurred_at, p.score::int AS score, "+
        "m.variant, m.mode AS game_mode, CASE WHEN p.won THEN 'WON' ELSE 'PLAYED' END AS result, p.rank AS player_rank "+
        "FROM humanity_party_match_players p JOIN humanity_party_matches m ON m.id=p.match_id "+
        "WHERE p.player_id=$1"+
        ") activity ORDER BY occurred_at DESC LIMIT 12",
        [user.id]
      )
    ]);
    const dailyGames=Number(daily.rows[0].count||0),partyGames=Number(party.rows[0].count||0);
    const friendCount=Number(friends.rows[0].count||0),rareAnswers=Number(answerStats.rows[0].rare||0);
    const exceptionalAnswers=Number(answerStats.rows[0].exceptional||0);
    const partyWinsCount=Number(partyWins.rows[0].count||0),practiceCount=Number(practiceGames.rows[0].count||0);
    const totalPlaySeconds=Number(playtime.rows[0].seconds||0);
    const teamWins=Number(teamRushWins.rows[0].count||0),survivalMatches=Number(survivalGames.rows[0].count||0);
    const bestStreak=Number(user.best_streak||0);
    const achievements=[
      {id:'first-flight',title:'First Flight',description:'Complete your first Atlas Daily.',unlocked:dailyGames>=1,progress:Math.min(dailyGames,1),target:1},
      {id:'atlas-regular',title:'Atlas Regular',description:'Complete ten official Daily editions.',unlocked:dailyGames>=10,progress:Math.min(dailyGames,10),target:10},
      {id:'atlas-veteran',title:'Atlas Veteran',description:'Complete 30 official Daily editions.',unlocked:dailyGames>=30,progress:Math.min(dailyGames,30),target:30},
      {id:'week-in-orbit',title:'Week in Orbit',description:'Build a seven-day Atlas streak.',unlocked:bestStreak>=7,progress:Math.min(bestStreak,7),target:7},
      {id:'rare-collector',title:'Rare Collector',description:'Find five Remarkable or Exceptional answers.',unlocked:rareAnswers>=5,progress:Math.min(rareAnswers,5),target:5},
      {id:'exceptional-explorer',title:'Exceptional Explorer',description:'Discover a 100-point answer.',unlocked:exceptionalAnswers>=1,progress:Math.min(exceptionalAnswers,1),target:1},
      {id:'orb-champion',title:'Orb Champion',description:'Win a Globe Rush match.',unlocked:partyWinsCount>=1,progress:Math.min(partyWinsCount,1),target:1},
      {id:'globe-veteran',title:'Globe Veteran',description:'Play 25 Globe Rush matches.',unlocked:partyGames>=25,progress:Math.min(partyGames,25),target:25},
      {id:'team-player',title:'Team Player',description:'Win five Team Rush matches.',unlocked:teamWins>=5,progress:Math.min(teamWins,5),target:5},
      {id:'last-in-orbit',title:'Last in Orbit',description:'Complete ten Survival matches.',unlocked:survivalMatches>=10,progress:Math.min(survivalMatches,10),target:10},
      {id:'social-explorer',title:'Social Explorer',description:'Connect with another explorer.',unlocked:friendCount>=1,progress:Math.min(friendCount,1),target:1},
      {id:'endless-voyager',title:'Endless Voyager',description:'Finish ten Practice Lab sessions.',unlocked:practiceCount>=10,progress:Math.min(practiceCount,10),target:10},
      {id:'time-explorer',title:'Time Explorer',description:'Spend one hour exploring HUMANITY.',unlocked:totalPlaySeconds>=3600,progress:Math.min(totalPlaySeconds,3600),target:3600}
    ];
    sendJSON(response,200,{
      ok:true,player:publicUser(user,await isAdmin(user)),
      stats:{
        dailyGames,bestDailyScore:Number(daily.rows[0].best||0),partyGames,friends:friendCount,
        rareAnswers,exceptionalAnswers,partyWins:partyWinsCount,practiceGames:practiceCount,
        teamRushWins:teamWins,survivalGames:survivalMatches,totalPlaySeconds,
        bestStreak,currentStreak:Number(user.daily_streak||0)
      },
      recentActivity:recentActivity.rows.map(row=>({
        kind:row.kind,
        date:isoDate(row.occurred_at),
        score:Number(row.score||0),
        variant:row.variant||null,
        gameMode:row.game_mode||null,
        result:row.result,
        rank:row.player_rank==null?null:Number(row.player_rank)
      })),
      achievements
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/friends') {
    const user = await requireUser(request, response);
    if (!user) return true;
    const result = await pool.query(
      "SELECT p.id, p.username, p.avatar_url, f.status, f.requester_id = $1 AS sent_by_you FROM humanity_friendships f JOIN humanity_players p ON p.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END WHERE (f.requester_id = $1 OR f.addressee_id = $1) ORDER BY f.status, p.username",
      [user.id]
    );
    sendJSON(response, 200, { ok: true, friends: result.rows });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/friends/request') {
    const user = await requireUser(request, response);
    if (!user) return true;
    const body = await readJSON(request);
    const target = await pool.query('SELECT id FROM humanity_players WHERE LOWER(username) = LOWER($1) LIMIT 1', [String(body.username || '')]);
    if (!target.rows[0] || target.rows[0].id === user.id) {
      sendError(response, 404, 'That player could not be found.', 'player_not_found');
      return true;
    }
    await pool.query(
      'INSERT INTO humanity_friendships (requester_id, addressee_id) VALUES ($1,$2) ON CONFLICT (requester_id,addressee_id) DO NOTHING',
      [user.id, target.rows[0].id]
    );
    sendJSON(response, 201, { ok: true });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/friends/respond') {
    const user = await requireUser(request, response);
    if (!user) return true;
    const body = await readJSON(request);
    const status = body.accept ? 'accepted' : 'blocked';
    const result = await pool.query(
      'UPDATE humanity_friendships SET status = $3, updated_at = NOW() WHERE requester_id = $1 AND addressee_id = $2 AND status = $4',
      [String(body.playerId || ''), user.id, status, 'pending']
    );
    sendJSON(response, 200, { ok: true, updated: result.rowCount });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/engine/publish') {
    const secret = String(request.headers['x-engine-secret'] || bearer(request));
    if (!process.env.ENGINE_CRON_SECRET || secret !== process.env.ENGINE_CRON_SECRET) {
      sendError(response, 403, 'Engine publishing is not authorised.', 'forbidden');
      return true;
    }
    const challenge = await currentChallenge();
    sendJSON(response, 200, { ok: true, date: utcDate(), challengeId: challenge.id, questionCount: challenge.payload.questions.length });
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const origin = String(request.headers.origin || '');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Humanity-Guest, X-Engine-Secret');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  } else if (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Humanity-Guest, X-Engine-Secret');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  const url = new URL(request.url, 'http://localhost');
  try {
    const handled = await handleAPI(request, response, url, party);
    if (!handled && !response.headersSent) sendError(response, 404, 'API route not found.', 'not_found');
  } catch (error) {
    console.error('HUMANITY API error:', error.message);
    if (!response.headersSent) sendError(response, 500, 'The request could not be completed. Please try again.', 'server_error');
    else response.end();
  }
});

const party = createPartyServer({
  server,
  pool,
  allowedOrigins: ALLOWED_ORIGINS,
  authenticateToken
});

async function start() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema-geography.sql'), 'utf8');
  await pool.query(schema);
  await pool.query('DELETE FROM humanity_sessions WHERE expires_at < NOW()');
  await currentChallenge();
  server.listen(PORT, () => {
    console.log('HUMANITY Geography API listening on port ' + PORT);
  });
  const dailyTimer = setInterval(() => {
    currentChallenge().catch(error => console.error('Daily engine tick failed:', error.message));
  }, 60 * 1000);
  dailyTimer.unref();
}

async function shutdown() {
  await party.close();
  await pool.end();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown().catch(() => process.exit(1)));
process.on('SIGINT', () => shutdown().catch(() => process.exit(1)));

start().catch(error => {
  console.error('HUMANITY could not start:', error.message);
  process.exit(1);
});
