"use strict";

const crypto = require("node:crypto");

const ANALYTICS_EVENT_UID = "api::analytics-event.analytics-event";
const BOOK_UID = "api::book.book";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 62;
/** Rolling 28-day counts need the 27 days before the first reported day. */
const ROLLING_LOOKBACK_DAYS = 27;
const PAGE_SIZE = 50000;
const MAX_EVENTS = 1000000;
const TOP_BOOKS_PER_DAY = 10;

class InsightsRangeError extends Error {}

const isoDay = (value) => new Date(value).toISOString().slice(0, 10);

const addDays = (day, amount) =>
  isoDay(new Date(`${day}T00:00:00.000Z`).getTime() + amount * DAY_MS);

const isDay = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());

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

const bearerToken = (header) => {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ""));
  return match ? match[1].trim() : "";
};

/** Defaults to the last 30 days, ending yesterday in UTC. */
const parseRange = (query = {}, now = new Date()) => {
  const yesterday = addDays(isoDay(now), -1);
  const to = query.to === undefined ? yesterday : query.to;
  const from = query.from === undefined ? addDays(to, -29) : query.from;
  if (!isDay(from) || !isDay(to)) {
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
 * Turns raw events into one summary per UTC day. Only counts leave this function:
 * installation hashes are used to count distinct installations and are never returned.
 */
const aggregateInsights = (events, books, { from, to }) => {
  const titles = new Map(books.map((book) => [book.documentId, book.title]));
  const installsByDay = new Map();
  const perDay = new Map(
    eachDay(from, to).map((date) => [
      date,
      { events: {}, listeningSeconds: 0, platforms: new Map(), books: new Map() },
    ])
  );

  events.forEach((event) => {
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
    if (!bookId) return;
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
  });

  const distinctOver = (date, span) => {
    const seen = new Set();
    for (let offset = 0; offset < span; offset += 1) {
      const installs = installsByDay.get(addDays(date, -offset));
      if (installs) installs.forEach((hash) => seen.add(hash));
    }
    return seen.size;
  };

  return Array.from(perDay.entries()).map(([date, day]) => ({
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
        title: titles.get(book.documentId) || "Unknown book",
      })),
  }));
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

const loadEvents = async (strapi, since, until) => {
  const events = [];
  for (let offset = 0; offset < MAX_EVENTS; offset += PAGE_SIZE) {
    const page = await strapi.db.query(ANALYTICS_EVENT_UID).findMany({
      where: { occurredAt: { $gte: since, $lt: until } },
      select: [
        "eventName",
        "installationIdHash",
        "occurredAt",
        "bookDocumentId",
        "activeSeconds",
        "platform",
      ],
      orderBy: { id: "asc" },
      limit: PAGE_SIZE,
      offset,
    });
    events.push(...page);
    if (page.length < PAGE_SIZE) return { events, truncated: false };
  }
  return { events, truncated: true };
};

/** The read-only summary served to the reporting dashboard. */
const loadInsights = async (strapi, range, now = new Date()) => {
  const since = `${addDays(range.from, -ROLLING_LOOKBACK_DAYS)}T00:00:00.000Z`;
  const until = `${addDays(range.to, 1)}T00:00:00.000Z`;
  const [{ events, truncated }, books] = await Promise.all([
    loadEvents(strapi, since, until),
    strapi.documents(BOOK_UID).findMany({
      status: "published",
      fields: ["title", "views", "audio_plays", "book_opens", "downloads"],
    }),
  ]);

  return {
    generatedAt: now.toISOString(),
    from: range.from,
    to: range.to,
    retentionDays: Math.max(
      Number(process.env.ANALYTICS_RETENTION_DAYS) || 90,
      31
    ),
    truncated,
    days: aggregateInsights(events, books, range),
    catalog: summarizeCatalog(books),
  };
};

module.exports = {
  InsightsRangeError,
  MAX_RANGE_DAYS,
  aggregateInsights,
  bearerToken,
  loadInsights,
  parseRange,
  summarizeCatalog,
  tokenMatches,
};
