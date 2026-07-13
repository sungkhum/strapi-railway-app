"use strict";

/**
 * book controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

const BOOK_TABLE = "books";

async function incrementPublishedCounter(strapi, documentId, field) {
  const query = strapi.db
    .connection(BOOK_TABLE)
    .where({ document_id: documentId })
    .whereNotNull("updated_at");

  // PostgreSQL supports RETURNING; use it to avoid a second round-trip.
  const client = String(strapi.db.connection?.client?.config?.client || "");
  if (client.includes("pg")) {
    const rows = await query.increment(field, 1).returning([field]);
    if (!rows?.length) return null;
    return Number(rows[0][field]) || 0;
  }

  const affected = await query.increment(field, 1);
  if (!affected) return null;

  const row = await strapi.db
    .connection(BOOK_TABLE)
    .select(field)
    .where({ document_id: documentId })
    .whereNotNull("updated_at")
    .first();

  return row ? Number(row[field]) || 0 : null;
}

module.exports = createCoreController("api::book.book", ({ strapi }) => ({
  async trackView(ctx) {
    const { documentId } = ctx.params;
    const views = await incrementPublishedCounter(strapi, documentId, "views");
    if (views === null) return ctx.notFound("Book not found");

    ctx.body = { views };
  },

  async trackAudioPlay(ctx) {
    const { documentId } = ctx.params;
    const audio_plays = await incrementPublishedCounter(
      strapi,
      documentId,
      "audio_plays",
    );
    if (audio_plays === null) return ctx.notFound("Book not found");

    ctx.body = { audio_plays };
  },

  async trackBookOpen(ctx) {
    const { documentId } = ctx.params;
    const book_opens = await incrementPublishedCounter(
      strapi,
      documentId,
      "book_opens",
    );
    if (book_opens === null) return ctx.notFound("Book not found");

    ctx.body = { book_opens };
  },

  async trackDownload(ctx) {
    const { documentId } = ctx.params;
    const downloads = await incrementPublishedCounter(
      strapi,
      documentId,
      "downloads",
    );
    if (downloads === null) return ctx.notFound("Book not found");

    ctx.body = { downloads };
  },
}));
