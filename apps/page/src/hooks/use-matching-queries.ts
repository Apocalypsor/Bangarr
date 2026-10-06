import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

export const useMappingsQuery = () =>
  useQuery({
    queryKey: ["mappings"],
    queryFn: async () => unwrap(await api.api.mappings.get()),
  });

export const useCandidatesQuery = () =>
  useQuery({
    queryKey: ["candidates"],
    queryFn: async () => unwrap(await api.api.candidates.get()),
    refetchInterval: 15_000,
  });
