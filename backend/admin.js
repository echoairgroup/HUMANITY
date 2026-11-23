'use strict';

const AVATARS = Object.freeze({
  mercury: 0, venus: 3, earth: 7, mars: 14,
  jupiter: 30, saturn: 60, uranus: 90, neptune: 150
});
const ROLES = new Set(['member', 'moderator', 'admin']);
const STATUSES = new Set(['active', 'suspended']);

function createAdminController(deps) {
  const { pool, sendJSON, sendError, readJSON, isAdmin, roleFor, engine } = deps;

  async function audit(actor, target, action, details = {}) {
    await pool.query(
      'INSERT INTO humanity_admin_audit (actor_id, actor_username, target_id, target_username, action, details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      [actor.id || null, actor.username || 'Administrator', target && target.id || null,
        target && target.username || null, action, JSON.stringify(details)]
    );
  }

  function adminPlayer(row) {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      avatarUrl: row.avatar_url || null,
      selectedAvatar: row.selected_avatar || 'mercury',
      avatarLocked: Boolean(row.avatar_locked),
      role: roleFor(row),
      status: row.account_status || 'active',
      suspensionReason: row.suspension_reason || '',
      adminNote: row.admin_note || '',
      xp: Number(row.xp || 0),
      level: Number(row.level || 1),
      partyRating: Number(row.party_rating || 1000),
      dailyStreak: Number(row.daily_streak || 0),
      bestStreak: Number(row.best_streak || 0),
      partyStreak: Number(row.party_streak_days || 0),
      countryCode: row.country_code || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async function getTarget(id) {
    const result = await pool.query(
      'SELECT id, username, email, avatar_url, selected_avatar, avatar_locked, role, account_status, suspension_reason, admin_note, xp, level, party_rating, daily_streak, best_streak, party_streak_days, country_code, created_at, updated_at FROM humanity_players WHERE id = $1 LIMIT 1',
      [id]
    );
    return result.rows[0] || null;
  }

  async function overview(response) {
    const [players, active, suspended, editions, queue, matches, roles, newPlayers] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM humanity_players'),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_players WHERE COALESCE(account_status,'active')='active'"),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_players WHERE account_status='suspended'"),
      pool.query('SELECT COUNT(*)::int AS count FROM humanity_daily_challenges'),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_answer_review_queue WHERE status='pending'"),
      pool.query('SELECT COUNT(*)::int AS count FROM humanity_party_matches'),
      pool.query("SELECT COUNT(*) FILTER (WHERE role='admin')::int AS admins, COUNT(*) FILTER (WHERE role='moderator')::int AS moderators FROM humanity_players"),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_players WHERE created_at >= NOW() - INTERVAL '7 days'")
    ]);
    sendJSON(response, 200, {
      ok: true,
      stats: {
        players: players.rows[0].count,
        activePlayers: active.rows[0].count,
        suspendedPlayers: suspended.rows[0].count,
        dailyEditions: editions.rows[0].count,
        pendingAnswers: queue.rows[0].count,
        finishedMatches: matches.rows[0].count,
        admins: roles.rows[0].admins,
        moderators: roles.rows[0].moderators,
        newPlayers7d: newPlayers.rows[0].count
      }
    });
  }

  async function analytics(response, url) {
    const ranges = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '365d': '365 days' };
    const rangeKey = ranges[url.searchParams.get('range')] ? url.searchParams.get('range') : '30d';
    const interval = ranges[rangeKey];

    const [summary, timeline, pages, partyModes, practicePacks, categories, countries, engineRuns, adminActions, topQuestions, avatars, topPlayers, activity] = await Promise.all([
      pool.query(
        "SELECT " +
        "(SELECT COUNT(*)::int FROM humanity_players) AS total_players, " +
        "(SELECT COUNT(*)::int FROM humanity_players WHERE COALESCE(account_status,'active')='active') AS active_players, " +
        "(SELECT COUNT(*)::int FROM humanity_sessions WHERE expires_at > NOW()) AS active_sessions, " +
        "(SELECT COUNT(*)::int FROM humanity_players WHERE created_at >= NOW() - $1::interval) AS new_players, " +
        "(SELECT COUNT(*)::int FROM humanity_daily_runs WHERE started_at >= NOW() - $1::interval) AS daily_started, " +
        "(SELECT COUNT(*)::int FROM humanity_daily_runs WHERE completed_at >= NOW() - $1::interval AND status='completed') AS daily_completed, " +
        "(SELECT COUNT(*)::int FROM humanity_daily_run_answers WHERE created_at >= NOW() - $1::interval) AS answer_attempts, " +
        "(SELECT COUNT(*)::int FROM humanity_daily_run_answers WHERE created_at >= NOW() - $1::interval AND is_correct=TRUE) AS correct_answers, " +
        "(SELECT COUNT(*)::int FROM humanity_party_matches WHERE finished_at >= NOW() - $1::interval) AS party_matches, " +
        "(SELECT COALESCE(SUM(player_count),0)::int FROM humanity_party_matches WHERE finished_at >= NOW() - $1::interval) AS match_player_slots, " +
        "(SELECT COUNT(*)::int FROM humanity_practice_runs WHERE created_at >= NOW() - $1::interval) AS practice_started, " +
        "(SELECT COUNT(*)::int FROM humanity_practice_runs WHERE finished_at >= NOW() - $1::interval AND status='completed') AS practice_completed, " +
        "(SELECT COUNT(*)::int FROM humanity_friendships WHERE created_at >= NOW() - $1::interval) AS friendship_requests, " +
        "(SELECT COUNT(*)::int FROM humanity_answer_review_queue WHERE status='pending') AS pending_answers, " +
        "(SELECT COUNT(*)::int FROM humanity_analytics_events WHERE created_at >= NOW() - $1::interval AND event_name IN ('page_view','view_change')) AS page_views, " +
        "(SELECT COUNT(DISTINCT visitor_hash)::int FROM humanity_analytics_events WHERE created_at >= NOW() - $1::interval AND event_name IN ('page_view','view_change')) AS unique_visitors, " +
        "(SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status='completed') / NULLIF(COUNT(*),0),1) FROM humanity_daily_runs WHERE started_at >= NOW() - $1::interval) AS daily_completion_pct, " +
        "(SELECT COALESCE(ROUND(AVG(COALESCE(final_score,provisional_score)))::int,0) FROM humanity_daily_runs WHERE completed_at >= NOW() - $1::interval AND status='completed') AS average_daily_score, " +
        "(SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (completed_at-started_at))))::int,0) FROM humanity_daily_runs WHERE completed_at >= NOW() - $1::interval AND status='completed') AS average_daily_seconds, " +
        "(SELECT COUNT(*) FILTER (WHERE hint_used=TRUE)::int FROM humanity_daily_runs WHERE started_at >= NOW() - $1::interval) AS hints_used, " +
        "(SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE is_correct=TRUE) / NULLIF(COUNT(*),0),1) FROM humanity_daily_run_answers WHERE created_at >= NOW() - $1::interval) AS answer_accuracy_pct, " +
        "(SELECT COALESCE(SUM(mp.xp_earned),0)::int FROM humanity_party_match_players mp JOIN humanity_party_matches pm ON pm.id=mp.match_id WHERE pm.finished_at >= NOW() - $1::interval) AS party_xp_earned",
        [interval]
      ),
      pool.query(
        "WITH days AS (SELECT generate_series(date_trunc('day', NOW() - $1::interval), date_trunc('day', NOW()), INTERVAL '1 day') AS day) " +
        "SELECT to_char(days.day,'YYYY-MM-DD') AS date, " +
        "COALESCE(s.value,0)::int AS signups, COALESCE(v.value,0)::int AS page_views, " +
        "COALESCE(d.value,0)::int AS daily_runs, COALESCE(m.value,0)::int AS matches, COALESCE(p.value,0)::int AS practice_runs " +
        "FROM days " +
        "LEFT JOIN (SELECT date_trunc('day',created_at) AS day, COUNT(*) AS value FROM humanity_players WHERE created_at >= NOW() - $1::interval GROUP BY 1) s ON s.day=days.day " +
        "LEFT JOIN (SELECT date_trunc('day',created_at) AS day, COUNT(*) AS value FROM humanity_analytics_events WHERE created_at >= NOW() - $1::interval AND event_name IN ('page_view','view_change') GROUP BY 1) v ON v.day=days.day " +
        "LEFT JOIN (SELECT date_trunc('day',started_at) AS day, COUNT(*) AS value FROM humanity_daily_runs WHERE started_at >= NOW() - $1::interval GROUP BY 1) d ON d.day=days.day " +
        "LEFT JOIN (SELECT date_trunc('day',finished_at) AS day, COUNT(*) AS value FROM humanity_party_matches WHERE finished_at >= NOW() - $1::interval GROUP BY 1) m ON m.day=days.day " +
        "LEFT JOIN (SELECT date_trunc('day',created_at) AS day, COUNT(*) AS value FROM humanity_practice_runs WHERE created_at >= NOW() - $1::interval GROUP BY 1) p ON p.day=days.day " +
        "ORDER BY days.day",
        [interval]
      ),
      pool.query(
        "SELECT page, COUNT(*)::int AS views, COUNT(DISTINCT visitor_hash)::int AS visitors " +
        "FROM humanity_analytics_events WHERE created_at >= NOW() - $1::interval AND event_name IN ('page_view','view_change') " +
        "GROUP BY page ORDER BY views DESC, page ASC LIMIT 10",
        [interval]
      ),
      pool.query(
        "SELECT mode, variant, COUNT(*)::int AS matches, COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (finished_at-started_at))))::int,0) AS avg_duration_seconds, " +
        "COALESCE(ROUND(AVG(player_count))::int,0) AS avg_players " +
        "FROM humanity_party_matches WHERE finished_at >= NOW() - $1::interval GROUP BY mode,variant ORDER BY matches DESC LIMIT 12",
        [interval]
      ),
      pool.query(
        "SELECT pack_id, COUNT(*)::int AS sessions, COUNT(*) FILTER (WHERE status='completed')::int AS completed, " +
        "COALESCE(ROUND(AVG(score))::int,0) AS avg_score, COALESCE(SUM(questions_played),0)::int AS questions " +
        "FROM humanity_practice_runs WHERE created_at >= NOW() - $1::interval GROUP BY pack_id ORDER BY sessions DESC LIMIT 10",
        [interval]
      ),
      pool.query(
        "SELECT category_label, COUNT(*)::int AS matches, COALESCE(ROUND(AVG(player_count))::int,0) AS avg_players " +
        "FROM humanity_party_matches WHERE finished_at >= NOW() - $1::interval GROUP BY category_label ORDER BY matches DESC LIMIT 10",
        [interval]
      ),
      pool.query(
        "SELECT COALESCE(country_code,'unknown') AS country, COUNT(*)::int AS players " +
        "FROM humanity_players WHERE COALESCE(account_status,'active')='active' GROUP BY country_code ORDER BY players DESC LIMIT 10"
      ),
      pool.query(
        "SELECT run_type,status,COUNT(*)::int AS runs, COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (finished_at-started_at))))::int,0) AS avg_seconds " +
        "FROM humanity_engine_runs WHERE started_at >= NOW() - $1::interval GROUP BY run_type,status ORDER BY runs DESC LIMIT 12",
        [interval]
      ),
      pool.query(
        "SELECT action,COUNT(*)::int AS actions FROM humanity_admin_audit " +
        "WHERE created_at >= NOW() - $1::interval GROUP BY action ORDER BY actions DESC LIMIT 10",
        [interval]
      ),
      pool.query(
        "SELECT a.question_id, COALESCE(q.question->>'prompt', MAX(a.question_id)) AS prompt, " +
        "COUNT(*)::int AS attempts, COUNT(*) FILTER (WHERE a.is_correct=TRUE)::int AS accepted " +
        "FROM humanity_daily_run_answers a JOIN humanity_daily_challenges c ON c.id=a.challenge_id " +
        "LEFT JOIN LATERAL jsonb_array_elements(c.payload->'questions') AS q(question) ON q.question->>'id'=a.question_id " +
        "WHERE a.created_at >= NOW() - $1::interval GROUP BY a.question_id,q.question->>'prompt' " +
        "ORDER BY attempts DESC LIMIT 10",
        [interval]
      ),
      pool.query(
        "SELECT selected_avatar AS avatar, COUNT(*)::int AS players FROM humanity_players " +
        "WHERE COALESCE(account_status,'active')='active' GROUP BY selected_avatar ORDER BY players DESC"
      ),
      pool.query(
        "SELECT p.username,p.level,p.xp,p.selected_avatar, " +
        "(COALESCE(d.games,0)+COALESCE(m.games,0)+COALESCE(r.games,0))::int AS games " +
        "FROM humanity_players p " +
        "LEFT JOIN (SELECT player_id,COUNT(*) AS games FROM humanity_daily_runs WHERE player_id IS NOT NULL AND started_at >= NOW() - $1::interval GROUP BY player_id) d ON d.player_id=p.id " +
        "LEFT JOIN (SELECT player_id,COUNT(*) AS games FROM humanity_party_match_players mp JOIN humanity_party_matches pm ON pm.id=mp.match_id WHERE player_id IS NOT NULL AND pm.finished_at >= NOW() - $1::interval GROUP BY player_id) m ON m.player_id=p.id " +
        "LEFT JOIN (SELECT player_id,COUNT(*) AS games FROM humanity_practice_runs WHERE player_id IS NOT NULL AND created_at >= NOW() - $1::interval GROUP BY player_id) r ON r.player_id=p.id " +
        "WHERE COALESCE(p.account_status,'active')='active' ORDER BY games DESC,p.xp DESC LIMIT 10",
        [interval]
      ),
      pool.query(
        "SELECT occurred_at,kind,label,detail FROM (" +
        "SELECT created_at AS occurred_at,'signup'::text AS kind,username AS label,'New account registered'::text AS detail FROM humanity_players WHERE created_at >= NOW() - $1::interval " +
        "UNION ALL " +
        "SELECT started_at,'atlas'::text,COALESCE(p.username,'Guest explorer'),'Atlas Daily run started' FROM humanity_daily_runs r LEFT JOIN humanity_players p ON p.id=r.player_id WHERE r.started_at >= NOW() - $1::interval " +
        "UNION ALL " +
        "SELECT finished_at,'globe-rush'::text,COALESCE(p.username,'Guest room'),'Globe Rush · '||mode||' / '||variant FROM humanity_party_matches m LEFT JOIN humanity_players p ON p.id=m.winner_player_id WHERE m.finished_at >= NOW() - $1::interval " +
        "UNION ALL " +
        "SELECT COALESCE(r.finished_at,r.created_at),'practice'::text,COALESCE(p.username,'Guest explorer'),'Practice Lab · '||r.pack_id FROM humanity_practice_runs r LEFT JOIN humanity_players p ON p.id=r.player_id WHERE COALESCE(r.finished_at,r.created_at) >= NOW() - $1::interval " +
        "UNION ALL " +
        "SELECT created_at,'page-view'::text,page,'Page viewed with analytics consent' FROM humanity_analytics_events WHERE created_at >= NOW() - $1::interval AND event_name IN ('page_view','view_change') " +
        ") feed ORDER BY occurred_at DESC LIMIT 40",
        [interval]
      )
    ]);

    const s = summary.rows[0] || {};
    sendJSON(response, 200, {
      ok: true,
      range: rangeKey,
      retentionDays: 365,
      summary: s,
      timeline: timeline.rows,
      popularPages: pages.rows,
      partyModes: partyModes.rows,
      practicePacks: practicePacks.rows,
      categories: categories.rows,
      countries: countries.rows,
      engineRuns: engineRuns.rows,
      adminActions: adminActions.rows,
      topQuestions: topQuestions.rows,
      avatars: avatars.rows,
      topPlayers: topPlayers.rows,
      activity: activity.rows
    });
  }

  async function listUsers(response, url) {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
    const role = String(url.searchParams.get('role') || '').toLowerCase();
    const status = String(url.searchParams.get('status') || '').toLowerCase();
    const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') || '25', 10) || 25));
    const offset = Math.max(0, Math.min(1000000, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0));
    const args = [];
    const clauses = [];

    if (q) {
      args.push('%' + q + '%');
      clauses.push("(username ILIKE $" + args.length + " OR COALESCE(email, '') ILIKE $" + args.length + ")");
    }
    if (status && STATUSES.has(status)) {
      args.push(status);
      clauses.push("COALESCE(account_status, 'active') = $" + args.length);
    }
    if (role && ROLES.has(role)) {
      args.push(role);
      clauses.push("COALESCE(role, 'member') = $" + args.length);
    } else if (role === 'owner') {
      args.push(Array.from(deps.adminEmails || []));
      clauses.push("LOWER(COALESCE(email, '')) = ANY($" + args.length + "::text[])");
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM humanity_players ' + where, args);
    const dataArgs = args.slice();
    dataArgs.push(limit);
    const limitParam = dataArgs.length;
    dataArgs.push(offset);
    const offsetParam = dataArgs.length;
    const result = await pool.query(
      'SELECT id, username, email, avatar_url, selected_avatar, avatar_locked, role, account_status, xp, level, party_rating, daily_streak, party_streak_days, created_at, updated_at ' +
      'FROM humanity_players ' + where + ' ORDER BY created_at DESC LIMIT $' + limitParam + ' OFFSET $' + offsetParam,
      dataArgs
    );
    sendJSON(response, 200, {
      ok: true,
      players: result.rows.map(adminPlayer),
      total: count.rows[0].count,
      limit,
      offset
    });
  }

  async function userDetails(response, id) {
    const player = await getTarget(id);
    if (!player) {
      sendError(response, 404, 'That HUMANITY player could not be found.', 'player_not_found');
      return;
    }
    const [daily, matches, wins, practice, friends, sessions, activity] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count, COALESCE(MAX(final_score),MAX(provisional_score),0)::int AS best FROM humanity_daily_runs WHERE player_id=$1 AND status='completed'", [id]),
      pool.query('SELECT COUNT(*)::int AS count FROM humanity_party_match_players WHERE player_id=$1', [id]),
      pool.query('SELECT COUNT(*)::int AS count FROM humanity_party_match_players WHERE player_id=$1 AND (won=TRUE OR rank=1)', [id]),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_practice_runs WHERE player_id=$1 AND status='completed'", [id]),
      pool.query("SELECT COUNT(*)::int AS count FROM humanity_friendships WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'", [id]),
      pool.query('SELECT COUNT(*)::int AS count FROM humanity_sessions WHERE player_id=$1 AND expires_at>NOW()', [id]),
      pool.query(
        "SELECT kind, occurred_at, score, label, mode, result, player_rank FROM (" +
        "SELECT 'atlas-daily'::text AS kind, c.challenge_date::timestamptz AS occurred_at, COALESCE(r.final_score,r.provisional_score,0)::int AS score, 'Atlas Daily'::text AS label, NULL::text AS mode, 'COMPLETED'::text AS result, NULL::int AS player_rank " +
        "FROM humanity_daily_runs r JOIN humanity_daily_challenges c ON c.id=r.challenge_id WHERE r.player_id=$1 AND r.status='completed' " +
        "UNION ALL " +
        "SELECT 'globe-rush'::text AS kind, m.finished_at AS occurred_at, p.score::int AS score, m.variant::text AS label, m.mode::text AS mode, CASE WHEN p.won THEN 'WON' ELSE 'PLAYED' END::text AS result, p.rank::int AS player_rank " +
        "FROM humanity_party_match_players p JOIN humanity_party_matches m ON m.id=p.match_id WHERE p.player_id=$1 " +
        "UNION ALL " +
        "SELECT 'practice'::text AS kind, COALESCE(finished_at,updated_at) AS occurred_at, score::int AS score, pack_id::text AS label, 'practice'::text AS mode, status::text AS result, NULL::int AS player_rank " +
        "FROM humanity_practice_runs WHERE player_id=$1" +
        ") history ORDER BY occurred_at DESC LIMIT 20",
        [id]
      )
    ]);
    sendJSON(response, 200, {
      ok: true,
      player: adminPlayer(player),
      stats: {
        dailyGames: daily.rows[0].count,
        bestDailyScore: daily.rows[0].best,
        globeRushGames: matches.rows[0].count,
        globeRushWins: wins.rows[0].count,
        practiceGames: practice.rows[0].count,
        friends: friends.rows[0].count,
        activeSessions: sessions.rows[0].count
      },
      recentActivity: activity.rows
    });
  }

  async function updateUser(request, response, actor, id) {
    const actorRole = roleFor(actor);
    if (actorRole === 'moderator') {
      sendError(response, 403, 'Moderators can review answers but cannot change player accounts.', 'insufficient_permissions');
      return;
    }
    if (String(actor.id) === String(id)) {
      sendError(response, 403, 'You cannot change your own administrator account from this panel.', 'self_edit_blocked');
      return;
    }
    const target = await getTarget(id);
    if (!target) {
      sendError(response, 404, 'That HUMANITY player could not be found.', 'player_not_found');
      return;
    }
    const targetRole = roleFor(target);
    if (targetRole === 'owner') {
      sendError(response, 403, 'The protected owner account cannot be changed from player management.', 'protected_owner');
      return;
    }
    if (actorRole !== 'owner' && targetRole !== 'member') {
      sendError(response, 403, 'Only the protected owner can manage administrator accounts.', 'role_change_forbidden');
      return;
    }

    const body = await readJSON(request);
    const sets = [];
    const values = [];
    const changes = {};
    function set(column, value, label) {
      values.push(value);
      sets.push(column + ' = $' + values.length);
      changes[label || column] = value;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'selectedAvatar')) {
      const avatar = String(body.selectedAvatar || '').toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(AVATARS, avatar)) {
        sendError(response, 400, 'Choose a valid planet avatar.', 'invalid_avatar');
        return;
      }
      set('selected_avatar', avatar, 'selectedAvatar');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'avatarLocked')) {
      if (typeof body.avatarLocked !== 'boolean') {
        sendError(response, 400, 'Avatar lock must be true or false.', 'invalid_avatar_lock');
        return;
      }
      set('avatar_locked', body.avatarLocked, 'avatarLocked');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'role')) {
      if (actorRole !== 'owner') {
        sendError(response, 403, 'Only the protected owner can assign administrator roles.', 'role_change_forbidden');
        return;
      }
      const role = String(body.role || '').toLowerCase();
      if (!ROLES.has(role)) {
        sendError(response, 400, 'Choose member, moderator or admin.', 'invalid_role');
        return;
      }
      set('role', role, 'role');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const status = String(body.status || '').toLowerCase();
      if (!STATUSES.has(status)) {
        sendError(response, 400, 'Choose active or suspended.', 'invalid_status');
        return;
      }
      set('account_status', status, 'status');
      const reason = status === 'suspended' ? String(body.suspensionReason || '').trim().slice(0, 300) : '';
      set('suspension_reason', reason || null, 'suspensionReason');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'xp')) {
      const xp = Number(body.xp);
      if (!Number.isSafeInteger(xp) || xp < 0 || xp > 1000000000) {
        sendError(response, 400, 'XP must be a whole number from 0 to 1,000,000,000.', 'invalid_xp');
        return;
      }
      set('xp', xp, 'xp');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'level')) {
      const level = Number(body.level);
      if (!Number.isSafeInteger(level) || level < 1 || level > 10000) {
        sendError(response, 400, 'Level must be a whole number from 1 to 10,000.', 'invalid_level');
        return;
      }
      set('level', level, 'level');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'partyRating')) {
      const rating = Number(body.partyRating);
      if (!Number.isSafeInteger(rating) || rating < 100 || rating > 100000) {
        sendError(response, 400, 'Globe Rush rating must be a whole number from 100 to 100,000.', 'invalid_rating');
        return;
      }
      set('party_rating', rating, 'partyRating');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'adminNote')) {
      set('admin_note', String(body.adminNote || '').trim().slice(0, 500) || null, 'adminNote');
    }

    if (!sets.length) {
      sendError(response, 400, 'There are no changes to save.', 'empty_update');
      return;
    }

    values.push(id);
    const result = await pool.query(
      'UPDATE humanity_players SET ' + sets.join(', ') + ', updated_at=NOW() WHERE id=$' + values.length +
      ' RETURNING id, username, email, avatar_url, selected_avatar, avatar_locked, role, account_status, suspension_reason, admin_note, xp, level, party_rating, daily_streak, best_streak, party_streak_days, country_code, created_at, updated_at',
      values
    );
    if (changes.status === 'suspended') {
      await pool.query('DELETE FROM humanity_sessions WHERE player_id=$1', [id]);
    }
    await audit(actor, target, 'user_updated', changes);
    sendJSON(response, 200, { ok: true, player: adminPlayer(result.rows[0]), changes });
  }

  async function revokeSessions(response, actor, id) {
    if (roleFor(actor) === 'moderator') {
      sendError(response, 403, 'Moderators cannot revoke account sessions.', 'insufficient_permissions');
      return;
    }
    if (String(actor.id) === String(id)) {
      sendError(response, 403, 'You cannot revoke your own session from this panel.', 'self_edit_blocked');
      return;
    }
    const target = await getTarget(id);
    if (!target) {
      sendError(response, 404, 'That HUMANITY player could not be found.', 'player_not_found');
      return;
    }
    if (roleFor(target) === 'owner' || (roleFor(actor) !== 'owner' && roleFor(target) !== 'member')) {
      sendError(response, 403, 'You do not have permission to revoke this account sessions.', 'role_change_forbidden');
      return;
    }
    const result = await pool.query('DELETE FROM humanity_sessions WHERE player_id=$1', [id]);
    await audit(actor, target, 'sessions_revoked', { sessions: result.rowCount });
    sendJSON(response, 200, { ok: true, revoked: result.rowCount });
  }

  async function auditLog(response, url) {
    const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const result = await pool.query(
      'SELECT id, actor_username, target_username, action, details, created_at FROM humanity_admin_audit ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    sendJSON(response, 200, { ok: true, entries: result.rows });
  }

  async function reviewQueue(response) {
    const result = await pool.query(
      "SELECT id, question_id, question_prompt, answer_text, occurrences, confidence, source_url, status, created_at FROM humanity_answer_review_queue WHERE status='pending' ORDER BY occurrences DESC, created_at ASC LIMIT 200"
    );
    sendJSON(response, 200, { ok: true, entries: result.rows });
  }

  async function reviewAnswer(request, response, actor, id) {
    const body = await readJSON(request);
    const action = body.action === 'approve' ? 'approve' : 'reject';
    const result = await pool.query(
      'SELECT * FROM humanity_answer_review_queue WHERE id=$1 AND status=$2 LIMIT 1',
      [id, 'pending']
    );
    const item = result.rows[0];
    if (!item) {
      sendError(response, 404, 'That review item is no longer pending.', 'review_item_missing');
      return;
    }
    if (action === 'approve') {
      const rawRarity = Number(body.rarity);
      const rarity = Number.isInteger(rawRarity) ? Math.max(0, Math.min(5, rawRarity)) : 2;
      const aliases = [];
      const seenAliases = new Set([item.answer_key]);
      for (const rawAlias of Array.isArray(body.aliases) ? body.aliases : []) {
        const alias = String(rawAlias || '').trim().slice(0, 80);
        const aliasKey = engine.normaliseAnswer(alias);
        if (!aliasKey || aliasKey.length < 2 || seenAliases.has(aliasKey)) continue;
        seenAliases.add(aliasKey);
        aliases.push(alias);
        if (aliases.length >= 8) break;
      }
      await pool.query(
        'INSERT INTO humanity_approved_answers (question_id, answer_key, answer_text, aliases, rarity, source_url, approved_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT (question_id, answer_key) DO UPDATE SET answer_text=EXCLUDED.answer_text, aliases=EXCLUDED.aliases, rarity=EXCLUDED.rarity, source_url=EXCLUDED.source_url, approved_by=EXCLUDED.approved_by, approved_at=NOW()',
        [item.question_id, item.answer_key, item.answer_text, JSON.stringify(aliases), rarity, item.source_url || null, actor.username]
      );
    }
    await pool.query(
      'UPDATE humanity_answer_review_queue SET status=$2, reviewer_note=$3, updated_at=NOW() WHERE id=$1',
      [id, action === 'approve' ? 'approved_by_admin' : 'rejected', String(body.note || '').slice(0, 300)]
    );
    await audit(actor, null, 'answer_' + action, { reviewId: id, questionId: item.question_id, answer: item.answer_text });
    sendJSON(response, 200, { ok: true, action });
  }

  return async function handleAdmin(request, response, url, user) {
    if (!await isAdmin(user)) {
      sendError(response, 403, 'This area is only available to HUMANITY administrators.', 'admin_required');
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/overview') {
      await overview(response);
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/analytics') {
      await analytics(response, url);
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/users') {
      await listUsers(response, url);
      return true;
    }
    const userPrefix = '/api/admin/users/';
    if (url.pathname.startsWith(userPrefix)) {
      const parts = url.pathname.slice(userPrefix.length).split('/');
      const id = decodeURIComponent(parts[0] || '');
      if (!id) return false;
      if (parts.length === 2 && parts[1] === 'revoke-sessions' && request.method === 'POST') {
        await revokeSessions(response, user, id);
        return true;
      }
      if (parts.length === 1 && request.method === 'GET') {
        await userDetails(response, id);
        return true;
      }
      if (parts.length === 1 && request.method === 'PATCH') {
        await updateUser(request, response, user, id);
        return true;
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/audit') {
      await auditLog(response, url);
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/review-queue') {
      await reviewQueue(response);
      return true;
    }
    const reviewPrefix = '/api/admin/review/';
    if (request.method === 'POST' && url.pathname.startsWith(reviewPrefix)) {
      const rawId = url.pathname.slice(reviewPrefix.length);
      const id = Number(rawId);
      if (/^\d+$/.test(rawId) && Number.isSafeInteger(id) && id > 0) {
        await reviewAnswer(request, response, user, id);
        return true;
      }
    }
    return false;
  };
}

module.exports = { createAdminController };
