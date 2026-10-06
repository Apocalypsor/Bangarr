import { queryClient } from "@page/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

export const QueryProvider = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
