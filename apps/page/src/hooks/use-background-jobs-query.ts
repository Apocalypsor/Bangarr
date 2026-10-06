import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

export const useBackgroundJobsQuery = () =>
  useQuery({
    queryKey: ["background-jobs"],
    queryFn: async () => unwrap(await api.api.jobs.get()),
    refetchInterval: 5000,
  });
