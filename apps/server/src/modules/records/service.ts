import { getAccount } from "@server/db/accounts";
import type { HistoryFilter } from "@server/db/records";
import { getSyncRecord, listSyncRecords } from "@server/db/records";
import { JobsService } from "@server/modules/jobs/service";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";

export abstract class RecordsService {
  static list(
    context: Pick<AppContext, "database" | "now">,
    filter: HistoryFilter,
  ) {
    if (
      filter.from !== undefined &&
      filter.to !== undefined &&
      filter.from > filter.to
    )
      throw new AppError(400, "DATE_RANGE", "起始时间不能晚于结束时间");

    return listSyncRecords(context.database, filter);
  }

  static get(context: Pick<AppContext, "database" | "now">, id: string) {
    const row = getSyncRecord(context.database, id);

    if (!row) throw new AppError(404, "RECORD_NOT_FOUND", "记录不存在");

    const account = row.accountId
      ? getAccount(context.database, row.accountId)
      : undefined;
    const job = row.jobId ? JobsService.get(context, row.jobId) : undefined;
    const mapping = row.trace.find((step) => step.step === "mapping");

    return {
      ...row,
      accountName: account?.username ?? null,
      accountNickname: account?.nickname ?? null,
      plexAccountName:
        typeof job?.payload.plexAccountName === "string"
          ? job.payload.plexAccountName
          : null,
      action:
        job?.payload.action === "watched" || job?.payload.action === "watching"
          ? job.payload.action
          : null,
      matching: mapping ? "manual" : row.subjectId ? "automatic" : null,
      episodeOffset:
        typeof mapping?.offset === "number" ? mapping.offset : null,
      job: job
        ? {
            state: job.state,
            attempt: job.attempt,
            maxAttempts: job.maxAttempts,
          }
        : null,
    };
  }

  static retry(context: Pick<AppContext, "database" | "now">, id: string) {
    const record = RecordsService.get(context, id);

    if (record.status === "success")
      throw new AppError(409, "RECORD_SUCCEEDED", "此记录已同步成功");

    if (!record.jobId || !JobsService.get(context, record.jobId))
      throw new AppError(
        409,
        "RECORD_JOB_MISSING",
        "无法重试此记录，请重新扫描 Plex",
      );

    const job = JobsService.get(context, record.jobId);

    if (record.status === "ignored" && job?.state === "succeeded")
      return JobsService.enqueue(context, {
        kind: job.kind,
        dedupeKey: job.dedupeKey,
        payload: job.payload,
        maxAttempts: job.maxAttempts,
      });

    return JobsService.retry(context, record.jobId);
  }
}
