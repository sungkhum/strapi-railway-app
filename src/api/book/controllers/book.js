"use strict";

/**
 * book controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController("api::book.book", ({ strapi }) => ({
  async trackView(ctx) {
    const { documentId } = ctx.params;
    const book = await strapi
      .documents("api::book.book")
      .findOne({ documentId });
    if (!book) return ctx.notFound("Book not found");

    const updated = await strapi.documents("api::book.book").update({
      documentId,
      data: { views: (book.views || 0) + 1 },
    });

    ctx.body = { views: updated.views };
  },

  async trackAudioPlay(ctx) {
    const { documentId } = ctx.params;
    const book = await strapi
      .documents("api::book.book")
      .findOne({ documentId });
    if (!book) return ctx.notFound("Book not found");

    const updated = await strapi.documents("api::book.book").update({
      documentId,
      data: { audio_plays: (book.audio_plays || 0) + 1 },
    });

    ctx.body = { audio_plays: updated.audio_plays };
  },

  async trackBookOpen(ctx) {
    const { documentId } = ctx.params;
    const book = await strapi
      .documents("api::book.book")
      .findOne({ documentId });
    if (!book) return ctx.notFound("Book not found");

    const updated = await strapi.documents("api::book.book").update({
      documentId,
      data: { book_opens: (book.book_opens || 0) + 1 },
    });

    ctx.body = { book_opens: updated.book_opens };
  },
}));
