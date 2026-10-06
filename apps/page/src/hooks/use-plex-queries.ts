import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

export const usePlexAccountsQuery = () =>
  useQuery({
    queryKey: ["plex-accounts"],
    queryFn: async () => unwrap(await api.api.plex.accounts.get()),
  });
