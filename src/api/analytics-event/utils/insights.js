"use strict";

const crypto = require("node:crypto");

const { readInsightRows } = require("./insights-queries");

const BOOK_UID = "api::book.book";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Retention defaults to 90 days, so one request can cover everything the backend still holds. */
const MAX_RANGE_DAYS = 124;
/** Rolling 28-day counts need the 27 days before the first reported day. */
const ROLLING_LOOKBACK_DAYS = 27;
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

/** The per-book counter each event adds to. Everything else about a book stays out. */
const BOOK_COUNTERS = {
  book_detail_viewed: "views",
  audio_play_started: "audioStarts",
  audio_completed: "audioCompletions",
  ebook_opened: "ebookOpens",
  ebook_completed: "ebookCompletions",
  book_download_completed: "downloads",
  purchase_link_opened: "purchaseClicks",
  bookmark_created: "bookmarks",
};

const emptyBook = (documentId, title) => ({
  documentId,
  title,
  views: 0,
  audioStarts: 0,
  audioCompletions: 0,
  ebookOpens: 0,
  ebookCompletions: 0,
  downloads: 0,
  purchaseClicks: 0,
  bookmarks: 0,
  listeningSeconds: 0,
});

const bookActivity = (book) =>
  book.views +
  book.audioStarts +
  book.audioCompletions +
  book.ebookOpens +
  book.ebookCompletions +
  book.downloads +
  book.purchaseClicks +
  book.bookmarks;

/** Adds `count` to `target[outer][inner]`, creating the levels as needed. */
const nest = (target, outer, inner, count) => {
  const level = target[outer] || (target[outer] = {});
  level[inner] = (level[inner] || 0) + count;
};

/**
 * Turns the database's grouped counts into one summary per UTC day. Only counts come out:
 * installation hashes are used by the database to count distinct installations and are
 * never returned.
 *
 * Book identifiers arrive from a public endpoint as free text, so only identifiers of
 * published books are reported. Other free-text fields are limited by the queries to
 * short, plain labels and to the most used values of each day.
 */
const assembleDays = (rows, books, { from, to }) => {
  const titles = new Map(books.map((book) => [book.documentId, book.title]));
  const days = new Map(
    eachDay(from, to).map((date) => [
      date,
      {
        date,
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
        devotionals: {},
        books: new Map(),
      },
    ])
  );
  const forDay = (date) => days.get(isoDay(date));

  for (const row of rows.events) {
    const day = forDay(row.day);
    if (!day) continue;
    day.events[row.event_name] = asNumber(row.count);
    if (row.event_name === "audio_play_ended") {
      day.listeningSeconds = Math.round(asNumber(row.seconds));
    }
    if (row.event_name === "audio_play_started") {
      day.audioResumes = asNumber(row.resumes);
    }
    if (row.event_name === "search_performed") {
      day.searchesWithoutResults = asNumber(row.zero_results);
    }
  }

  for (const row of rows.installs) {
    const day = forDay(row.day);
    if (!day) continue;
    day.activeInstallations = asNumber(row.today);
    day.activeInstallations7d = asNumber(row.week);
    day.activeInstallations28d = asNumber(row.month);
  }

  for (const row of rows.newInstalls) {
    const day = forDay(row.day);
    if (day) day.newInstallations = asNumber(row.count);
  }

  for (const row of rows.platforms) {
    const day = forDay(row.day);
    if (day) day.platforms[row.label] = asNumber(row.count);
  }

  for (const row of rows.appVersions) {
    const day = forDay(row.day);
    if (day) day.appVersions[row.label] = asNumber(row.count);
  }

  for (const [key, field] of [
    ["surfaces", "surfaces"],
    ["mediaSources", "mediaSources"],
    ["contentTypes", "contentTypes"],
    ["outcomes", "outcomes"],
    ["reasons", "reasons"],
  ]) {
    for (const row of rows[key]) {
      const day = forDay(row.day);
      if (day) nest(day[field], row.label, row.event_name, asNumber(row.count));
    }
  }

  for (const row of rows.progress) {
    const day = forDay(row.day);
    if (day) nest(day.progress, row.event_name, String(row.progress_percent), asNumber(row.count));
  }

  for (const row of rows.devotionals) {
    const day = forDay(row.day);
    if (!day) continue;
    const entry = day.devotionals[row.label] || { id: row.label, views: 0, engagements: 0 };
    if (row.event_name === "devotional_viewed") entry.views += asNumber(row.count);
    else if (row.event_name === "devotional_engaged") entry.engagements += asNumber(row.count);
    day.devotionals[row.label] = entry;
  }

  for (const row of rows.bookEvents) {
    const day = forDay(row.day);
    if (!day || !titles.has(row.book_document_id)) continue;
    const book =
      day.books.get(row.book_document_id) ||
      emptyBook(row.book_document_id, titles.get(row.book_document_id) || "Untitled book");
    if (row.event_name === "audio_play_ended") {
      book.listeningSeconds += Math.round(asNumber(row.seconds));
    } else if (BOOK_COUNTERS[row.event_name]) {
      book[BOOK_COUNTERS[row.event_name]] += asNumber(row.count);
    }
    day.books.set(row.book_document_id, book);
  }

  return Array.from(days.values()).map((day) => {
    const sorted = Array.from(day.books.values()).sort(
      (left, right) =>
        bookActivity(right) - bookActivity(left) ||
        right.listeningSeconds - left.listeningSeconds ||
        left.documentId.localeCompare(right.documentId)
    );
    const { books: _books, devotionals, ...rest } = day;
    return {
      ...rest,
      devotionals: Object.values(devotionals).sort(
        (left, right) =>
          right.views + right.engagements - (left.views + left.engagements) ||
          left.id.localeCompare(right.id)
      ),
      books: sorted,
      // The first ten of `books`, kept for readers written before it listed every book.
      topBooks: sorted.slice(0, TOP_BOOKS_PER_DAY).map((book) => ({
        documentId: book.documentId,
        title: book.title,
        views: book.views,
        audioStarts: book.audioStarts,
        ebookOpens: book.ebookOpens,
      })),
    };
  });
};

const webCounters = (book) => ({
  views: asNumber(book.web_views),
  audioPlays: asNumber(book.web_audio_plays),
  bookOpens: asNumber(book.web_book_opens),
  downloads: asNumber(book.web_downloads),
});

/** Each published book's lifetime counters, busiest first, so the dashboard can rank books. */
const bookCounters = (books) =>
  books
    .map((book) => ({
      documentId: book.documentId,
      title: book.title,
      views: asNumber(book.views),
      audioPlays: asNumber(book.audio_plays),
      bookOpens: asNumber(book.book_opens),
      downloads: asNumber(book.downloads),
      // The share of each counter that came from the PlovPit website. The rest came from the app.
      web: webCounters(book),
    }))
    .filter((book) => book.views || book.audioPlays || book.bookOpens || book.downloads)
    .sort((left, right) => right.views - left.views || left.documentId.localeCompare(right.documentId));

const summarizeCatalog = (books) => ({
  publishedBooks: books.length,
  lifetime: books.reduce(
    (totals, book) => ({
      views: totals.views + asNumber(book.views),
      audioPlays: totals.audioPlays + asNumber(book.audio_plays),
      bookOpens: totals.bookOpens + asNumber(book.book_opens),
      downloads: totals.downloads + asNumber(book.downloads),
      web: Object.fromEntries(
        Object.entries(webCounters(book)).map(([key, value]) => [key, totals.web[key] + value])
      ),
    }),
    { views: 0, audioPlays: 0, bookOpens: 0, downloads: 0, web: { views: 0, audioPlays: 0, bookOpens: 0, downloads: 0 } }
  ),
  books: bookCounters(books),
});

/**
 * The read-only summary served to the reporting dashboard. Counting happens inside the
 * database, so the number of events behind a range never limits or slows what is returned.
 */
const loadInsights = async (strapi, range, now = new Date()) => {
  const books = await strapi.documents(BOOK_UID).findMany({
    status: "published",
    fields: [
      "title", "views", "audio_plays", "book_opens", "downloads",
      "web_views", "web_audio_plays", "web_book_opens", "web_downloads",
    ],
  });
  const rows = await readInsightRows(strapi.db.connection, {
    since: `${addDays(range.from, -ROLLING_LOOKBACK_DAYS)}T00:00:00.000Z`,
    from: `${range.from}T00:00:00.000Z`,
    until: `${addDays(range.to, 1)}T00:00:00.000Z`,
    bookIds: books.map((book) => book.documentId),
  });

  return {
    generatedAt: now.toISOString(),
    schemaVersion: 2,
    from: range.from,
    to: range.to,
    retentionDays: Math.max(
      Number(process.env.ANALYTICS_RETENTION_DAYS) || 90,
      31
    ),
    days: assembleDays(rows, books, range),
    catalog: summarizeCatalog(books),
  };
};

module.exports = {
  InsightsRangeError,
  MAX_RANGE_DAYS,
  assembleDays,
  bearerToken,
  exportToken,
  loadInsights,
  parseRange,
  summarizeCatalog,
  tokenMatches,
};
