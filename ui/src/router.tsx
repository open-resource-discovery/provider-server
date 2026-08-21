import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { StatusHubPage } from "./pages/StatusHubPage";
import { ExplorerViewPage } from "./pages/ExplorerViewPage";

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: (): typeof rootRoute => rootRoute,
  path: "/",
  beforeLoad: (): never => {
    throw redirect({ to: "/status" });
  },
  component: (): null => null,
});

const statusRoute = createRoute({
  getParentRoute: (): typeof rootRoute => rootRoute,
  path: "/status",
  component: StatusHubPage,
});

const explorerRoute = createRoute({
  getParentRoute: (): typeof rootRoute => rootRoute,
  path: "/status/$perspId",
  component: ExplorerViewPage,
});

const routeTree = rootRoute.addChildren([indexRoute, statusRoute, explorerRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
