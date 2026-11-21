"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  InsightsRangeError,
  aggregateInsights,
  bearerToken,
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
            return params.offset === 0 ? [event({ bookDocumentId: "book-a" })] : [];
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
  });
  assert.equal(result.truncated, false);
  assert.equal(result.days[0].activeInstallations, 1);
  assert.deepEqual(result.catalog, {
    publishedBooks: 2,
    lifetime: { views: 140, audioPlays: 20, bookOpens: 8, downloads: 3 },
  });
});
