import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

export const useSessionQuery = () =>
  useQuery({
    queryKey: ["session"],
    queryFn: async () => unwrap(await api.api.auth.status.get()),
  });
