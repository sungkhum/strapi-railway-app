"use strict";

/**
 * The grouped counts behind the insights export. Every figure is computed by Postgres, so the
 * raw events are never read into Node and no event budget is needed: the answer's size depends
 * on the number of days and distinct labels, not on how many events the app sent.
 *
 * All queries run in one read-only transaction pinned to UTC, with a statement timeout so a
 * slow export cannot hold a connection indefinitely.
 */

const TABLE = "analytics_events";
const STATEMENT_TIMEOUT_MS = 50000;

/** Free-text fields reach the export only when they look like a short, plain label. */
const SAFE_LABEL = "^[A-Za-z0-9][A-Za-z0-9._:+-]{0,47}$";
const SAFE_ID = "^[A-Za-z0-9_-]{1,64}$";
/** A day never reports more than this many distinct values of a free-text field. */
const MAX_LABELS_PER_DAY = 30;
const MAX_DEVOTIONALS_PER_DAY = 25;

const BOOK_EVENTS = [
  "book_detail_viewed",
  "audio_play_started",
  "audio_play_ended",
  "audio_completed",
  "ebook_opened",
  "ebook_completed",
  "book_download_completed",
  "purchase_link_opened",
  "bookmark_created",
];
const PROGRESS_EVENTS = ["audio_progress_reached", "ebook_progress_reached"];
const DEVOTIONAL_EVENTS = ["devotional_viewed", "devotional_engaged"];

/**
 * A list as one JSON binding. Knex would expand a plain array into several placeholders, and
 * an empty list would then be invalid SQL.
 */
const list = (values) => JSON.stringify(values);

/** Event counts for each value of a column, for the most used values of every day. */
const byColumn = (column, { pattern = false } = {}) => ({
  sql: `
    WITH grouped AS (
      SELECT occurred_at::date AS day, ${column} AS label, event_name, count(*)::int AS count
      FROM ${TABLE}
      WHERE occurred_at >= ?::timestamp AND occurred_at < ?::timestamp
        AND ${column} IS NOT NULL${pattern ? ` AND ${column} ~ ?` : ""}
      GROUP BY 1, 2, 3
    ), totals AS (
      SELECT day, label, sum(count) AS total FROM grouped GROUP BY 1, 2
    ), ranked AS (
      SELECT day, label, row_number() OVER (PARTITION BY day ORDER BY total DESC, label) AS place
      FROM totals
    )
    SELECT g.day, g.label, g.event_name, g.count
    FROM grouped g JOIN ranked r USING (day, label)
    WHERE r.place <= ?
    ORDER BY g.day, g.label, g.event_name`,
  bindings: (w) => [
    w.from,
    w.until,
    ...(pattern ? [SAFE_LABEL] : []),
    MAX_LABELS_PER_DAY,
  ],
});

const queries = {
  events: {
    sql: `
      SELECT occurred_at::date AS day, event_name, count(*)::int AS count,
        COALESCE(sum(active_seconds) FILTER (WHERE event_name = 'audio_play_ended'), 0)::float8 AS seconds,
        count(*) FILTER (WHERE event_name = 'audio_play_started' AND is_resume IS TRUE)::int AS resumes,
        count(*) FILTER (WHERE event_name = 'search_performed' AND result_count = 0)::int AS zero_results
      FROM ${TABLE}
      WHERE occurred_at >= ?::timestamp AND occurred_at < ?::timestamp
      GROUP BY 1, 2`,
    bindings: (w) => [w.from, w.until],
  },

  // Distinct installations per day and over the 7 and 28 days that end on it. The earlier days
  // are read once, as distinct (day, installation) pairs, instead of once per reported day.
  installs: {
    sql: `
      WITH daily AS (
        SELECT DISTINCT occurred_at::date AS day, installation_id_hash AS hash
        FROM ${TABLE}
        WHERE occurred_at >= ?::timestamp AND occurred_at < ?::timestamp
      )
      SELECT g::date AS day,
        count(DISTINCT daily.hash) FILTER (WHERE daily.day = g::date)::int AS today,
        count(DISTINCT daily.hash) FILTER (WHERE daily.day > g::date - 7)::int AS week,
        count(DISTINCT daily.hash)::int AS month
      FROM generate_series(?::timestamp, ?::timestamp - interval '1 day', interval '1 day') AS g
      LEFT JOIN daily ON daily.day <= g::date AND daily.day > g::date - 28
      GROUP BY g
      ORDER BY g`,
    bindings: (w) => [w.since, w.until, w.from, w.until],
  },

  // The first day each installation appears in the events the backend still holds.
  newInstalls: {
    sql: `
      SELECT first_day AS day, count(*)::int AS count
      FROM (
        SELECT min(occurred_at)::date AS first_day FROM ${TABLE} GROUP BY installation_id_hash
      ) AS first_seen
      WHERE first_day >= ?::timestamp AND first_day < ?::timestamp
      GROUP BY 1`,
    bindings: (w) => [w.from, w.until],
  },

  platforms: {
    sql: `
      SELECT occurred_at::date AS day, COALESCE(platform, 'unknown') AS label,
        count(DISTINCT installation_id_hash)::int AS count
      FROM ${TABLE}
      WHERE occurred_at >= ?::timestamp AND occurred_at < ?::timestamp
      GROUP BY 1, 2`,
    bindings: (w) => [w.from, w.until],
  },

  appVersions: {
    sql: `
      WITH grouped AS (
        SELECT occurred_at::date AS day, app_version AS label,
          count(DISTINCT installation_id_hash)::int AS count
        FROM ${TABLE}
        WHERE occurred_at >= ?::timestamp AND occurred_at < ?::timestamp
          AND app_version ~ ?
        GROUP BY 1, 2
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY day ORDER BY count DESC, label) AS place FROM grouped
      )
      SELECT day, label, count FROM ranked WHERE place <= ?`,
    bindings: (w) => [w.from, w.until, SAFE_LABEL, MAX_LABELS_PER_DAY],
  },

  surfaces: byColumn("source_surface", { pattern: true }),
  mediaSources: byColumn("media_source"),
  contentTypes: byColumn("content_type"),
  outcomes: byColumn("outcome"),
  reasons: byColumn("reason"),

  progress: {
    sql: `
      SELECT occurred_at::date AS day, event_name, progress_percent, count(*)::int AS count
      FROM ${TABLE}
      WHERE occurred_at >= ?::timestamp AND occurred_at < ?::timestamp
        AND event_name IN (SELECT jsonb_array_elements_text(?::jsonb)) AND progress_percent IS NOT NULL
      GROUP BY 1, 2, 3`,
    bindings: (w) => [w.from, w.until, list(PROGRESS_EVENTS)],
  },

  devotionals: {
    sql: `
      WITH grouped AS (
        SELECT occurred_at::date AS day, devotional_id AS label, event_name, count(*)::int AS count
        FROM ${TABLE}
        WHERE occurred_at >= ?::timestamp AND occurred_at < ?::timestamp
          AND event_name IN (SELECT jsonb_array_elements_text(?::jsonb)) AND devotional_id ~ ?
        GROUP BY 1, 2, 3
      ), totals AS (
        SELECT day, label, sum(count) AS total FROM grouped GROUP BY 1, 2
      ), ranked AS (
        SELECT day, label, row_number() OVER (PARTITION BY day ORDER BY total DESC, label) AS place
        FROM totals
      )
      SELECT g.day, g.label, g.event_name, g.count
      FROM grouped g JOIN ranked r USING (day, label)
      WHERE r.place <= ?`,
    bindings: (w) => [w.from, w.until, list(DEVOTIONAL_EVENTS), SAFE_ID, MAX_DEVOTIONALS_PER_DAY],
  },

  // Only published books, so text planted through the public endpoint cannot be reported.
  bookEvents: {
    sql: `
      SELECT occurred_at::date AS day, book_document_id, event_name, count(*)::int AS count,
        COALESCE(sum(active_seconds) FILTER (WHERE event_name = 'audio_play_ended'), 0)::float8 AS seconds
      FROM ${TABLE}
      WHERE occurred_at >= ?::timestamp AND occurred_at < ?::timestamp
        AND event_name IN (SELECT jsonb_array_elements_text(?::jsonb)) AND book_document_id IN (SELECT jsonb_array_elements_text(?::jsonb))
      GROUP BY 1, 2, 3`,
    bindings: (w) => [w.from, w.until, list(BOOK_EVENTS), list(w.bookIds)],
  },
};

/**
 * @param connection a knex connection (strapi.db.connection)
 * @param window `since` (start of the rolling lookback), `from`, `until` (exclusive) as ISO
 *   timestamps, and the identifiers of the published books
 */
const readInsightRows = (connection, window) =>
  connection.transaction(async (trx) => {
    await trx.raw("SET TRANSACTION READ ONLY");
    await trx.raw("SET LOCAL TIME ZONE 'UTC'");
    await trx.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    const rows = {};
    // One connection, so the queries run in turn.
    for (const [name, query] of Object.entries(queries)) {
      const result = await trx.raw(query.sql, query.bindings(window));
      rows[name] = result.rows;
    }
    return rows;
  });

module.exports = {
  MAX_DEVOTIONALS_PER_DAY,
  MAX_LABELS_PER_DAY,
  SAFE_ID,
  SAFE_LABEL,
  readInsightRows,
};
