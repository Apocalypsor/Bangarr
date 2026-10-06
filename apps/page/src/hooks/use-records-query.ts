import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

type RecordsRequestQuery = NonNullable<
  NonNullable<Parameters<typeof api.api.records.get>[0]>["query"]
>;

export type RecordFilters = Pick<
  RecordsRequestQuery,
  "search" | "userName" | "from" | "to"
>;

interface RecordsQueryOptions {
  page: number;
  filters: RecordFilters;
  status: string;
  mediaType: string;
}

export const useRecordsQuery = ({
  page,
  filters,
  status,
  mediaType,
}: RecordsQueryOptions) =>
  useQuery({
    queryKey: ["records", page, filters, status, mediaType],
    queryFn: async () =>
      unwrap(
        await api.api.records.get({
          query: {
            offset: page * 30,
            limit: 30,
            ...filters,
            status: status === "all" ? undefined : status,
            mediaType:
              mediaType === "all"
                ? undefined
                : (mediaType as "movie" | "episode"),
          },
        }),
      ),
    placeholderData: (previous) => previous,
  });

export const useRecordQuery = (detail: string | null) =>
  useQuery({
    queryKey: ["record-detail", detail],
    enabled: Boolean(detail),
    queryFn: async () =>
      unwrap(await api.api.records({ id: detail ?? "" }).get()),
  });
