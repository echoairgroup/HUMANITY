'use strict';

function classifyDailyRun(run) {
  if (!run) return 'start';
  return String(run.status || '').toLowerCase() === 'in_progress' ? 'resume' : 'locked';
}

function remainingSeconds(run, nowMs, durationSeconds) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (!run || run.awaiting_next) return duration;
  const startedAt = new Date(run.question_started_at).getTime();
  if (!Number.isFinite(startedAt)) return duration;
  const elapsed = Math.max(0, Number(nowMs) - startedAt);
  return Math.max(0, Math.ceil((duration * 1000 - elapsed) / 1000));
}

module.exports = { classifyDailyRun, remainingSeconds };
