import { router } from "@page/app/router";
import { RouterProvider as TanStackRouterProvider } from "@tanstack/react-router";

export const RouterProvider = () => <TanStackRouterProvider router={router} />;
