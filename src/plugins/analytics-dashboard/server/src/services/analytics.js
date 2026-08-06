"use strict";

const BOOK_UID = "api::book.book";

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const percentage = (numerator, denominator) =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;

const sortByEngagement = (left, right) =>
  right.engagement - left.engagement || right.views - left.views;

const summarizeBook = (book) => {
  const views = asNumber(book.views);
  const audioPlays = asNumber(book.audio_plays);
  const bookOpens = asNumber(book.book_opens);
  const downloads = asNumber(book.downloads);

  return {
    documentId: book.documentId,
    title: book.title || "Untitled book",
    category: book.category?.name || "Uncategorized",
    views,
    audioPlays,
    bookOpens,
    downloads,
    engagement: views + audioPlays + bookOpens + downloads,
    updatedAt: book.updatedAt,
    isFeatured: Boolean(book.is_featured),
    isNewArrival: Boolean(book.is_new_arrival),
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
          "views",
          "audio_plays",
          "book_opens",
          "downloads",
          "updatedAt",
          "is_featured",
          "is_new_arrival",
        ],
        populate: {
          category: {
            fields: ["name"],
          },
          authors: {
            fields: ["name"],
          },
          tags: {
            fields: ["name"],
          },
          chapters: {
            fields: ["title"],
          },
          ebook: {
            fields: ["name"],
          },
        },
      }),
      strapi.documents(BOOK_UID).count({
        status: "draft",
      }),
      strapi.documents("api::category.category").count({
        status: "published",
      }),
      strapi.documents("api::author.author").count({
        status: "published",
      }),
      strapi.documents("api::tag.tag").count({
        status: "published",
      }),
    ]);

    const summarizedBooks = books.map(summarizeBook);
    const totals = summarizedBooks.reduce(
      (result, book) => ({
        views: result.views + book.views,
        audioPlays: result.audioPlays + book.audioPlays,
        bookOpens: result.bookOpens + book.bookOpens,
        downloads: result.downloads + book.downloads,
        engagement: result.engagement + book.engagement,
      }),
      {
        views: 0,
        audioPlays: 0,
        bookOpens: 0,
        downloads: 0,
        engagement: 0,
      }
    );

    const categoryMap = new Map();
    summarizedBooks.forEach((book) => {
      const current = categoryMap.get(book.category) || {
        name: book.category,
        books: 0,
        engagement: 0,
        views: 0,
      };

      current.books += 1;
      current.engagement += book.engagement;
      current.views += book.views;
      categoryMap.set(book.category, current);
    });

    const contentHealth = books.reduce(
      (result, book) => {
        if (book.description_en?.trim()) result.withEnglishDescription += 1;
        if (book.category) result.withCategory += 1;
        if (book.authors?.length) result.withAuthors += 1;
        if (book.tags?.length) result.withTags += 1;
        if (book.ebook) result.withEbook += 1;
        if (book.chapters?.length || book.youtube_playlist) result.withAudio += 1;
        if (book.is_featured) result.featured += 1;
        if (book.is_new_arrival) result.newArrivals += 1;
        return result;
      },
      {
        withEnglishDescription: 0,
        withCategory: 0,
        withAuthors: 0,
        withTags: 0,
        withEbook: 0,
        withAudio: 0,
        featured: 0,
        newArrivals: 0,
      }
    );

    const publishedBooks = books.length;

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
      contentHealth,
      topBooks: summarizedBooks.sort(sortByEngagement).slice(0, 10),
      categories: Array.from(categoryMap.values())
        .sort((left, right) => right.engagement - left.engagement)
        .slice(0, 8),
      recentlyUpdated: summarizedBooks
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime()
        )
        .slice(0, 5),
    };
  },
});
