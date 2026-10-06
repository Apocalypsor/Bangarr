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

    return row;
  }

  static retry(context: Pick<AppContext, "database" | "now">, id: string) {
    const record = RecordsService.get(context, id);

    if (record.status === "success")
      throw new AppError(
        409,
        "RECORD_SUCCEEDED",
        "此记录已经成功，请通过 Plex 全量核对重新检查",
      );

    if (!record.jobId || !JobsService.get(context, record.jobId))
      throw new AppError(
        409,
        "RECORD_JOB_MISSING",
        "此历史记录没有原始任务，请通过 Plex 扫描重新核对",
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
