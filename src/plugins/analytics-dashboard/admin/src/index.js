import { ChartPie } from "@strapi/icons";

import pluginPermissions from "./permissions";

const pluginId = "analytics-dashboard";

export default {
  register(app) {
    app.addMenuLink({
      to: `plugins/${pluginId}`,
      icon: ChartPie,
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: "Analytics",
      },
      Component: () => import("./pages/Dashboard"),
      permissions: pluginPermissions.readDashboard,
      position: 4,
    });

    app.registerPlugin({
      id: pluginId,
      name: "Analytics",
    });
  },
};
