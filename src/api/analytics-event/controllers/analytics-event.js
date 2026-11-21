"use strict";

const { AnalyticsValidationError } = require("../utils/contract");
const {
  InsightsRangeError,
  bearerToken,
  loadInsights,
  parseRange,
  tokenMatches,
} = require("../utils/insights");

const windows = new Map();
const WINDOW_MS = 60 * 1000;
const REQUESTS_PER_WINDOW = 120;
let lastCleanupAt = 0;

const removeExpiredWindows = (now) => {
  if (now - lastCleanupAt < WINDOW_MS) return;
  lastCleanupAt = now;
  for (const [key, window] of windows.entries()) {
    if (window.resetAt <= now) windows.delete(key);
  }
};

const consumeRateLimit = (key, now = Date.now()) => {
  removeExpiredWindows(now);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
};

module.exports = {
  async ingest(ctx) {
    if (!consumeRateLimit(`ingest:${ctx.ip}`)) {
      ctx.status = 429;
      ctx.body = { error: "Too many analytics requests" };
      return;
    }

    try {
      const result = await strapi
        .service("api::analytics-event.analytics-event")
        .ingest(ctx.request.body);
      ctx.status = 202;
      ctx.body = result;
    } catch (error) {
      if (error instanceof AnalyticsValidationError) {
        return ctx.badRequest(error.message);
      }
      strapi.log.error("Analytics ingestion failed", error);
      return ctx.internalServerError("Analytics ingestion failed");
    }
  },

  async deleteInstallation(ctx) {
    const { installationId } = ctx.request.body || {};
    if (!consumeRateLimit(`delete:${ctx.ip}`)) {
      ctx.status = 429;
      ctx.body = { error: "Too many analytics deletion requests" };
      return;
    }

    try {
      ctx.body = await strapi
        .service("api::analytics-event.analytics-event")
        .deleteInstallation(installationId);
    } catch (error) {
      if (error instanceof AnalyticsValidationError) {
        return ctx.badRequest(error.message);
      }
      strapi.log.error("Analytics deletion failed", error);
      return ctx.internalServerError("Analytics deletion failed");
    }
  },

  /**
   * Daily aggregates for the reporting dashboard. Off until INSIGHTS_EXPORT_TOKEN is set;
   * the caller must send that token as a bearer token.
   */
  async insights(ctx) {
    const expected = process.env.INSIGHTS_EXPORT_TOKEN;
    if (!expected) {
      ctx.status = 503;
      ctx.body = { error: "The insights export is not enabled" };
      return;
    }
    if (!consumeRateLimit(`insights:${ctx.ip}`)) {
      ctx.status = 429;
      ctx.body = { error: "Too many insights requests" };
      return;
    }
    if (!tokenMatches(bearerToken(ctx.request.headers.authorization), expected)) {
      return ctx.unauthorized("A valid insights token is required");
    }

    try {
      ctx.set("Cache-Control", "no-store");
      ctx.body = await loadInsights(strapi, parseRange(ctx.query));
    } catch (error) {
      if (error instanceof InsightsRangeError) {
        return ctx.badRequest(error.message);
      }
      strapi.log.error("Analytics insights export failed", error);
      return ctx.internalServerError("Analytics insights export failed");
    }
  },
};

module.exports.consumeRateLimit = consumeRateLimit;
