"use strict";

const BOOK_UID = "api::book.book";

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

    return {
      generatedAt: new Date().toISOString(),
      scope: "lifetime",
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
