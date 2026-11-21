"use strict";

const crypto = require("node:crypto");

const ANALYTICS_EVENT_UID = "api::analytics-event.analytics-event";
const BOOK_UID = "api::book.book";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 62;
/** Rolling 28-day counts need the 27 days before the first reported day. */
const ROLLING_LOOKBACK_DAYS = 27;
const PAGE_SIZE = 10000;
/** Past this many events the export stops and says so, rather than strain the service. */
const MAX_EVENTS = 500000;
const TOP_BOOKS_PER_DAY = 10;

class InsightsRangeError extends Error {}

const isoDay = (value) => new Date(value).toISOString().slice(0, 10);

const addDays = (day, amount) =>
  isoDay(new Date(`${day}T00:00:00.000Z`).getTime() + amount * DAY_MS);

/** A real calendar day: 2026-02-31 parses, but as 3 March, so it must survive a round trip. */
const isDay = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(`${value}T00:00:00.000Z`).getTime();
  return !Number.isNaN(time) && isoDay(time) === value;
};

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Constant-time comparison, so the response time does not reveal how much of a token matched. */
const tokenMatches = (given, expected) => {
  if (!given || !expected) return false;
  const left = crypto.createHash("sha256").update(String(given)).digest();
  const right = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
};

const MIN_TOKEN_LENGTH = 32;

/** The configured token, or null when it is missing or too short to resist guessing. */
const exportToken = (value) => {
  const token = String(value || "").trim();
  return token.length >= MIN_TOKEN_LENGTH ? token : null;
};

const bearerToken = (header) => {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ""));
  return match ? match[1].trim() : "";
};

/** Defaults to the last 30 days, ending yesterday in UTC. */
const parseRange = (query = {}, now = new Date()) => {
  const yesterday = addDays(isoDay(now), -1);
  const to = query.to === undefined ? yesterday : query.to;
  if (!isDay(to)) {
    throw new InsightsRangeError("from and to must be YYYY-MM-DD dates");
  }
  const from = query.from === undefined ? addDays(to, -29) : query.from;
  if (!isDay(from)) {
    throw new InsightsRangeError("from and to must be YYYY-MM-DD dates");
  }
  if (from > to) throw new InsightsRangeError("from must not be after to");
  const days = Math.round((new Date(to) - new Date(from)) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new InsightsRangeError(
      `The range may cover at most ${MAX_RANGE_DAYS} days`
    );
  }
  return { from, to };
};

const eachDay = (from, to) => {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
};

/**
 * Builds one summary per UTC day from events fed one at a time, so the export never holds
 * the raw events in memory. Only counts come out: installation hashes are used to count
 * distinct installations and are never returned.
 *
 * Book identifiers arrive from a public endpoint as free text, so only identifiers of
 * published books are counted. Anything else could be used to plant arbitrary text.
 */
const createAggregator = (books, { from, to }) => {
  const titles = new Map(books.map((book) => [book.documentId, book.title]));
  const installsByDay = new Map();
  const perDay = new Map(
    eachDay(from, to).map((date) => [
      date,
      { events: {}, listeningSeconds: 0, platforms: new Map(), books: new Map() },
    ])
  );

  const add = (event) => {
    const date = isoDay(event.occurredAt);
    const hash = event.installationIdHash;
    if (hash) {
      if (!installsByDay.has(date)) installsByDay.set(date, new Set());
      installsByDay.get(date).add(hash);
    }

    const day = perDay.get(date);
    if (!day) return;
    day.events[event.eventName] = (day.events[event.eventName] || 0) + 1;
    if (event.eventName === "audio_play_ended") {
      day.listeningSeconds += asNumber(event.activeSeconds);
    }
    if (hash) {
      const platform = event.platform || "unknown";
      if (!day.platforms.has(platform)) day.platforms.set(platform, new Set());
      day.platforms.get(platform).add(hash);
    }

    const bookId = event.bookDocumentId;
    if (!bookId || !titles.has(bookId)) return;
    const book = day.books.get(bookId) || {
      documentId: bookId,
      views: 0,
      audioStarts: 0,
      ebookOpens: 0,
    };
    if (event.eventName === "book_detail_viewed") book.views += 1;
    else if (event.eventName === "audio_play_started") book.audioStarts += 1;
    else if (event.eventName === "ebook_opened") book.ebookOpens += 1;
    else return;
    day.books.set(bookId, book);
  };

  const distinctOver = (date, span) => {
    const seen = new Set();
    for (let offset = 0; offset < span; offset += 1) {
      const installs = installsByDay.get(addDays(date, -offset));
      if (installs) installs.forEach((hash) => seen.add(hash));
    }
    return seen.size;
  };

  const finish = () =>
    Array.from(perDay.entries()).map(([date, day]) => ({
      date,
      activeInstallations: installsByDay.get(date)?.size || 0,
      activeInstallations7d: distinctOver(date, 7),
      activeInstallations28d: distinctOver(date, 28),
      listeningSeconds: Math.round(day.listeningSeconds),
      events: day.events,
      platforms: Object.fromEntries(
        Array.from(day.platforms.entries()).map(([platform, installs]) => [
          platform,
          installs.size,
        ])
      ),
      topBooks: Array.from(day.books.values())
        .sort(
          (left, right) =>
            right.views + right.audioStarts + right.ebookOpens -
              (left.views + left.audioStarts + left.ebookOpens) ||
            left.documentId.localeCompare(right.documentId)
        )
        .slice(0, TOP_BOOKS_PER_DAY)
        .map((book) => ({
          ...book,
          title: titles.get(book.documentId) || "Untitled book",
        })),
    }));

  return { add, finish };
};

const aggregateInsights = (events, books, range) => {
  const aggregator = createAggregator(books, range);
  events.forEach(aggregator.add);
  return aggregator.finish();
};

const summarizeCatalog = (books) => ({
  publishedBooks: books.length,
  lifetime: books.reduce(
    (totals, book) => ({
      views: totals.views + asNumber(book.views),
      audioPlays: totals.audioPlays + asNumber(book.audio_plays),
      bookOpens: totals.bookOpens + asNumber(book.book_opens),
      downloads: totals.downloads + asNumber(book.downloads),
    }),
    { views: 0, audioPlays: 0, bookOpens: 0, downloads: 0 }
  ),
});

/**
 * Feeds the window's events to `onEvent` a page at a time, walking the primary key so each
 * page is a short indexed read. Returns whether it stopped early at the event budget.
 */
const streamEvents = async (strapi, since, until, onEvent) => {
  let lastId = 0;
  let seen = 0;
  for (;;) {
    const page = await strapi.db.query(ANALYTICS_EVENT_UID).findMany({
      where: { occurredAt: { $gte: since, $lt: until }, id: { $gt: lastId } },
      select: [
        "id",
        "eventName",
        "installationIdHash",
        "occurredAt",
        "bookDocumentId",
        "activeSeconds",
        "platform",
      ],
      orderBy: { id: "asc" },
      limit: PAGE_SIZE,
    });
    page.forEach(onEvent);
    seen += page.length;
    if (page.length < PAGE_SIZE) return false;
    if (seen >= MAX_EVENTS) return true;
    lastId = page[page.length - 1].id;
  }
};

/** The read-only summary served to the reporting dashboard. */
const loadInsights = async (strapi, range, now = new Date()) => {
  const since = `${addDays(range.from, -ROLLING_LOOKBACK_DAYS)}T00:00:00.000Z`;
  const until = `${addDays(range.to, 1)}T00:00:00.000Z`;
  const books = await strapi.documents(BOOK_UID).findMany({
    status: "published",
    fields: ["title", "views", "audio_plays", "book_opens", "downloads"],
  });
  const aggregator = createAggregator(books, range);
  const truncated = await streamEvents(strapi, since, until, aggregator.add);

  return {
    generatedAt: now.toISOString(),
    from: range.from,
    to: range.to,
    retentionDays: Math.max(
      Number(process.env.ANALYTICS_RETENTION_DAYS) || 90,
      31
    ),
    // True when the event budget was reached: the newest days are then incomplete.
    truncated,
    days: aggregator.finish(),
    catalog: summarizeCatalog(books),
  };
};

module.exports = {
  InsightsRangeError,
  MAX_EVENTS,
  MAX_RANGE_DAYS,
  PAGE_SIZE,
  aggregateInsights,
  bearerToken,
  exportToken,
  loadInsights,
  parseRange,
  summarizeCatalog,
  tokenMatches,
};
