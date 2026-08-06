"use strict";

const BOOK_UID = "api::book.book";
const ANALYTICS_EVENT_UID = "api::analytics-event.analytics-event";
const FIRST_PARTY_DAYS = 30;

const DISTRIBUTION_BUCKETS = [
  { key: "none", label: "No signal", min: 0, max: 0 },
  { key: "light", label: "1–9", min: 1, max: 9 },
  { key: "building", label: "10–49", min: 10, max: 49 },
  { key: "strong", label: "50–199", min: 50, max: 199 },
  { key: "leading", label: "200+", min: 200, max: Infinity },
];

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const percentage = (numerator, denominator) =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;

const average = (total, count) =>
  count > 0 ? Number((total / count).toFixed(1)) : 0;

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
};

const relationNames = (items, fallback) => {
  const names = (items || [])
    .map((item) => item?.name?.trim())
    .filter(Boolean);
  return names.length ? [...new Set(names)] : [fallback];
};

const summarizeBook = (book) => {
  const views = asNumber(book.views);
  const audioPlays = asNumber(book.audio_plays);
  const bookOpens = asNumber(book.book_opens);
  const downloads = asNumber(book.downloads);
  const downstreamActions = audioPlays + bookOpens + downloads;

  return {
    documentId: book.documentId,
    title: book.title || "Untitled book",
    categories: relationNames(book.categories, "Uncategorized"),
    authors: relationNames(book.authors, "No author"),
    tags: relationNames(book.tags, "Untagged"),
    views,
    audioPlays,
    bookOpens,
    downloads,
    downstreamActions,
    engagement: views + downstreamActions,
    depthRate: percentage(downstreamActions, views),
    updatedAt: book.updatedAt,
    isFeatured: Boolean(book.is_featured),
    isNewArrival: Boolean(book.is_new_arrival),
    hasAudio: Boolean(book.chapters?.length || book.youtube_playlist),
    hasEbook: Boolean(book.ebook),
    hasPurchaseLink: Boolean(book.purchase_url),
    chapterCount: book.chapters?.length || 0,
  };
};

const aggregateDimension = (books, key) => {
  const groups = new Map();

  books.forEach((book) => {
    book[key].forEach((name) => {
      const group = groups.get(name) || {
        name,
        books: 0,
        engagement: 0,
        views: 0,
        downstreamActions: 0,
      };

      group.books += 1;
      group.engagement += book.engagement;
      group.views += book.views;
      group.downstreamActions += book.downstreamActions;
      groups.set(name, group);
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      engagementPerBook: average(group.engagement, group.books),
      depthRate: percentage(group.downstreamActions, group.views),
    }))
    .sort(
      (left, right) =>
        right.engagement - left.engagement || right.views - left.views
    );
};

const aggregateSegment = (key, label, books) => {
  const engagement = books.reduce((total, book) => total + book.engagement, 0);
  const views = books.reduce((total, book) => total + book.views, 0);
  const downstreamActions = books.reduce(
    (total, book) => total + book.downstreamActions,
    0
  );

  return {
    key,
    label,
    books: books.length,
    engagement,
    engagementPerBook: average(engagement, books.length),
    depthRate: percentage(downstreamActions, views),
  };
};

const isoDay = (value) => new Date(value).toISOString().slice(0, 10);

const createTrend = (now) => {
  const result = [];
  for (let offset = FIRST_PARTY_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    result.push({
      date: isoDay(date),
      bookViews: 0,
      audioStarts: 0,
      ebookOpens: 0,
      devotionalViews: 0,
      listeningSeconds: 0,
    });
  }
  return result;
};

const aggregateFirstPartyEvents = (
  events,
  books,
  now = new Date(),
  truncated = false
) => {
  const trend = createTrend(now);
  const trendByDate = new Map(trend.map((day) => [day.date, day]));
  const activeInstallations = new Set();
  const listeners = new Set();
  const ebookReaders = new Set();
  const devotionalReaders = new Set();
  const bookStats = new Map();
  const totals = {
    events: 0,
    activeUsers: 0,
    bookViews: 0,
    audioStarts: 0,
    audioCompletions: 0,
    ebookOpens: 0,
    ebookCompletions: 0,
    devotionalViews: 0,
    devotionalEngagements: 0,
    downloadStarts: 0,
    downloadCompletions: 0,
    downloadFailures: 0,
    searches: 0,
    searchResultOpens: 0,
    notificationOpens: 0,
    bookmarks: 0,
    purchaseClicks: 0,
    listeningSeconds: 0,
    listeningHours: 0,
    listeners: 0,
    ebookReaders: 0,
    devotionalReaders: 0,
  };

  events.forEach((event) => {
    totals.events += 1;
    if (event.installationIdHash) {
      activeInstallations.add(event.installationIdHash);
    }

    const day = trendByDate.get(isoDay(event.occurredAt));
    const bookId = event.bookDocumentId;
    const book = bookId
      ? bookStats.get(bookId) || {
          documentId: bookId,
          views: 0,
          audioStarts: 0,
          audioCompletions: 0,
          ebookOpens: 0,
          ebookCompletions: 0,
          downloadCompletions: 0,
          listeningSeconds: 0,
        }
      : null;

    switch (event.eventName) {
      case "book_detail_viewed":
        totals.bookViews += 1;
        if (day) day.bookViews += 1;
        if (book) book.views += 1;
        break;
      case "audio_play_started":
        totals.audioStarts += 1;
        if (day) day.audioStarts += 1;
        if (book) book.audioStarts += 1;
        if (event.installationIdHash) {
          listeners.add(event.installationIdHash);
        }
        break;
      case "audio_play_ended": {
        const activeSeconds = asNumber(event.activeSeconds);
        totals.listeningSeconds += activeSeconds;
        if (day) day.listeningSeconds += activeSeconds;
        if (book) book.listeningSeconds += activeSeconds;
        break;
      }
      case "audio_completed":
        totals.audioCompletions += 1;
        if (book) book.audioCompletions += 1;
        break;
      case "ebook_opened":
        totals.ebookOpens += 1;
        if (day) day.ebookOpens += 1;
        if (book) book.ebookOpens += 1;
        if (event.installationIdHash) {
          ebookReaders.add(event.installationIdHash);
        }
        break;
      case "ebook_completed":
        totals.ebookCompletions += 1;
        if (book) book.ebookCompletions += 1;
        break;
      case "devotional_viewed":
        totals.devotionalViews += 1;
        if (day) day.devotionalViews += 1;
        if (event.installationIdHash) {
          devotionalReaders.add(event.installationIdHash);
        }
        break;
      case "devotional_engaged":
        totals.devotionalEngagements += 1;
        break;
      case "book_download_started":
        totals.downloadStarts += 1;
        break;
      case "book_download_completed":
        totals.downloadCompletions += 1;
        if (book) book.downloadCompletions += 1;
        break;
      case "book_download_failed":
        totals.downloadFailures += 1;
        break;
      case "search_performed":
        totals.searches += 1;
        break;
      case "search_result_opened":
        totals.searchResultOpens += 1;
        break;
      case "notification_opened":
        totals.notificationOpens += 1;
        break;
      case "bookmark_created":
        totals.bookmarks += 1;
        break;
      case "purchase_link_opened":
        totals.purchaseClicks += 1;
        break;
      default:
        break;
    }

    if (book) bookStats.set(bookId, book);
  });

  totals.activeUsers = activeInstallations.size;
  totals.listeners = listeners.size;
  totals.ebookReaders = ebookReaders.size;
  totals.devotionalReaders = devotionalReaders.size;
  totals.listeningHours = Number(
    (totals.listeningSeconds / 3600).toFixed(1)
  );

  const bookMetadata = new Map(books.map((book) => [book.documentId, book]));
  const topBooks = Array.from(bookStats.values())
    .map((book) => {
      const metadata = bookMetadata.get(book.documentId);
      return {
        ...book,
        title: metadata?.title || "Unknown book",
        categories: metadata?.categories || ["Uncategorized"],
        listeningHours: Number((book.listeningSeconds / 3600).toFixed(1)),
        engagement:
          book.views +
          book.audioStarts +
          book.audioCompletions +
          book.ebookOpens +
          book.ebookCompletions +
          book.downloadCompletions,
      };
    })
    .sort(
      (left, right) =>
        right.engagement - left.engagement ||
        right.listeningSeconds - left.listeningSeconds
    )
    .slice(0, 10);

  return {
    available: true,
    truncated,
    periodDays: FIRST_PARTY_DAYS,
    totals,
    rates: {
      audioStartPerView: percentage(totals.audioStarts, totals.bookViews),
      audioCompletionRate: percentage(
        totals.audioCompletions,
        totals.audioStarts
      ),
      ebookOpenPerView: percentage(totals.ebookOpens, totals.bookViews),
      ebookCompletionRate: percentage(
        totals.ebookCompletions,
        totals.ebookOpens
      ),
      devotionalEngagementRate: percentage(
        totals.devotionalEngagements,
        totals.devotionalViews
      ),
      downloadCompletionRate: percentage(
        totals.downloadCompletions,
        totals.downloadStarts
      ),
    },
    trend,
    topBooks,
  };
};

module.exports = ({ strapi }) => ({
  async overview() {
    const [books, totalDocuments, categories, authors, tags] = await Promise.all([
      strapi.documents(BOOK_UID).findMany({
        status: "published",
        fields: [
          "title",
          "description_en",
          "youtube_playlist",
          "purchase_url",
          "views",
          "audio_plays",
          "book_opens",
          "downloads",
          "updatedAt",
          "is_featured",
          "is_new_arrival",
        ],
        populate: {
          categories: { fields: ["name"] },
          authors: { fields: ["name"] },
          tags: { fields: ["name"] },
          chapters: { fields: ["title"] },
          ebook: { fields: ["name"] },
        },
      }),
      strapi.documents(BOOK_UID).count({ status: "draft" }),
      strapi
        .documents("api::category.category")
        .count({ status: "published" }),
      strapi.documents("api::author.author").count({ status: "published" }),
      strapi.documents("api::tag.tag").count({ status: "published" }),
    ]);

    const summarizedBooks = books.map(summarizeBook);
    const totals = summarizedBooks.reduce(
      (result, book) => {
        result.views += book.views;
        result.audioPlays += book.audioPlays;
        result.bookOpens += book.bookOpens;
        result.downloads += book.downloads;
        result.engagement += book.engagement;
        result.chapters += book.chapterCount;
        return result;
      },
      {
        views: 0,
        audioPlays: 0,
        bookOpens: 0,
        downloads: 0,
        engagement: 0,
        chapters: 0,
      }
    );

    const contentHealth = books.reduce(
      (result, book) => {
        if (book.description_en?.trim()) result.withEnglishDescription += 1;
        if (book.categories?.length) result.withCategories += 1;
        if (book.authors?.length) result.withAuthors += 1;
        if (book.tags?.length) result.withTags += 1;
        if (book.ebook) result.withEbook += 1;
        if (book.chapters?.length || book.youtube_playlist) result.withAudio += 1;
        if (book.purchase_url) result.withPurchaseLink += 1;
        if (book.is_featured) result.featured += 1;
        if (book.is_new_arrival) result.newArrivals += 1;
        return result;
      },
      {
        withEnglishDescription: 0,
        withCategories: 0,
        withAuthors: 0,
        withTags: 0,
        withEbook: 0,
        withAudio: 0,
        withPurchaseLink: 0,
        featured: 0,
        newArrivals: 0,
      }
    );

    const publishedBooks = summarizedBooks.length;
    const sortedByEngagement = [...summarizedBooks].sort(
      (left, right) =>
        right.engagement - left.engagement || right.views - left.views
    );
    const activeBooks = summarizedBooks.filter(
      (book) => book.engagement > 0
    ).length;
    const topTenEngagement = sortedByEngagement
      .slice(0, 10)
      .reduce((total, book) => total + book.engagement, 0);

    const rankings = {
      categories: aggregateDimension(summarizedBooks, "categories").slice(0, 8),
      authors: aggregateDimension(summarizedBooks, "authors").slice(0, 8),
      tags: aggregateDimension(summarizedBooks, "tags").slice(0, 8),
    };

    const distribution = DISTRIBUTION_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      books: summarizedBooks.filter(
        (book) =>
          book.engagement >= bucket.min && book.engagement <= bucket.max
      ).length,
    }));

    const segments = [
      aggregateSegment(
        "audio",
        "Audio available",
        summarizedBooks.filter((book) => book.hasAudio)
      ),
      aggregateSegment(
        "no-audio",
        "No audio",
        summarizedBooks.filter((book) => !book.hasAudio)
      ),
      aggregateSegment(
        "ebook",
        "eBook available",
        summarizedBooks.filter((book) => book.hasEbook)
      ),
      aggregateSegment(
        "no-ebook",
        "No eBook",
        summarizedBooks.filter((book) => !book.hasEbook)
      ),
      aggregateSegment(
        "featured",
        "Featured",
        summarizedBooks.filter((book) => book.isFeatured)
      ),
      aggregateSegment(
        "standard",
        "Not featured",
        summarizedBooks.filter((book) => !book.isFeatured)
      ),
    ];

    const opportunities = summarizedBooks
      .filter((book) => book.views > 0)
      .sort(
        (left, right) =>
          right.views / (right.downstreamActions + 1) -
            left.views / (left.downstreamActions + 1) ||
          right.views - left.views
      )
      .slice(0, 5);

    let firstPartyEvents = [];
    let firstPartyTruncated = false;
    if (strapi.db?.query) {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - FIRST_PARTY_DAYS);
      firstPartyEvents = await strapi.db.query(ANALYTICS_EVENT_UID).findMany({
        where: {
          occurredAt: {
            $gte: since.toISOString(),
          },
        },
        select: [
          "eventName",
          "installationIdHash",
          "occurredAt",
          "bookDocumentId",
          "activeSeconds",
        ],
        orderBy: { occurredAt: "desc" },
        limit: 100001,
      });
      firstPartyTruncated = firstPartyEvents.length > 100000;
      if (firstPartyTruncated) firstPartyEvents.length = 100000;
    }

    return {
      generatedAt: new Date().toISOString(),
      scope: "lifetime",
      firstParty: aggregateFirstPartyEvents(
        firstPartyEvents,
        summarizedBooks,
        new Date(),
        firstPartyTruncated
      ),
      totals: {
        ...totals,
        books: totalDocuments,
        publishedBooks,
        unpublishedBooks: Math.max(totalDocuments - publishedBooks, 0),
        categories: asNumber(categories),
        authors: asNumber(authors),
        tags: asNumber(tags),
      },
      rates: {
        audioPlayPerView: percentage(totals.audioPlays, totals.views),
        bookOpenPerView: percentage(totals.bookOpens, totals.views),
        downloadPerView: percentage(totals.downloads, totals.views),
      },
      insights: {
        activeBooks,
        inactiveBooks: publishedBooks - activeBooks,
        activeBookRate: percentage(activeBooks, publishedBooks),
        averageEngagementPerBook: average(totals.engagement, publishedBooks),
        medianEngagementPerBook: median(
          summarizedBooks.map((book) => book.engagement)
        ),
        topTenShare: percentage(topTenEngagement, totals.engagement),
      },
      contentHealth,
      rankings,
      distribution,
      segments,
      opportunities,
      topBooks: sortedByEngagement.slice(0, 10),
      recentlyUpdated: [...summarizedBooks]
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime()
        )
        .slice(0, 5),
    };
  },
});

module.exports.aggregateFirstPartyEvents = aggregateFirstPartyEvents;
