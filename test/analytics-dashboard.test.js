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
      category: { name: "History" },
      authors: [{ name: "Author A" }],
      tags: [],
      chapters: [{ title: "Chapter 1" }],
      ebook: { name: "book-a.pdf" },
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
      category: null,
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
  assert.equal(result.categories[0].name, "History");
  assert.equal(result.contentHealth.withEnglishDescription, 1);
  assert.equal(result.contentHealth.withAudio, 1);
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
  assert.deepEqual(result.categories, []);
});
