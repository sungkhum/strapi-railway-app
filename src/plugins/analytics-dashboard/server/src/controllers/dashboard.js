"use strict";

module.exports = {
  async overview(ctx) {
    ctx.body = await strapi
      .plugin("analytics-dashboard")
      .service("analytics")
      .overview();
  },
};
