"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/analytics/events/batch",
      handler: "api::analytics-event.analytics-event.ingest",
      config: {
        auth: false,
      },
    },
    {
      method: "DELETE",
      path: "/analytics/installation",
      handler: "api::analytics-event.analytics-event.deleteInstallation",
      config: {
        auth: false,
      },
    },
    {
      method: "GET",
      path: "/analytics/insights",
      handler: "api::analytics-event.analytics-event.insights",
      config: {
        // The controller checks INSIGHTS_EXPORT_TOKEN itself.
        auth: false,
      },
    },
  ],
};
