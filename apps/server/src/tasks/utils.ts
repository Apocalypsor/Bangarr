import type { EnqueueInput } from "@server/modules/jobs/types";
import { taskSchema } from "@server/tasks/model";
import type { SyncPayload, Task } from "@server/tasks/types";
import { AppError } from "@server/utils/errors";
import { tokenDigest } from "@server/utils/secrets";
import { TypeCompiler } from "@sinclair/typebox/compiler";

const taskValidator = TypeCompiler.Compile(taskSchema);

export const parseTask = (value: unknown): Task => {
  if (!taskValidator.Check(value))
    throw new AppError(400, "INVALID_JOB", "任务数据不完整");
  if (value.kind === "sync" && !validResolvedEpisode(value.payload))
    throw new AppError(400, "INVALID_JOB", "任务匹配结果不完整");
  return { kind: value.kind, payload: value.payload } as Task;
};

export const plexScope = (serverId: string, userName: string) =>
  tokenDigest(JSON.stringify([serverId, userName]));

export const syncTask = (
  payload: SyncPayload,
  maxAttempts: number,
): Extract<EnqueueInput, { kind: "sync" }> => ({
  kind: "sync",
  dedupeKey: `sync:${payload.scope}:${payload.item.ratingKey}:${payload.accountId}:${payload.action}`,
  payload,
  maxAttempts,
});

const validResolvedEpisode = (payload: SyncPayload) =>
  payload.action !== "watched" || payload.resolved?.episodeId !== 0;
