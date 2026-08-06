"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const createAnalyticsService = require("../src/plugins/analytics-dashboard/server/src/services/analytics");

const createStrapi = ({ books = [], counts = {} } = {}) => ({
  documents(uid) {
    return {
      async findMany(params) {
        assert.equal(uid, "api::book.book");
        assert.equal(params.status, "published");
        assert.ok(params.populate.categories);
        assert.equal(params.populate.category, undefined);
        return books;
      },
      async count(params) {
        assert.ok(["draft", "published"].includes(params.status));
        return counts[uid] || 0;
      },
    };
  },
});

test("aggregates lifetime engagement, coverage, and rankings", async () => {
  const books = [
    {
      documentId: "book-a",
      title: "Book A",
      description_en: "English summary",
      views: "100",
      audio_plays: "25",
      book_opens: "10",
      downloads: "5",
      updatedAt: "2026-08-05T00:00:00.000Z",
      categories: [{ name: "History" }, { name: "Faith" }],
      authors: [{ name: "Author A" }],
      tags: [],
      chapters: [{ title: "Chapter 1" }],
      ebook: { name: "book-a.pdf" },
      purchase_url: "https://example.com/book-a",
      is_featured: true,
    },
    {
      documentId: "book-b",
      title: "Book B",
      views: "50",
      audio_plays: "5",
      book_opens: "5",
      downloads: null,
      updatedAt: "2026-08-04T00:00:00.000Z",
      categories: [],
      authors: [],
      tags: [{ name: "Popular" }],
      chapters: [],
      ebook: null,
      is_new_arrival: true,
    },
  ];
  const strapi = createStrapi({
    books,
    counts: {
      "api::book.book": 3,
      "api::category.category": 4,
      "api::author.author": 2,
      "api::tag.tag": 5,
    },
  });

  const result = await createAnalyticsService({ strapi }).overview();

  assert.deepEqual(result.totals, {
    views: 150,
    audioPlays: 30,
    bookOpens: 15,
    downloads: 5,
    engagement: 200,
    chapters: 1,
    books: 3,
    publishedBooks: 2,
    unpublishedBooks: 1,
    categories: 4,
    authors: 2,
    tags: 5,
  });
  assert.deepEqual(result.rates, {
    audioPlayPerView: 20,
    bookOpenPerView: 10,
    downloadPerView: 3.3,
  });
  assert.equal(result.topBooks[0].documentId, "book-a");
  assert.deepEqual(result.topBooks[0].categories, ["History", "Faith"]);
  assert.equal(result.rankings.categories[0].name, "History");
  assert.equal(result.rankings.authors[0].name, "Author A");
  assert.equal(result.rankings.tags[0].name, "Untagged");
  assert.equal(result.opportunities[0].documentId, "book-b");
  assert.deepEqual(result.insights, {
    activeBooks: 2,
    inactiveBooks: 0,
    activeBookRate: 100,
    averageEngagementPerBook: 100,
    medianEngagementPerBook: 100,
    topTenShare: 100,
  });
  assert.equal(
    result.distribution.find((bucket) => bucket.key === "strong").books,
    2
  );
  assert.equal(result.segments.length, 6);
  assert.equal(
    result.segments.find((segment) => segment.key === "audio")
      .engagementPerBook,
    140
  );
  assert.equal(result.contentHealth.withEnglishDescription, 1);
  assert.equal(result.contentHealth.withCategories, 1);
  assert.equal(result.contentHealth.withAudio, 1);
  assert.equal(result.contentHealth.withPurchaseLink, 1);
  assert.equal(result.contentHealth.featured, 1);
  assert.equal(result.contentHealth.newArrivals, 1);
});

test("returns stable zero values for an empty catalog", async () => {
  const result = await createAnalyticsService({
    strapi: createStrapi(),
  }).overview();

  assert.equal(result.totals.engagement, 0);
  assert.equal(result.totals.unpublishedBooks, 0);
  assert.deepEqual(result.rates, {
    audioPlayPerView: 0,
    bookOpenPerView: 0,
    downloadPerView: 0,
  });
  assert.deepEqual(result.topBooks, []);
  assert.deepEqual(result.rankings.categories, []);
  assert.deepEqual(result.rankings.authors, []);
  assert.deepEqual(result.rankings.tags, []);
  assert.deepEqual(result.opportunities, []);
  assert.equal(result.insights.activeBookRate, 0);
});
