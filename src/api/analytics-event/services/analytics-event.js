"use strict";

const crypto = require("node:crypto");
const { createCoreService } = require("@strapi/strapi").factories;

const {
  validateBatch,
  validateInstallationId,
} = require("../utils/contract");

const UID = "api::analytics-event.analytics-event";

const hashInstallationId = (installationId, secret) =>
  crypto.createHmac("sha256", secret).update(installationId).digest("hex");

const analyticsSecret = (strapi) =>
  process.env.ANALYTICS_HASH_SECRET ||
  strapi.config.get("app.keys")?.[0] ||
  "development-only-analytics-secret";

module.exports = createCoreService(UID, ({ strapi }) => ({
  async ingest(payload) {
    const now = new Date();
    const { installationId, events } = validateBatch(payload, now);
    const secret = analyticsSecret(strapi);
    const installationIdHash = hashInstallationId(installationId, secret);

    const existing = await strapi.db.query(UID).findMany({
      where: {
        eventId: {
          $in: events.map((event) => event.eventId),
        },
      },
      select: ["eventId"],
    });
    const existingIds = new Set(existing.map((event) => event.eventId));
    let accepted = 0;
    let duplicates = existingIds.size;

    for (const event of events) {
      if (existingIds.has(event.eventId)) continue;

      try {
        await strapi.documents(UID).create({
          data: {
            ...event,
            installationIdHash,
            receivedAt: now.toISOString(),
          },
        });
        accepted += 1;
      } catch (error) {
        if (
          error?.code === "23505" ||
          String(error?.message).toLowerCase().includes("unique")
        ) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }

    return { accepted, duplicates };
  },

  async deleteInstallation(installationId) {
    const validatedId = validateInstallationId(installationId);
    const secret = analyticsSecret(strapi);
    const installationIdHash = hashInstallationId(validatedId, secret);

    const result = await strapi.db.query(UID).deleteMany({
      where: { installationIdHash },
    });

    return { deleted: result.count || 0 };
  },
}));

module.exports.hashInstallationId = hashInstallationId;
