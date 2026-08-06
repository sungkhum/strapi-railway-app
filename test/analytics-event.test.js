"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const analyticsServiceFactory = require("../src/api/analytics-event/services/analytics-event");
const {
  AnalyticsValidationError,
  validateBatch,
} = require("../src/api/analytics-event/utils/contract");
const analyticsDashboardFactory = require("../src/plugins/analytics-dashboard/server/src/services/analytics");

const now = new Date("2026-08-06T12:00:00.000Z");

const validBookView = {
  eventId: "event_20260806_000001",
  eventName: "book_detail_viewed",
  occurredAt: "2026-08-06T11:59:00.000Z",
  contentType: "book",
  bookDocumentId: "book-document-id",
  sourceSurface: "featured",
  platform: "android",
  appVersion: "1.3.1+7",
};

test("accepts a minimal privacy-safe analytics batch", () => {
  const result = validateBatch(
    {
      installationId: "installation_20260806_000001",
      events: [validBookView],
    },
    now
  );

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventName, "book_detail_viewed");
  assert.equal(result.events[0].bookDocumentId, "book-document-id");
  assert.equal(result.events[0].platform, "android");
});

test("rejects undeclared properties so raw search text cannot leak", () => {
  assert.throws(
    () =>
      validateBatch(
        {
          installationId: "installation_20260806_000001",
          events: [
            {
              ...validBookView,
              searchQuery: "private search text",
            },
          ],
        },
        now
      ),
    (error) =>
      error instanceof AnalyticsValidationError &&
      error.message.includes("searchQuery")
  );
});

test("rejects events without their required content identifier", () => {
  assert.throws(
    () =>
      validateBatch(
        {
          installationId: "installation_20260806_000001",
          events: [
            {
              ...validBookView,
              bookDocumentId: undefined,
            },
          ],
        },
        now
      ),
    /requires bookDocumentId/
  );
});

test("hashes installation identifiers deterministically without storing them", () => {
  const first = analyticsServiceFactory.hashInstallationId(
    "installation_20260806_000001",
    "test-secret"
  );
  const second = analyticsServiceFactory.hashInstallationId(
    "installation_20260806_000001",
    "test-secret"
  );

  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.notEqual(first, "installation_20260806_000001");
});

test("aggregates verified events without exposing anonymous identifiers", () => {
  const aggregate = analyticsDashboardFactory.aggregateFirstPartyEvents;
  const events = [
    {
      eventName: "book_detail_viewed",
      installationIdHash: "install-a",
      occurredAt: "2026-08-06T09:00:00.000Z",
      bookDocumentId: "book-a",
    },
    {
      eventName: "audio_play_started",
      installationIdHash: "install-a",
      occurredAt: "2026-08-06T09:01:00.000Z",
      bookDocumentId: "book-a",
    },
    {
      eventName: "audio_play_ended",
      installationIdHash: "install-a",
      occurredAt: "2026-08-06T09:31:00.000Z",
      bookDocumentId: "book-a",
      activeSeconds: 1800,
    },
    {
      eventName: "devotional_viewed",
      installationIdHash: "install-b",
      occurredAt: "2026-08-06T10:00:00.000Z",
    },
    {
      eventName: "search_performed",
      installationIdHash: "install-b",
      occurredAt: "2026-08-06T10:01:00.000Z",
    },
    {
      eventName: "bookmark_created",
      installationIdHash: "install-a",
      occurredAt: "2026-08-06T10:02:00.000Z",
      bookDocumentId: "book-a",
    },
  ];
  const books = [
    {
      documentId: "book-a",
      title: "Book A",
      categories: ["Faith"],
    },
  ];

  const result = aggregate(events, books, now);

  assert.equal(result.totals.activeUsers, 2);
  assert.equal(result.totals.listeners, 1);
  assert.equal(result.totals.listeningHours, 0.5);
  assert.equal(result.totals.searches, 1);
  assert.equal(result.totals.bookmarks, 1);
  assert.equal(result.rates.audioStartPerView, 100);
  assert.equal(result.topBooks[0].title, "Book A");
  assert.equal(JSON.stringify(result).includes("install-a"), false);
});
