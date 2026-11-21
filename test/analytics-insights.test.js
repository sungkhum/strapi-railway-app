"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  InsightsRangeError,
  aggregateInsights,
  bearerToken,
  MAX_EVENTS,
  PAGE_SIZE,
  loadInsights,
  parseRange,
  tokenMatches,
} = require("../src/api/analytics-event/utils/insights");

const event = (overrides) => ({
  eventName: "book_detail_viewed",
  installationIdHash: "install-a",
  occurredAt: "2026-11-10T08:00:00.000Z",
  platform: "android",
  ...overrides,
});

const books = [
  { documentId: "book-a", title: "Book A", views: "100", audio_plays: "20", book_opens: 7, downloads: 3 },
  { documentId: "book-b", title: "Book B", views: 40, audio_plays: 0, book_opens: 1, downloads: 0 },
];

test("summarizes each day without exposing installation hashes", () => {
  const days = aggregateInsights(
    [
      event({ bookDocumentId: "book-a" }),
      event({ bookDocumentId: "book-a", installationIdHash: "install-b", platform: "ios" }),
      event({ eventName: "audio_play_started", bookDocumentId: "book-b" }),
      event({ eventName: "audio_play_ended", activeSeconds: "125.4" }),
      event({ eventName: "audio_play_ended", activeSeconds: 60, occurredAt: "2026-11-11T01:00:00.000Z" }),
    ],
    books,
    { from: "2026-11-10", to: "2026-11-11" }
  );

  assert.equal(days.length, 2);
  assert.deepEqual(days[0], {
    date: "2026-11-10",
    activeInstallations: 2,
    activeInstallations7d: 2,
    activeInstallations28d: 2,
    listeningSeconds: 125,
    events: { book_detail_viewed: 2, audio_play_started: 1, audio_play_ended: 1 },
    platforms: { android: 1, ios: 1 },
    topBooks: [
      { documentId: "book-a", views: 2, audioStarts: 0, ebookOpens: 0, title: "Book A" },
      { documentId: "book-b", views: 0, audioStarts: 1, ebookOpens: 0, title: "Book B" },
    ],
  });
  assert.equal(days[1].activeInstallations, 1);
  assert.equal(days[1].listeningSeconds, 60);
  assert.equal(JSON.stringify(days).includes("install-"), false);
});

test("counts rolling installations from days before the reported range", () => {
  const days = aggregateInsights(
    [
      event({ installationIdHash: "old", occurredAt: "2026-10-20T00:00:00.000Z" }),
      event({ installationIdHash: "recent", occurredAt: "2026-11-06T00:00:00.000Z" }),
      event({ installationIdHash: "today", occurredAt: "2026-11-10T00:00:00.000Z" }),
      event({ installationIdHash: "too-old", occurredAt: "2026-10-13T23:59:00.000Z" }),
    ],
    books,
    { from: "2026-11-10", to: "2026-11-10" }
  );

  assert.equal(days.length, 1);
  assert.equal(days[0].activeInstallations, 1);
  assert.equal(days[0].activeInstallations7d, 2);
  assert.equal(days[0].activeInstallations28d, 3);
  assert.deepEqual(days[0].events, { book_detail_viewed: 1 });
});

test("reports quiet days as zeros so the dashboard sees no gap", () => {
  const [day] = aggregateInsights([], books, { from: "2026-11-10", to: "2026-11-10" });
  assert.deepEqual(day, {
    date: "2026-11-10",
    activeInstallations: 0,
    activeInstallations7d: 0,
    activeInstallations28d: 0,
    listeningSeconds: 0,
    events: {},
    platforms: {},
    topBooks: [],
  });
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

test("loads the lookback window, pages through events and totals the catalog", async () => {
  const queries = [];
  const strapi = {
    db: {
      query(uid) {
        assert.equal(uid, "api::analytics-event.analytics-event");
        return {
          async findMany(params) {
            queries.push(params);
            assert.equal(params.select.includes("eventId"), false);
            return [{ id: 7, ...event({ bookDocumentId: "book-a" }) }];
          },
        };
      },
    },
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

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].where, {
    occurredAt: { $gte: "2026-10-14T00:00:00.000Z", $lt: "2026-11-11T00:00:00.000Z" },
    id: { $gt: 0 },
  });
  assert.deepEqual(queries[0].orderBy, { id: "asc" });
  assert.equal(result.truncated, false);
  assert.equal(result.days[0].activeInstallations, 1);
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
      query: () => ({
        async findMany() {
          if (onLoad) await onLoad();
          if (failing) throw new Error("database is down");
          return [];
        },
      }),
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
    assert.deepEqual(Object.keys(ok.body).sort(), ["catalog", "days", "from", "generatedAt", "retentionDays", "to", "truncated"]);
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

test("counts only published books, so free text from the public endpoint never reaches the export", () => {
  const planted = "someone@example.com";
  const events = [];
  for (let index = 0; index < 50; index += 1) events.push(event({ bookDocumentId: planted }));
  events.push(event({ bookDocumentId: "book-a" }));
  const [day] = aggregateInsights(events, books, { from: "2026-11-10", to: "2026-11-10" });

  assert.deepEqual(day.topBooks, [
    { documentId: "book-a", views: 1, audioStarts: 0, ebookOpens: 0, title: "Book A" },
  ]);
  assert.equal(JSON.stringify(day).includes(planted), false);
  // The events themselves still count toward the day's totals.
  assert.equal(day.events.book_detail_viewed, 51);
});

test("walks the events by primary key and stops at the event budget", async () => {
  const wheres = [];
  let nextId = 1;
  const strapi = {
    db: {
      query: () => ({
        async findMany(params) {
          wheres.push(params.where.id.$gt);
          assert.equal(params.limit, PAGE_SIZE);
          assert.equal(params.offset, undefined);
          return Array.from({ length: PAGE_SIZE }, () => ({ id: nextId++, ...event() }));
        },
      }),
    },
    documents: () => ({ findMany: async () => books }),
  };

  const result = await loadInsights(strapi, { from: "2026-11-10", to: "2026-11-10" });

  assert.equal(result.truncated, true);
  assert.equal(wheres.length, MAX_EVENTS / PAGE_SIZE);
  assert.deepEqual(wheres.slice(0, 3), [0, PAGE_SIZE, PAGE_SIZE * 2]);
  assert.equal(result.days[0].events.book_detail_viewed, MAX_EVENTS);
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
