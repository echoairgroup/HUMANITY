-- HUMANITY geography game schema.
-- All statements are additive and safe to run against the existing Neon database.

CREATE TABLE IF NOT EXISTS humanity_players (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  discord_id TEXT UNIQUE,
  avatar_url TEXT,
  country_code TEXT,
  xp BIGINT NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  daily_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_daily_date DATE,
  party_rating INTEGER NOT NULL DEFAULT 1000,
  party_season_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE humanity_players ADD COLUMN IF NOT EXISTS party_season_id TEXT;

CREATE TABLE IF NOT EXISTS humanity_sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES humanity_players(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS humanity_sessions_player_idx ON humanity_sessions(player_id);
CREATE INDEX IF NOT EXISTS humanity_sessions_expiry_idx ON humanity_sessions(expires_at);

CREATE TABLE IF NOT EXISTS humanity_daily_challenges (
  id TEXT PRIMARY KEY,
  challenge_date DATE NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalised_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS humanity_daily_runs (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES humanity_daily_challenges(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL,
  player_id TEXT REFERENCES humanity_players(id) ON DELETE SET NULL,
  guest_id TEXT,
  current_question INTEGER NOT NULL DEFAULT 0,
  question_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hint_used BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  provisional_score INTEGER NOT NULL DEFAULT 0,
  final_score INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (challenge_id, identity_key)
);
CREATE INDEX IF NOT EXISTS humanity_daily_runs_score_idx
  ON humanity_daily_runs(challenge_id, COALESCE(final_score, provisional_score) DESC);
CREATE INDEX IF NOT EXISTS humanity_daily_runs_player_idx ON humanity_daily_runs(player_id);

CREATE TABLE IF NOT EXISTS humanity_daily_run_answers (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES humanity_daily_runs(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES humanity_daily_challenges(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_slot INTEGER NOT NULL,
  answer_key TEXT,
  answer_text TEXT,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  provisional_points INTEGER NOT NULL DEFAULT 0,
  final_points INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, question_slot)
);
CREATE INDEX IF NOT EXISTS humanity_daily_answers_question_idx
  ON humanity_daily_run_answers(challenge_id, question_id, answer_key);
CREATE INDEX IF NOT EXISTS humanity_daily_answers_identity_idx
  ON humanity_daily_run_answers(challenge_id, identity_key);

CREATE TABLE IF NOT EXISTS humanity_answer_review_queue (
  id BIGSERIAL PRIMARY KEY,
  question_id TEXT NOT NULL,
  question_prompt TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  answer_key TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  confidence NUMERIC(4,3),
  source_url TEXT,
  reviewer_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (question_id, answer_key)
);
CREATE INDEX IF NOT EXISTS humanity_answer_review_status_idx
  ON humanity_answer_review_queue(status, created_at DESC);

CREATE TABLE IF NOT EXISTS humanity_approved_answers (
  question_id TEXT NOT NULL,
  answer_key TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  rarity INTEGER NOT NULL DEFAULT 1,
  source_url TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (question_id, answer_key)
);

CREATE TABLE IF NOT EXISTS humanity_seasons (
  id TEXT PRIMARY KEY,
  starts_at DATE NOT NULL,
  ends_at DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS humanity_party_matches (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES humanity_seasons(id),
  mode TEXT NOT NULL CHECK (mode IN ('quick', 'ranked', 'private')),
  category_id TEXT NOT NULL,
  category_label TEXT NOT NULL,
  winner_player_id TEXT REFERENCES humanity_players(id) ON DELETE SET NULL,
  player_count INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS humanity_party_matches_finished_idx
  ON humanity_party_matches(finished_at DESC);

CREATE TABLE IF NOT EXISTS humanity_party_match_players (
  match_id TEXT NOT NULL REFERENCES humanity_party_matches(id) ON DELETE CASCADE,
  player_key TEXT NOT NULL,
  player_id TEXT REFERENCES humanity_players(id) ON DELETE SET NULL,
  guest_name TEXT,
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  hearts_left INTEGER NOT NULL DEFAULT 0,
  rating_before INTEGER,
  rating_after INTEGER,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_key)
);

CREATE TABLE IF NOT EXISTS humanity_friendships (
  requester_id TEXT NOT NULL REFERENCES humanity_players(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES humanity_players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

CREATE TABLE IF NOT EXISTS humanity_engine_runs (
  id BIGSERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
