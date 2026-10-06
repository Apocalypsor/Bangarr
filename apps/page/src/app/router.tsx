import { Layout } from "@page/app/layout";
import { ErrorState, LoadingState } from "@page/components/page-state";
import { Button } from "@page/components/ui/button";
import {
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  Link,
  lazyRouteComponent,
} from "@tanstack/react-router";

const RouteError = ({ reset }: ErrorComponentProps) => (
  <div className="flex flex-col items-start gap-4">
    <ErrorState error={new Error("页面加载失败，请重试")} />
    <Button onClick={reset}>重试页面</Button>
  </div>
);

const NotFound = () => (
  <div className="flex flex-col items-start gap-4">
    <h1 className="text-2xl font-semibold">页面不存在</h1>
    <Button asChild>
      <Link to="/">返回同步记录</Link>
    </Button>
  </div>
);

const rootRoute = createRootRoute({ component: Layout });

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/jobs",
      component: lazyRouteComponent(
        () => import("@page/routes/jobs"),
        "JobsPage",
      ),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: lazyRouteComponent(
        () => import("@page/routes/records"),
        "RecordsPage",
      ),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/matching",
      component: lazyRouteComponent(
        () => import("@page/routes/matching"),
        "MatchingPage",
      ),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/settings",
      component: lazyRouteComponent(
        () => import("@page/routes/settings"),
        "SettingsPage",
      ),
    }),
  ]),
  defaultPreload: "intent",
  defaultPendingComponent: LoadingState,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
