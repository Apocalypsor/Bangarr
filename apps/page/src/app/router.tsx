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
    <ErrorState
      error={
        new Error(
          "页面暂时无法显示，请重试。若刚更新了应用，可刷新浏览器载入新版本。",
        )
      }
    />
    <Button onClick={reset}>重试页面</Button>
  </div>
);

const NotFound = () => (
  <div className="flex flex-col items-start gap-4">
    <h1 className="text-2xl font-semibold">页面不存在</h1>
    <p className="text-muted-foreground">
      地址可能已更改，请通过左侧导航继续。
    </p>
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
