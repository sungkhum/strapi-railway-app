"use strict";

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic. 
   */
  async bootstrap({ strapi }) {
    const connection = strapi.db.connection;
    const hasAnalyticsTable = await connection.schema.hasTable(
      "analytics_events"
    );
    if (!hasAnalyticsTable) return;

    await connection.raw(
      "CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx ON analytics_events (event_name, occurred_at)"
    );
    await connection.raw(
      "CREATE INDEX IF NOT EXISTS analytics_events_book_time_idx ON analytics_events (book_document_id, occurred_at)"
    );
    await connection.raw(
      "CREATE INDEX IF NOT EXISTS analytics_events_installation_time_idx ON analytics_events (installation_id_hash, occurred_at)"
    );
  },
};
