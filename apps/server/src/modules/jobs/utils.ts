import type { Job } from "@server/modules/jobs/types";

export const taskProgress = (
  kind: string,
  state: Job["state"],
  result: Job["result"],
) => {
  if (state === "pending" || state === "cancelled") return "";
  if (!result) return "";

  if (state !== "succeeded")
    return typeof result.progress === "string" ? result.progress : "";
  if (result.skipped === true)
    return typeof result.reason === "string" ? result.reason : "已跳过";

  if (kind === "plex-scan")
    return `新增 ${Number(result.queued ?? 0)} 项，跳过 ${Number(result.skipped ?? 0)} 项`;
  if (kind === "catalog-data")
    return `已更新 ${Number(result.subjects ?? 0)} 个条目`;
  if (kind === "sync")
    return result.changed ? "观看进度已同步" : "观看进度已是最新";

  return "";
};
