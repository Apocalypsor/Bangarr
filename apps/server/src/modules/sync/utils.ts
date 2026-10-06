import type { PlexItem } from "@server/clients/plex";
import type { MatchResult } from "@server/modules/matching/types";
import type { SyncPayload } from "@server/modules/sync/types";
import { AppError } from "@server/utils/errors";

export const parseSyncPayload = (
  payload: Record<string, unknown>,
): SyncPayload => {
  const item = payload.item as PlexItem | undefined;

  if (
    !item ||
    typeof item.title !== "string" ||
    typeof item.ratingKey !== "string" ||
    !Number.isInteger(item.season) ||
    !Number.isInteger(item.episode) ||
    !["movie", "episode"].includes(item.mediaType) ||
    typeof payload.accountId !== "string" ||
    typeof payload.scope !== "string" ||
    typeof payload.userName !== "string" ||
    typeof payload.source !== "string" ||
    !["watched", "watching"].includes(String(payload.action))
  )
    throw new AppError(400, "INVALID_JOB", "任务数据不完整");

  if (payload.resolved !== undefined) {
    const resolved = payload.resolved as Partial<MatchResult> | null;

    if (
      !resolved ||
      !Number.isSafeInteger(resolved.subjectId) ||
      Number(resolved.subjectId) < 1 ||
      !Number.isSafeInteger(resolved.episodeId) ||
      Number(resolved.episodeId) < (payload.action === "watching" ? 0 : 1) ||
      !Array.isArray(resolved.trace) ||
      typeof resolved.mapped !== "boolean"
    )
      throw new AppError(400, "INVALID_JOB", "任务匹配结果不完整");
  }

  return payload as unknown as SyncPayload;
};
