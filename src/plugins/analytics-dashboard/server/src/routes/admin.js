"use strict";

module.exports = {
  type: "admin",
  routes: [
    {
      method: "GET",
      path: "/dashboard",
      handler: "dashboard.overview",
      config: {
        policies: [
          "admin::isAuthenticatedAdmin",
          {
            name: "admin::hasPermissions",
            config: {
              actions: ["plugin::analytics-dashboard.dashboard.read"],
            },
          },
        ],
      },
    },
  ],
};
