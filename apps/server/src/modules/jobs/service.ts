import { transaction } from "@server/db/client";
import {
  assignJobLease,
  cancelPendingJob,
  checkpointJob,
  completeJob,
  findActiveJob,
  findReadyJob,
  getJob,
  incrementJobAttempt,
  insertJob,
  listJobs,
  listTaskPage,
  recoverExpiredJobs,
  renewJobLease,
  updateJobFailure,
} from "@server/db/jobs";
import type { JobsQuery } from "@server/modules/jobs/model";
import type { EnqueueInput, Job } from "@server/modules/jobs/types";
import { taskProgress } from "@server/modules/jobs/utils";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";

export abstract class JobsService {
  static enqueue(
    context: Pick<AppContext, "database" | "now">,
    input: EnqueueInput,
  ) {
    return transaction(
      context.database,
      () => {
        const existing = findActiveJob(context.database, input.dedupeKey);

        if (existing) return { job: existing, created: false };

        const now = (context.now ?? Date.now)();

        const job = insertJob(context.database, {
          id: crypto.randomUUID(),
          kind: input.kind,
          dedupeKey: input.dedupeKey,
          payload: input.payload,
          maxAttempts: input.maxAttempts ?? 5,
          state: "pending",
          availableAt: input.availableAt ?? now,
          createdAt: now,
          updatedAt: now,
        });

        JobsService.event("info", "queued", "任务已加入队列", job.id);

        return { job, created: true };
      },
      "immediate",
    );
  }

  static claim(
    context: Pick<AppContext, "database" | "now">,
    owner: string,
    leaseMs = 60000,
  ): Job | null {
    return transaction(
      context.database,
      () => {
        const now = (context.now ?? Date.now)();

        // 租约失效仅恢复可重试任务；达到次数上限的任务必须成为明确失败状态。
        recoverExpiredJobs(context.database, now);

        const row = findReadyJob(context.database, now);

        if (!row) return null;

        const job = assignJobLease(context.database, row.id, {
          state: "running",
          result: null,
          lastError: null,
          leaseOwner: owner,
          leaseUntil: now + leaseMs,
          updatedAt: now,
        });

        if (!job) return null;

        return (
          incrementJobAttempt(context.database, row.id, {
            attempt: job.attempt + 1,
          }) ?? null
        );
      },
      "immediate",
    );
  }

  static heartbeat(
    context: Pick<AppContext, "database" | "now">,
    id: string,
    owner: string,
    leaseMs = 60000,
  ) {
    return (
      renewJobLease(context.database, id, owner, (context.now ?? Date.now)(), {
        leaseUntil: (context.now ?? Date.now)() + leaseMs,
        updatedAt: (context.now ?? Date.now)(),
      }) !== undefined
    );
  }

  static checkpoint(
    context: Pick<AppContext, "database" | "now">,
    id: string,
    owner: string,
    payload: Record<string, unknown>,
  ) {
    const row = checkpointJob(
      context.database,
      id,
      owner,
      (context.now ?? Date.now)(),
      {
        payload,
        updatedAt: (context.now ?? Date.now)(),
      },
    );

    if (!row)
      throw new AppError(409, "JOB_LEASE_LOST", "任务已中断，请重新同步");
  }

  static complete(
    context: Pick<AppContext, "database" | "now">,
    id: string,
    owner: string,
    result: Record<string, unknown> = {},
  ) {
    const row = completeJob(context.database, id, owner, {
      state: "succeeded",
      result,
      lastError: null,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: (context.now ?? Date.now)(),
    });

    if (row) JobsService.event("info", "completed", "任务已完成", id);

    return Boolean(row);
  }

  static fail(
    context: Pick<AppContext, "database" | "now">,
    id: string,
    owner: string,
    message: string,
    retryable: boolean,
    delayMs?: number,
  ) {
    return transaction(
      context.database,
      () => {
        const job = JobsService.get(context, id);

        if (!job || job.leaseOwner !== owner || job.state !== "running")
          return false;

        const retry = retryable && job.attempt < job.maxAttempts;

        const delay = Math.min(
          3600000,
          Math.max(delayMs ?? 0, 1000 * 2 ** Math.min(job.attempt, 12)),
        );

        updateJobFailure(context.database, id, {
          state: retry ? "pending" : "failed",
          lastError: message,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: (context.now ?? Date.now)(),
          availableAt: (context.now ?? Date.now)() + delay,
        });
        JobsService.event(
          retry ? "warn" : "error",
          retry ? "retry" : "failed",
          message,
          id,
        );

        return true;
      },
      "immediate",
    );
  }

  static cancel(context: Pick<AppContext, "database" | "now">, id: string) {
    const job = JobsService.get(context, id);

    if (!job) throw new AppError(404, "JOB_NOT_FOUND", "任务不存在");

    // 运行中的远端写操作无法可靠撤销，不将其伪装成已取消。
    if (job.state !== "pending")
      throw new AppError(409, "JOB_NOT_PENDING", "只能取消尚未执行的任务");

    return cancelPendingJob(context.database, id, {
      state: "cancelled",
      updatedAt: (context.now ?? Date.now)(),
    });
  }

  static retry(context: Pick<AppContext, "database" | "now">, id: string) {
    const job = JobsService.get(context, id);

    if (!job) throw new AppError(404, "JOB_NOT_FOUND", "任务不存在");

    if (!["failed", "cancelled"].includes(job.state))
      throw new AppError(409, "JOB_NOT_RETRYABLE", "任务仍在执行或已成功");

    // 重新入队，保留旧任务审计历史，复用活动任务去重。
    return JobsService.enqueue(context, {
      kind: job.kind,
      dedupeKey: job.dedupeKey,
      payload: job.payload,
      maxAttempts: job.maxAttempts,
    });
  }

  static get(context: Pick<AppContext, "database" | "now">, id: string) {
    return getJob(context.database, id);
  }

  static page(context: Pick<AppContext, "database">, filter: JobsQuery = {}) {
    const page = listTaskPage(context.database, filter);
    const counts = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of page.counts) counts[row.state] = row.count;

    return {
      ...page,
      counts,
      items: page.items.map(({ result, ...job }) => ({
        ...job,
        progress: taskProgress(job.kind, job.state, result),
      })),
    };
  }

  static reportProgress(
    context: Pick<AppContext, "database" | "now">,
    id: string,
    owner: string,
    progress: string,
  ) {
    const now = (context.now ?? Date.now)();
    if (
      !checkpointJob(context.database, id, owner, now, {
        result: { progress },
        updatedAt: now,
      })
    ) {
      throw new AppError(409, "JOB_LEASE_LOST", "任务已中断，请重新同步");
    }
  }

  static list(
    context: Pick<AppContext, "database" | "now">,
    limit = 100,
    offset = 0,
  ) {
    return listJobs(context.database, limit, offset);
  }

  private static event(
    level: string,
    kind: string,
    message: string,
    jobId?: string,
  ) {
    console.info(JSON.stringify({ level, kind, message, jobId }));
  }
}
