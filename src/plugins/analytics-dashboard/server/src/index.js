"use strict";

const bootstrap = require("./bootstrap");
const dashboardController = require("./controllers/dashboard");
const analyticsService = require("./services/analytics");
const adminRoutes = require("./routes/admin");

module.exports = () => ({
  bootstrap,
  controllers: {
    dashboard: dashboardController,
  },
  services: {
    analytics: analyticsService,
  },
  routes: {
    admin: adminRoutes,
  },
});
