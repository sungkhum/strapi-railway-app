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
  ],
};
