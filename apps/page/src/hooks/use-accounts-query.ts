import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

export const useAccountsQuery = () =>
  useQuery({
    queryKey: ["accounts"],
    queryFn: async () => unwrap(await api.api.accounts.get()),
  });
