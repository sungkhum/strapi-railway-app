"use strict";

const { AnalyticsValidationError } = require("../utils/contract");
const {
  InsightsRangeError,
  bearerToken,
  exportToken,
  loadInsights,
  parseRange,
  tokenMatches,
} = require("../utils/insights");

const windows = new Map();
const WINDOW_MS = 60 * 1000;
const REQUESTS_PER_WINDOW = 120;
const EXPORTS_PER_WINDOW = 30;
const DENIED_PER_WINDOW = 10;
let lastCleanupAt = 0;
let exporting = false;

const removeExpiredWindows = (now) => {
  if (now - lastCleanupAt < WINDOW_MS) return;
  lastCleanupAt = now;
  for (const [key, window] of windows.entries()) {
    if (window.resetAt <= now) windows.delete(key);
  }
};

const consumeRateLimit = (
  key,
  now = Date.now(),
  limit = REQUESTS_PER_WINDOW
) => {
  removeExpiredWindows(now);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
};

/**
 * The address to count attempts against. The platform's proxy sets X-Real-IP itself, while
 * the first X-Forwarded-For entry, which `ctx.ip` reads, is whatever the caller sent.
 */
const callerAddress = (ctx) => {
  const real = ctx.request.headers["x-real-ip"];
  const value = (Array.isArray(real) ? real[0] : real) || ctx.ip || "unknown";
  return String(value).trim().slice(0, 64);
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
   * Daily aggregates for the reporting dashboard: read-only, and closed unless
   * INSIGHTS_EXPORT_TOKEN holds a strong token that the caller sends as a bearer token.
   */
  async insights(ctx) {
    ctx.set("Cache-Control", "no-store");
    ctx.set("X-Content-Type-Options", "nosniff");

    const expected = exportToken(process.env.INSIGHTS_EXPORT_TOKEN);
    // While it is off, the route answers like any unknown path.
    if (!expected) return ctx.notFound();

    const address = callerAddress(ctx);
    const given = bearerToken(ctx.request.headers.authorization);
    if (!tokenMatches(given, expected)) {
      // Wrong tokens get their own small budget, so guessing is slow and cannot
      // use up the allowance of the real caller.
      const allowed = consumeRateLimit(
        `insights-denied:${address}`,
        Date.now(),
        DENIED_PER_WINDOW
      );
      // Logged only within the budget, so a flood cannot fill the log.
      if (allowed) {
        strapi.log.warn(`Analytics insights export refused for ${address}`);
      }
      if (!allowed) {
        ctx.status = 429;
        ctx.body = { error: "Too many insights requests" };
        return;
      }
      return ctx.unauthorized("A valid insights token is required");
    }

    if (
      !consumeRateLimit(`insights:${address}`, Date.now(), EXPORTS_PER_WINDOW) ||
      exporting
    ) {
      ctx.status = 429;
      ctx.body = { error: "Too many insights requests" };
      return;
    }

    let range;
    try {
      range = parseRange(ctx.query);
    } catch (error) {
      if (error instanceof InsightsRangeError) {
        return ctx.badRequest(error.message);
      }
      throw error;
    }

    // One export at a time: each loads weeks of events into memory.
    exporting = true;
    try {
      ctx.body = await loadInsights(strapi, range);
      strapi.log.info(
        `Analytics insights exported for ${range.from}..${range.to} to ${address}`
      );
    } catch (error) {
      strapi.log.error("Analytics insights export failed", error);
      return ctx.internalServerError("Analytics insights export failed");
    } finally {
      exporting = false;
    }
  },
};

module.exports.consumeRateLimit = consumeRateLimit;
