"use strict";

const { AnalyticsValidationError } = require("../utils/contract");

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
};

module.exports.consumeRateLimit = consumeRateLimit;
