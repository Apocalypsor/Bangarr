import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

export const useCatalogQuery = () =>
  useQuery({
    queryKey: ["catalog"],
    queryFn: async () => unwrap(await api.api.catalog.get()),
    refetchInterval: 5000,
  });
