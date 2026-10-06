import { api, unwrap } from "@page/lib/api";
import { useQuery } from "@tanstack/react-query";

export type Settings = Parameters<typeof api.api.settings.put>[0];

export type PublicSettings = NonNullable<
  Awaited<ReturnType<typeof api.api.settings.get>>["data"]
>;

export type UpdateSettings = <K extends keyof Settings>(
  section: K,
  patch: Partial<Settings[K]>,
) => void;

export const useSettingsQuery = () =>
  useQuery({
    queryKey: ["settings"],
    queryFn: async () => unwrap(await api.api.settings.get()),
  });

export const useWebhookQuery = () =>
  useQuery({
    queryKey: ["webhook"],
    queryFn: async () => unwrap(await api.api.settings.webhook.get()),
    enabled: true,
  });
