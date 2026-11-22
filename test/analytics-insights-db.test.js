"use strict";

/**
 * Runs the export's SQL against a real Postgres. It is skipped unless TEST_DATABASE_URL is
 * set, and works in a schema of its own that it removes afterwards, so it never touches
 * existing tables:
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55441/postgres npm test
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { loadInsights } = require("../src/api/analytics-event/utils/insights");

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to run the SQL tests";

const SCHEMA = `insights_test_${process.pid}`;

const books = [
  { documentId: "book-a", title: "Book A", views: 100, audio_plays: 20, book_opens: 7, downloads: 3 },
  { documentId: "book-b", title: "Book B", views: 40, audio_plays: 0, book_opens: 1, downloads: 0 },
];

let db;
let counter = 0;

const insert = (overrides) => {
  counter += 1;
  return db("analytics_events").insert({
    event_id: `event-${counter}`,
    installation_id_hash: "install-a",
    event_name: "book_detail_viewed",
    occurred_at: "2026-11-10T08:00:00.000Z",
    received_at: "2026-11-10T08:00:00.000Z",
    platform: "android",
    ...overrides,
  });
};

const strapiFor = () => ({
  db: { connection: db },
  documents: () => ({ findMany: async () => books }),
});

test.before(async () => {
  if (skip) return;
  const knex = require("knex");
  db = knex({
    client: "pg",
    connection: url,
    pool: {
      min: 1,
      max: 2,
      afterCreate: (connection, done) =>
        connection.query(`SET search_path TO ${SCHEMA}`, (error) => done(error, connection)),
    },
  });
  await db.raw(`CREATE SCHEMA ${SCHEMA}`);
  await db.raw(`SET search_path TO ${SCHEMA}`).catch(() => {});
  // The columns Strapi creates for the analytics-event content type.
  await db.raw(`
    CREATE TABLE ${SCHEMA}.analytics_events (
      id serial PRIMARY KEY,
      event_id varchar(255) UNIQUE NOT NULL,
      installation_id_hash varchar(255) NOT NULL,
      event_name varchar(255) NOT NULL,
      occurred_at timestamp(6) NOT NULL,
      received_at timestamp(6) NOT NULL,
      schema_version integer DEFAULT 1,
      content_type varchar(255),
      book_document_id varchar(255),
      chapter_document_id varchar(255),
      devotional_id varchar(255),
      source_surface varchar(255),
      platform varchar(255) DEFAULT 'unknown',
      app_version varchar(255),
      media_source varchar(255),
      playback_session_id varchar(255),
      duration_seconds numeric(10, 2),
      position_seconds numeric(10, 2),
      active_seconds numeric(10, 2),
      progress_percent integer,
      result_count integer,
      outcome varchar(255),
      reason varchar(255),
      is_resume boolean
    )`);
});

test.after(async () => {
  if (!db) return;
  await db.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.destroy();
});

test.beforeEach(async () => {
  if (db) await db("analytics_events").del();
});

const range = { from: "2026-11-10", to: "2026-11-11" };

test("counts events, installations and rolling installations per day", { skip }, async () => {
  await insert({ installation_id_hash: "old", occurred_at: "2026-10-20T00:00:00Z" });
  await insert({ installation_id_hash: "too-old", occurred_at: "2026-10-13T23:59:00Z" });
  await insert({ installation_id_hash: "recent", occurred_at: "2026-11-06T00:00:00Z" });
  await insert({ installation_id_hash: "a" });
  await insert({ installation_id_hash: "a", event_name: "audio_play_started", book_document_id: "book-a", is_resume: true });
  await insert({ installation_id_hash: "b", platform: "ios", occurred_at: "2026-11-10T23:59:59Z" });
  await insert({ installation_id_hash: "a", occurred_at: "2026-11-11T00:00:00Z" });

  const { days, schemaVersion } = await loadInsights(strapiFor(), range, new Date("2026-11-20T10:00:00Z"));
  assert.equal(schemaVersion, 2);
  assert.equal(days.length, 2);

  const [tenth, eleventh] = days;
  assert.equal(tenth.activeInstallations, 2);
  assert.equal(tenth.activeInstallations7d, 3); // a, b and recent (Nov 6 is inside 7 days)
  assert.equal(tenth.activeInstallations28d, 4); // plus old, but not too-old
  assert.deepEqual(tenth.events, { book_detail_viewed: 2, audio_play_started: 1 });
  assert.equal(tenth.audioResumes, 1);
  assert.deepEqual(tenth.platforms, { android: 1, ios: 1 });
  assert.equal(eleventh.activeInstallations, 1);
  assert.equal(eleventh.activeInstallations28d, 4);
  assert.equal(JSON.stringify(days).includes("install-"), false);
});

test("reports quiet days as zeros so the dashboard sees no gap", { skip }, async () => {
  const { days } = await loadInsights(strapiFor(), { from: "2026-11-10", to: "2026-11-10" });
  assert.deepEqual(days[0], {
    date: "2026-11-10",
    activeInstallations: 0,
    activeInstallations7d: 0,
    activeInstallations28d: 0,
    newInstallations: 0,
    listeningSeconds: 0,
    audioResumes: 0,
    searchesWithoutResults: 0,
    events: {},
    platforms: {},
    appVersions: {},
    surfaces: {},
    mediaSources: {},
    contentTypes: {},
    outcomes: {},
    reasons: {},
    progress: {},
    devotionals: [],
    books: [],
    topBooks: [],
  });
});

test("totals listening time, searches without results and first-seen installations", { skip }, async () => {
  await insert({ event_name: "audio_play_ended", active_seconds: "125.4", book_document_id: "book-a" });
  await insert({ event_name: "audio_play_ended", active_seconds: "60", book_document_id: "book-a", installation_id_hash: "b" });
  await insert({ event_name: "search_performed", result_count: 0 });
  await insert({ event_name: "search_performed", result_count: 3 });
  // "returning" was already seen before the range; "a" and "b" appear for the first time on the 10th.
  await insert({ installation_id_hash: "returning", occurred_at: "2026-11-01T00:00:00Z" });
  await insert({ installation_id_hash: "returning" });

  const { days } = await loadInsights(strapiFor(), range);
  assert.equal(days[0].listeningSeconds, 185);
  assert.equal(days[0].searchesWithoutResults, 1);
  assert.equal(days[0].newInstallations, 2);
  assert.equal(days[0].books[0].listeningSeconds, 185);
});

test("breaks activity down by version, surface, media source, outcome and progress", { skip }, async () => {
  await insert({ app_version: "1.4.2", source_surface: "home", event_name: "book_detail_viewed" });
  await insert({ app_version: "1.4.2", installation_id_hash: "b", source_surface: "search", event_name: "book_detail_viewed" });
  await insert({ app_version: "1.5.0", installation_id_hash: "c", source_surface: "home", event_name: "audio_play_started", media_source: "streamed", content_type: "book" });
  await insert({ event_name: "book_download_failed", reason: "network", outcome: "failed" });
  await insert({ event_name: "audio_progress_reached", progress_percent: 50 });
  await insert({ event_name: "audio_progress_reached", progress_percent: 50, installation_id_hash: "b" });
  await insert({ event_name: "ebook_progress_reached", progress_percent: 25 });

  const [day] = (await loadInsights(strapiFor(), range)).days;
  assert.deepEqual(day.appVersions, { "1.4.2": 2, "1.5.0": 1 });
  assert.deepEqual(day.surfaces, {
    home: { book_detail_viewed: 1, audio_play_started: 1 },
    search: { book_detail_viewed: 1 },
  });
  assert.deepEqual(day.mediaSources, { streamed: { audio_play_started: 1 } });
  assert.deepEqual(day.contentTypes, { book: { audio_play_started: 1 } });
  assert.deepEqual(day.reasons, { network: { book_download_failed: 1 } });
  assert.deepEqual(day.outcomes, { failed: { book_download_failed: 1 } });
  assert.deepEqual(day.progress, {
    audio_progress_reached: { 50: 2 },
    ebook_progress_reached: { 25: 1 },
  });
});

test("keeps text planted through the public endpoint out of the export", { skip }, async () => {
  const planted = ["someone@example.com", "<script>alert(1)</script>", "x".repeat(70), "buy now please"];
  for (const value of planted) {
    await insert({ app_version: value, source_surface: value, devotional_id: value, event_name: "devotional_viewed", book_document_id: value });
  }
  await insert({ app_version: "1.0.0", devotional_id: "2026-11-10", event_name: "devotional_viewed" });
  await insert({ book_document_id: "book-a" });

  const [day] = (await loadInsights(strapiFor(), range)).days;
  assert.deepEqual(day.appVersions, { "1.0.0": 1 });
  assert.deepEqual(Object.keys(day.surfaces), []);
  assert.deepEqual(day.devotionals, [{ id: "2026-11-10", views: 1, engagements: 0 }]);
  assert.deepEqual(day.books.map((book) => book.documentId), ["book-a"]);
  for (const value of planted) assert.equal(JSON.stringify(day).includes(value), false);
  // The planted events still count toward the day's totals.
  assert.equal(day.events.devotional_viewed, 5);
});

test("limits a day's free-text labels to its most used ones", { skip }, async () => {
  const rows = [];
  for (let index = 0; index < 60; index += 1) {
    rows.push({
      event_id: `many-${index}`,
      installation_id_hash: "a",
      event_name: "book_detail_viewed",
      occurred_at: "2026-11-10T08:00:00Z",
      received_at: "2026-11-10T08:00:00Z",
      app_version: `9.${index}.0`,
      source_surface: `surface_${index}`,
    });
  }
  await db("analytics_events").insert(rows);

  const [day] = (await loadInsights(strapiFor(), range)).days;
  assert.equal(Object.keys(day.appVersions).length, 30);
  assert.equal(Object.keys(day.surfaces).length, 30);
});

test("reports every published book with its counters, not just ten", { skip }, async () => {
  const many = Array.from({ length: 15 }, (_, index) => ({
    documentId: `book-${index}`,
    title: `Book ${index}`,
  }));
  const strapi = { db: { connection: db }, documents: () => ({ findMany: async () => many }) };
  for (const [index, book] of many.entries()) {
    await insert({ book_document_id: book.documentId });
    if (index === 0) {
      for (const name of ["audio_completed", "ebook_completed", "book_download_completed", "purchase_link_opened", "bookmark_created"]) {
        await insert({ book_document_id: book.documentId, event_name: name });
      }
    }
  }

  const [day] = (await loadInsights(strapi, range)).days;
  assert.equal(day.books.length, 15);
  assert.equal(day.topBooks.length, 10);
  assert.deepEqual(day.books[0], {
    documentId: "book-0",
    title: "Book 0",
    views: 1,
    audioStarts: 0,
    audioCompletions: 1,
    ebookOpens: 0,
    ebookCompletions: 1,
    downloads: 1,
    purchaseClicks: 1,
    bookmarks: 1,
    listeningSeconds: 0,
  });
});

test("counts devotional views and engagement per devotional", { skip }, async () => {
  await insert({ event_name: "devotional_viewed", devotional_id: "d-1" });
  await insert({ event_name: "devotional_viewed", devotional_id: "d-1", installation_id_hash: "b" });
  await insert({ event_name: "devotional_engaged", devotional_id: "d-1" });
  await insert({ event_name: "devotional_viewed", devotional_id: "d-2" });

  const [day] = (await loadInsights(strapiFor(), range)).days;
  assert.deepEqual(day.devotionals, [
    { id: "d-1", views: 2, engagements: 1 },
    { id: "d-2", views: 1, engagements: 0 },
  ]);
});

test("is read-only and answers past the old 500,000 event budget without truncating", { skip }, async () => {
  // 600,000 events in one day, generated by the database.
  await db.raw(`
    INSERT INTO analytics_events (event_id, installation_id_hash, event_name, occurred_at, received_at, platform)
    SELECT 'bulk-' || n, 'install-' || (n % 5000), 'book_detail_viewed',
           timestamp '2026-11-10 12:00:00', timestamp '2026-11-10 12:00:00', 'android'
    FROM generate_series(1, 600000) AS n`);

  const started = Date.now();
  const result = await loadInsights(strapiFor(), range);
  assert.ok(Date.now() - started < 30000, "the export finishes well inside its timeout");
  assert.equal(result.days[0].events.book_detail_viewed, 600000);
  assert.equal(result.days[0].activeInstallations, 5000);
  assert.equal("truncated" in result, false);

  const [{ count }] = await db("analytics_events").count();
  assert.equal(Number(count), 600000);
});
