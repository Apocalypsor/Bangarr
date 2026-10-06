import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

export const usePlexLibrariesQuery = () =>
  useQuery({
    queryKey: ["plex-libraries"],
    queryFn: async () => unwrap(await api.api.plex.libraries.get()),
    enabled: false,
    retry: false,
  });
