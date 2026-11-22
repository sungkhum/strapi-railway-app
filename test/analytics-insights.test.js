"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  InsightsRangeError,
  assembleDays,
  bearerToken,
  loadInsights,
  parseRange,
  tokenMatches,
} = require("../src/api/analytics-event/utils/insights");

/** The grouped rows the database returns, with every group empty unless a test fills it. */
const emptyRows = (rows = {}) => ({
  events: [],
  installs: [],
  newInstalls: [],
  platforms: [],
  appVersions: [],
  surfaces: [],
  mediaSources: [],
  contentTypes: [],
  outcomes: [],
  reasons: [],
  progress: [],
  devotionals: [],
  bookEvents: [],
  ...rows,
});

/** A knex-like connection whose transaction answers each query with the given rows. */
const fakeConnection = (answer = () => []) => {
  const statements = [];
  return {
    statements,
    async transaction(run) {
      return run({
        async raw(sql, bindings) {
          statements.push({ sql, bindings });
          return { rows: answer(sql, bindings) };
        },
      });
    },
  };
};

const books = [
  { documentId: "book-a", title: "Book A", views: "100", audio_plays: "20", book_opens: 7, downloads: 3 },
  { documentId: "book-b", title: "Book B", views: 40, audio_plays: 0, book_opens: 1, downloads: 0 },
];

test("assembles a day's counts, books and breakdowns without installation hashes", () => {
  const days = assembleDays(
    emptyRows({
      events: [
        { day: "2026-11-10", event_name: "book_detail_viewed", count: 2, seconds: 0, resumes: 0, zero_results: 0 },
        { day: "2026-11-10", event_name: "audio_play_ended", count: 2, seconds: 185.4, resumes: 0, zero_results: 0 },
        { day: "2026-11-10", event_name: "audio_play_started", count: 3, seconds: 0, resumes: 1, zero_results: 0 },
        { day: "2026-11-10", event_name: "search_performed", count: 4, seconds: 0, resumes: 0, zero_results: 1 },
        { day: "2026-11-11", event_name: "audio_play_ended", count: 1, seconds: 60, resumes: 0, zero_results: 0 },
      ],
      installs: [{ day: "2026-11-10", today: 2, week: 3, month: 5 }],
      newInstalls: [{ day: "2026-11-10", count: 1 }],
      platforms: [
        { day: "2026-11-10", label: "android", count: 1 },
        { day: "2026-11-10", label: "ios", count: 1 },
      ],
      appVersions: [{ day: "2026-11-10", label: "1.4.2", count: 2 }],
      surfaces: [{ day: "2026-11-10", label: "home", event_name: "book_detail_viewed", count: 2 }],
      progress: [{ day: "2026-11-10", event_name: "audio_progress_reached", progress_percent: 50, count: 3 }],
      devotionals: [
        { day: "2026-11-10", label: "d-1", event_name: "devotional_viewed", count: 2 },
        { day: "2026-11-10", label: "d-1", event_name: "devotional_engaged", count: 1 },
      ],
      bookEvents: [
        { day: "2026-11-10", book_document_id: "book-b", event_name: "audio_play_started", count: 1, seconds: 0 },
        { day: "2026-11-10", book_document_id: "book-a", event_name: "book_detail_viewed", count: 2, seconds: 0 },
        { day: "2026-11-10", book_document_id: "book-a", event_name: "audio_play_ended", count: 1, seconds: 125.4 },
        { day: "2026-11-10", book_document_id: "planted", event_name: "book_detail_viewed", count: 50, seconds: 0 },
      ],
    }),
    books,
    { from: "2026-11-10", to: "2026-11-11" }
  );

  assert.equal(days.length, 2);
  const [first, second] = days;
  assert.equal(first.activeInstallations, 2);
  assert.equal(first.activeInstallations7d, 3);
  assert.equal(first.activeInstallations28d, 5);
  assert.equal(first.newInstallations, 1);
  assert.equal(first.listeningSeconds, 185);
  assert.equal(first.audioResumes, 1);
  assert.equal(first.searchesWithoutResults, 1);
  assert.deepEqual(first.platforms, { android: 1, ios: 1 });
  assert.deepEqual(first.appVersions, { "1.4.2": 2 });
  assert.deepEqual(first.surfaces, { home: { book_detail_viewed: 2 } });
  assert.deepEqual(first.progress, { audio_progress_reached: { 50: 3 } });
  assert.deepEqual(first.devotionals, [{ id: "d-1", views: 2, engagements: 1 }]);
  assert.deepEqual(first.books.map((book) => [book.documentId, book.title, book.views, book.audioStarts, book.listeningSeconds]), [
    ["book-a", "Book A", 2, 0, 125],
    ["book-b", "Book B", 0, 1, 0],
  ]);
  assert.deepEqual(first.topBooks[0], { documentId: "book-a", title: "Book A", views: 2, audioStarts: 0, ebookOpens: 0 });
  assert.equal(second.listeningSeconds, 60);
  assert.equal(JSON.stringify(days).includes("planted"), false);
});

test("reports quiet days as zeros so the dashboard sees no gap", () => {
  const [day] = assembleDays(emptyRows(), books, { from: "2026-11-10", to: "2026-11-10" });
  assert.equal(day.activeInstallations, 0);
  assert.deepEqual(day.events, {});
  assert.deepEqual(day.books, []);
  assert.deepEqual(day.devotionals, []);
});

test("ignores rows outside the reported range", () => {
  const days = assembleDays(
    emptyRows({ events: [{ day: "2026-11-09", event_name: "book_detail_viewed", count: 9, seconds: 0, resumes: 0, zero_results: 0 }] }),
    books,
    { from: "2026-11-10", to: "2026-11-10" }
  );
  assert.deepEqual(days[0].events, {});
});

test("defaults to the last 30 days and rejects bad ranges", () => {
  const now = new Date("2026-11-20T10:00:00.000Z");
  assert.deepEqual(parseRange({}, now), { from: "2026-10-21", to: "2026-11-19" });
  assert.deepEqual(parseRange({ from: "2026-11-01", to: "2026-11-05" }, now), { from: "2026-11-01", to: "2026-11-05" });
  assert.throws(() => parseRange({ from: "nonsense" }, now), InsightsRangeError);
  assert.throws(() => parseRange({ to: "nonsense" }, now), InsightsRangeError);
  assert.throws(() => parseRange({ to: "2026-02-31" }, now), InsightsRangeError);
  assert.throws(() => parseRange({ from: "2026-11-05", to: "2026-11-01" }, now), InsightsRangeError);
  assert.throws(() => parseRange({ from: "2026-01-01", to: "2026-11-01" }, now), InsightsRangeError);
});

test("accepts only the exact bearer token", () => {
  assert.equal(bearerToken("Bearer abc123"), "abc123");
  assert.equal(bearerToken("Basic abc123"), "");
  assert.equal(bearerToken(undefined), "");
  assert.equal(tokenMatches("abc123", "abc123"), true);
  assert.equal(tokenMatches("abc12", "abc123"), false);
  assert.equal(tokenMatches("", "abc123"), false);
  assert.equal(tokenMatches("abc123", ""), false);
});

test("reads the lookback window in one read-only transaction and totals the catalog", async () => {
  const connection = fakeConnection();
  const strapi = {
    db: { connection },
    documents(uid) {
      assert.equal(uid, "api::book.book");
      return {
        async findMany(params) {
          assert.equal(params.status, "published");
          return books;
        },
      };
    },
  };

  const result = await loadInsights(strapi, { from: "2026-11-10", to: "2026-11-10" }, new Date("2026-11-20T10:00:00.000Z"));

  assert.match(connection.statements[0].sql, /READ ONLY/);
  assert.match(connection.statements[1].sql, /TIME ZONE 'UTC'/);
  assert.match(connection.statements[2].sql, /statement_timeout/);
  const installs = connection.statements.find(({ sql }) => sql.includes("generate_series"));
  assert.deepEqual(installs.bindings, [
    "2026-10-14T00:00:00.000Z",
    "2026-11-11T00:00:00.000Z",
    "2026-11-10T00:00:00.000Z",
    "2026-11-11T00:00:00.000Z",
  ]);
  const bookQuery = connection.statements.find(({ sql }) => sql.includes("book_document_id IN"));
  assert.equal(bookQuery.bindings[3], JSON.stringify(["book-a", "book-b"]));
  assert.equal("truncated" in result, false);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.days[0].activeInstallations, 0);
  assert.deepEqual(result.catalog, {
    publishedBooks: 2,
    lifetime: { views: 140, audioPlays: 20, bookOpens: 8, downloads: 3 },
  });
});

const controller = require("../src/api/analytics-event/controllers/analytics-event");

const TOKEN = "a".repeat(40);

const createCtx = ({ authorization, query = {}, ip = "203.0.113.7" } = {}) => {
  const ctx = {
    ip,
    query,
    request: { headers: authorization ? { authorization } : {} },
    headers: {},
    status: 200,
    body: undefined,
    set(name, value) {
      this.headers[name] = value;
    },
    notFound() {
      this.status = 404;
    },
    unauthorized(message) {
      this.status = 401;
      this.body = { error: message };
    },
    badRequest(message) {
      this.status = 400;
      this.body = { error: message };
    },
    internalServerError(message) {
      this.status = 500;
      this.body = { error: message };
    },
  };
  return ctx;
};

const withStrapi = async (run, { failing = false, onLoad } = {}) => {
  const previous = { strapi: global.strapi, token: process.env.INSIGHTS_EXPORT_TOKEN };
  const logs = [];
  global.strapi = {
    log: {
      info: (message) => logs.push(["info", message]),
      warn: (message) => logs.push(["warn", message]),
      error: (message) => logs.push(["error", message]),
    },
    db: {
      connection: {
        async transaction(run) {
          if (onLoad) await onLoad();
          if (failing) throw new Error("database is down");
          return run({ raw: async () => ({ rows: [] }) });
        },
      },
    },
    documents: () => ({ findMany: async () => [] }),
  };
  try {
    await run(logs);
  } finally {
    global.strapi = previous.strapi;
    if (previous.token === undefined) delete process.env.INSIGHTS_EXPORT_TOKEN;
    else process.env.INSIGHTS_EXPORT_TOKEN = previous.token;
  }
};

test("hides the export while no strong token is configured", async () => {
  await withStrapi(async () => {
    delete process.env.INSIGHTS_EXPORT_TOKEN;
    const off = createCtx({ authorization: "Bearer anything" });
    await controller.insights(off);
    assert.equal(off.status, 404);

    process.env.INSIGHTS_EXPORT_TOKEN = "short-token";
    const weak = createCtx({ authorization: "Bearer short-token", ip: "203.0.113.8" });
    await controller.insights(weak);
    assert.equal(weak.status, 404);
    assert.equal(weak.body, undefined);
  });
});

test("refuses a missing or wrong token and never caches the answer", async () => {
  await withStrapi(async (logs) => {
    process.env.INSIGHTS_EXPORT_TOKEN = TOKEN;
    for (const authorization of [undefined, "Bearer wrong", `Basic ${TOKEN}`, TOKEN]) {
      const ctx = createCtx({ authorization, ip: "203.0.113.20" });
      await controller.insights(ctx);
      assert.equal(ctx.status, 401);
      assert.equal(ctx.headers["Cache-Control"], "no-store");
      assert.equal(JSON.stringify(ctx.body).includes(TOKEN), false);
    }
    assert.equal(logs.filter(([level]) => level === "warn").length, 4);
    assert.equal(logs.some(([, message]) => message.includes(TOKEN)), false);
  });
});

test("ignores a token passed in the URL", async () => {
  await withStrapi(async () => {
    process.env.INSIGHTS_EXPORT_TOKEN = TOKEN;
    const ctx = createCtx({ query: { token: TOKEN, access_token: TOKEN }, ip: "203.0.113.21" });
    await controller.insights(ctx);
    assert.equal(ctx.status, 401);
  });
});

test("slows guessing without locking out the real caller", async () => {
  await withStrapi(async () => {
    process.env.INSIGHTS_EXPORT_TOKEN = TOKEN;
    const statuses = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ctx = createCtx({ authorization: "Bearer guess", ip: "203.0.113.30" });
      await controller.insights(ctx);
      statuses.push(ctx.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.deepEqual(statuses.slice(10), [429, 429]);

    const valid = createCtx({
      authorization: `Bearer ${TOKEN}`,
      query: { from: "2026-11-01", to: "2026-11-02" },
      ip: "203.0.113.30",
    });
    await controller.insights(valid);
    assert.equal(valid.status, 200);
    assert.equal(valid.body.days.length, 2);
  });
});

test("serves a valid caller, validates the range and logs the export", async () => {
  await withStrapi(async (logs) => {
    process.env.INSIGHTS_EXPORT_TOKEN = TOKEN;
    const bad = createCtx({ authorization: `Bearer ${TOKEN}`, query: { from: "2026-01-01", to: "2026-11-01" }, ip: "203.0.113.40" });
    await controller.insights(bad);
    assert.equal(bad.status, 400);

    const ok = createCtx({ authorization: `bearer ${TOKEN}`, query: { from: "2026-11-01", to: "2026-11-01" }, ip: "203.0.113.40" });
    await controller.insights(ok);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers["X-Content-Type-Options"], "nosniff");
    assert.deepEqual(Object.keys(ok.body).sort(), ["catalog", "days", "from", "generatedAt", "retentionDays", "schemaVersion", "to"]);
    assert.ok(logs.some(([level, message]) => level === "info" && message.includes("2026-11-01..2026-11-01")));
  });
});

test("runs one export at a time and recovers after a failure", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await withStrapi(
    async () => {
      process.env.INSIGHTS_EXPORT_TOKEN = TOKEN;
      const first = createCtx({ authorization: `Bearer ${TOKEN}`, ip: "203.0.113.50" });
      const running = controller.insights(first);
      await new Promise((resolve) => setImmediate(resolve));

      const second = createCtx({ authorization: `Bearer ${TOKEN}`, ip: "203.0.113.50" });
      await controller.insights(second);
      assert.equal(second.status, 429);

      release();
      await running;
      assert.equal(first.status, 200);
    },
    { onLoad: () => gate }
  );

  await withStrapi(
    async () => {
      process.env.INSIGHTS_EXPORT_TOKEN = TOKEN;
      const failed = createCtx({ authorization: `Bearer ${TOKEN}`, ip: "203.0.113.51" });
      await controller.insights(failed);
      assert.equal(failed.status, 500);
      assert.equal(JSON.stringify(failed.body).includes("database is down"), false);
    },
    { failing: true }
  );

  await withStrapi(async () => {
    process.env.INSIGHTS_EXPORT_TOKEN = TOKEN;
    const after = createCtx({ authorization: `Bearer ${TOKEN}`, ip: "203.0.113.52" });
    await controller.insights(after);
    assert.equal(after.status, 200);
  });
});

test("keys attempts on the proxy's address and stops logging once a caller is limited", async () => {
  await withStrapi(async (logs) => {
    process.env.INSIGHTS_EXPORT_TOKEN = TOKEN;
    const statuses = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      // The caller rotates X-Forwarded-For (ctx.ip); the proxy's X-Real-IP stays the same.
      const ctx = createCtx({ authorization: "Bearer guess", ip: `198.51.100.${attempt}` });
      ctx.request.headers["x-real-ip"] = "203.0.113.99";
      await controller.insights(ctx);
      statuses.push(ctx.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.deepEqual(statuses.slice(10), Array(4).fill(429));
    assert.equal(logs.filter(([level]) => level === "warn").length, 10);
  });
});
