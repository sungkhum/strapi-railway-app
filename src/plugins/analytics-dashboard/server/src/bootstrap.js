"use strict";

module.exports = async ({ strapi }) => {
  await strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: "plugins",
      displayName: "Access the analytics dashboard",
      uid: "dashboard.read",
      pluginName: "analytics-dashboard",
    },
  ]);
};
