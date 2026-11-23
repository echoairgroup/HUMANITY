'use strict';

const crypto = require('node:crypto');

const ALLOWED_EVENTS = new Set([
  'page_view',
  'view_change',
  'game_start',
  'game_complete',
  'practice_start',
  'practice_complete'
]);
const ALLOWED_PAGES = new Set(['daily', 'party', 'rankings']);
const ALLOWED_DATA = new Set(['game', 'mode', 'variant', 'pack', 'resumed', 'durationSeconds', 'success']);
const rateLimit = new Map();

function cleanEventData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const key of ALLOWED_DATA) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const item = value[key];
    if (typeof item === 'boolean') output[key] = item;
    else if (typeof item === 'number' && Number.isFinite(item)) output[key] = Math.max(0, Math.min(86400, Math.floor(item)));
    else if (typeof item === 'string') output[key] = item.trim().slice(0, 60);
  }
  return output;
}

function createAnalyticsCollector(deps) {
  const { pool, sendJSON, sendError, readJSON } = deps;

  async function handle(request, response) {
    let body;
    try {
      body = await readJSON(request);
    } catch (error) {
      sendError(response, 400, error.message || 'Invalid analytics event.', 'invalid_event');
      return;
    }

    const visitorId = String(body.visitorId || '');
    const eventName = String(body.eventName || '');
    const page = String(body.page || '');
    if (!/^[A-Za-z0-9-]{16,64}$/.test(visitorId) ||
        !ALLOWED_EVENTS.has(eventName) ||
        !ALLOWED_PAGES.has(page)) {
      sendError(response, 400, 'The analytics event is not valid.', 'invalid_event');
      return;
    }

    const visitorHash = crypto.createHash('sha256').update(visitorId).digest('hex');
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const bucket = rateLimit.get(visitorHash);
    if (!bucket || bucket.minute !== minute) {
      rateLimit.set(visitorHash, { minute, count: 1 });
    } else if (bucket.count >= 60) {
      sendError(response, 429, 'Too many analytics events. Please try again shortly.', 'rate_limited');
      return;
    } else {
      bucket.count += 1;
    }

    if (rateLimit.size > 10000) {
      for (const [key, value] of rateLimit) {
        if (value.minute < minute - 1) rateLimit.delete(key);
      }
    }

    const eventData = cleanEventData(body.data);
    await pool.query(
      'INSERT INTO humanity_analytics_events (visitor_hash,event_name,page,event_data) VALUES ($1,$2,$3,$4::jsonb)',
      [visitorHash, eventName, page, JSON.stringify(eventData)]
    );
    sendJSON(response, 202, { ok: true, recorded: true });
  }

  return { handle };
}

module.exports = { createAnalyticsCollector };
