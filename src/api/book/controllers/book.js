"use strict";

/**
 * book controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

const BOOK_TABLE = "books";

/**
 * The PlovPit website sends `?source=web`. Its events count in the book's totals as before and
 * also in a `web_` counter, so reports can tell the website from the app.
 */
const fromWebsite = (ctx) => ctx.query?.source === "web";

async function incrementPublishedCounter(strapi, documentId, field, website = false) {
  const query = strapi.db
    .connection(BOOK_TABLE)
    .where({ document_id: documentId })
    .whereNotNull("updated_at");
  const columns = website ? { [field]: 1, [`web_${field}`]: 1 } : { [field]: 1 };

  // PostgreSQL supports RETURNING; use it to avoid a second round-trip.
  const client = String(strapi.db.connection?.client?.config?.client || "");
  if (client.includes("pg")) {
    const rows = await query.increment(columns).returning([field]);
    if (!rows?.length) return null;
    return Number(rows[0][field]) || 0;
  }

  const affected = await query.increment(columns);
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
    const views = await incrementPublishedCounter(strapi, documentId, "views", fromWebsite(ctx));
    if (views === null) return ctx.notFound("Book not found");

    ctx.body = { views };
  },

  async trackAudioPlay(ctx) {
    const { documentId } = ctx.params;
    const audio_plays = await incrementPublishedCounter(
      strapi,
      documentId,
      "audio_plays",
      fromWebsite(ctx),
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
      fromWebsite(ctx),
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
      fromWebsite(ctx),
    );
    if (downloads === null) return ctx.notFound("Book not found");

    ctx.body = { downloads };
  },
}));
