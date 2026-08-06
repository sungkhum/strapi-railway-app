"use strict";

const ANALYTICS_EVENT_UID = "api::analytics-event.analytics-event";

module.exports = {
  purgeExpiredAnalyticsEvents: {
    async task({ strapi }) {
      const retentionDays = Math.max(
        Number(process.env.ANALYTICS_RETENTION_DAYS) || 90,
        31
      );
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

      const result = await strapi.db.query(ANALYTICS_EVENT_UID).deleteMany({
        where: {
          occurredAt: {
            $lt: cutoff.toISOString(),
          },
        },
      });

      if (result.count) {
        strapi.log.info(
          `Purged ${result.count} analytics events older than ${retentionDays} days`
        );
      }
    },
    options: {
      rule: "0 0 3 * * *",
      tz: "Etc/UTC",
    },
  },
};
