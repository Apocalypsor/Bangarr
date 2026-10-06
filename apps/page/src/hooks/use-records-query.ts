import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

type RecordsRequestQuery = NonNullable<
  NonNullable<Parameters<typeof api.api.records.get>[0]>["query"]
>;

export type RecordFilters = Pick<
  RecordsRequestQuery,
  "search" | "userName" | "from" | "to" | "status" | "mediaType"
>;

interface RecordsQueryOptions {
  page: number;
  filters: RecordFilters;
}

export const useRecordsQuery = ({ page, filters }: RecordsQueryOptions) =>
  useQuery({
    queryKey: ["records", page, filters],
    queryFn: async () =>
      unwrap(
        await api.api.records.get({
          query: {
            offset: page * 30,
            limit: 30,
            ...filters,
          },
        }),
      ),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });

export const useRecordQuery = (detail: string | null) =>
  useQuery({
    queryKey: ["record-detail", detail],
    enabled: Boolean(detail),
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () =>
      unwrap(await api.api.records({ id: detail ?? "" }).get()),
  });
