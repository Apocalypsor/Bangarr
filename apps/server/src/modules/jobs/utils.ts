import type { Job } from "@server/modules/jobs/types";

export const scanReport = (result: Job["result"]) => {
  const value = result?.scan;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const report = value as Record<string, unknown>;
  const issues = Array.isArray(report.issues) ? report.issues : [];

  return {
    scanned: count(report.scanned),
    queued: count(report.queued),
    skipped: count(report.skipped),
    failedItems: count(report.failedItems),
    failedLibraries: count(report.failedLibraries),
    issuesOmitted: count(report.issuesOmitted),
    issues: issues.slice(0, 100).flatMap((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return [];
      const issue = value as Record<string, unknown>;
      if (
        (issue.scope !== "item" && issue.scope !== "library") ||
        typeof issue.id !== "string" ||
        typeof issue.libraryTitle !== "string" ||
        typeof issue.message !== "string"
      )
        return [];
      return [
        {
          id: issue.id,
          scope: issue.scope,
          libraryTitle: issue.libraryTitle,
          ratingKey:
            typeof issue.ratingKey === "string" ? issue.ratingKey : null,
          title: typeof issue.title === "string" ? issue.title : null,
          message: issue.message,
        },
      ];
    }),
  };
};

const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;

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
