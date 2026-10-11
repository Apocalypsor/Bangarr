import { api, unwrap } from "@page/lib/api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

type JobsQuery = NonNullable<
  NonNullable<Parameters<typeof api.api.jobs.get>[0]>["query"]
>;
export type JobFilters = Pick<JobsQuery, "kind"> & {
  state?: Extract<
    JobsQuery["state"],
    "waiting" | "running" | "retrying" | "failed"
  >;
};

export const useJobsQuery = (filters: JobFilters, page: number) =>
  useQuery({
    queryKey: ["jobs", filters, page],
    queryFn: async () =>
      unwrap(
        await api.api.jobs.get({
          query: {
            ...filters,
            state: filters.state ?? "active",
            offset: page * 30,
            limit: 30,
          },
        }),
      ),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
