"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

// The controller only needs Strapi's factory, so stand it in without loading Strapi.
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "@strapi/strapi") return { factories: { createCoreController: (_uid, build) => build } };
  return load.call(this, request, ...rest);
};
const build = require("../src/api/book/controllers/book");
Module._load = load;

/** A Postgres-flavoured query builder that records each increment. */
function fakeStrapi(found = true) {
  const increments = [];
  const connection = () => {
    const query = {
      where: () => query,
      whereNotNull: () => query,
      increment(columns) {
        increments.push(columns);
        return { returning: async ([field]) => (found ? [{ [field]: "42" }] : []) };
      },
    };
    return query;
  };
  connection.client = { config: { client: "pg" } };
  return { strapi: { db: { connection } }, increments };
}

const ctx = (query = {}) => ({ params: { documentId: "book-a" }, query, notFound: (message) => ({ notFound: message }) });

test("counts app events in the book's totals only", async () => {
  const { strapi, increments } = fakeStrapi();
  const controller = build({ strapi });
  const call = ctx();
  await controller.trackDownload(call);
  assert.deepEqual(increments, [{ downloads: 1 }]);
  assert.deepEqual(call.body, { downloads: 42 });
});

test("counts website events in the totals and in the website's own counters", async () => {
  const { strapi, increments } = fakeStrapi();
  const controller = build({ strapi });
  for (const action of ["trackView", "trackAudioPlay", "trackBookOpen", "trackDownload"]) {
    await controller[action](ctx({ source: "web" }));
  }
  assert.deepEqual(increments, [
    { views: 1, web_views: 1 },
    { audio_plays: 1, web_audio_plays: 1 },
    { book_opens: 1, web_book_opens: 1 },
    { downloads: 1, web_downloads: 1 },
  ]);
});

test("ignores other sources and reports a missing book", async () => {
  const { strapi, increments } = fakeStrapi(false);
  const controller = build({ strapi });
  const call = ctx({ source: "web_views" });
  await controller.trackAudioPlay(call);
  assert.deepEqual(increments, [{ audio_plays: 1 }]);
  assert.equal(call.body, undefined);
});
