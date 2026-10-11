import { PlexClient } from "@server/clients/plex";
import { transaction } from "@server/db/client";
import {
  findPendingJobCandidate,
  findWatched,
  insertMatchingCandidate,
  insertWatched,
  saveSyncRecord,
} from "@server/db/records";
import { AccountService } from "@server/modules/accounts/service";
import { CatalogService } from "@server/modules/catalog/service";
import { JobsService } from "@server/modules/jobs/service";
import type { EnqueueInput, Job } from "@server/modules/jobs/types";
import {
  BlockedTitle,
  NeedsConfirmation,
} from "@server/modules/matching/errors";
import { MatchingService } from "@server/modules/matching/service";
import { PlexService } from "@server/modules/plex/service";
import { SettingsService } from "@server/modules/settings/service";
import { ScanIncomplete } from "@server/tasks/errors";
import type { ScanReport, SyncPayload } from "@server/tasks/types";
import { parseSyncPayload } from "@server/tasks/utils";
import type { AppContext } from "@server/types";
import { AppError, RemoteError } from "@server/utils/errors";
import { tokenDigest } from "@server/utils/secrets";

export abstract class TaskService {
  static async runOne(
    context: AppContext,
    owner: string = crypto.randomUUID(),
  ) {
    const job = JobsService.claim(context, owner);

    if (!job) return false;

    await TaskService.execute(context, job, owner);

    return true;
  }

  private static async execute(context: AppContext, job: Job, owner: string) {
    const heartbeat = setInterval(
      () => JobsService.heartbeat(context, job.id, owner),
      15000,
    );

    try {
      let result: Record<string, unknown>;

      switch (job.kind) {
        case "catalog-data":
          result = await CatalogService.refreshData(context, (message) =>
            JobsService.reportProgress(context, job.id, owner, message),
          );
          break;
        case "plex-scan":
          result = await TaskService.scan(context, job, owner);
          break;
        case "sync":
          result = await TaskService.sync(context, job, owner);
          break;
        default:
          throw new AppError(400, "UNKNOWN_JOB", "任务类型不受支持");
      }

      JobsService.complete(context, job.id, owner, result);
    } catch (error) {
      const retryable =
        error instanceof ScanIncomplete
          ? error.retryable
          : error instanceof RemoteError
            ? error.remoteStatus === 429 || error.remoteStatus >= 500
            : error instanceof AppError &&
              ["REMOTE_UNREACHABLE", "MATCH_DEADLINE"].includes(error.code);

      JobsService.fail(
        context,
        job.id,
        owner,
        error instanceof AppError
          ? error.message
          : "任务执行失败，请检查数据和配置",
        retryable,
        error instanceof RemoteError || error instanceof ScanIncomplete
          ? error.retryAfter
          : undefined,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private static async scan(context: AppContext, job: Job, owner: string) {
    const config = SettingsService.read(context);
    const source = PlexService.get(
      context,
      String(job.payload.plexAccountId ?? "default"),
    );
    if (!source.enabled) return { skipped: true, reason: "Plex 账号已停用" };
    const targets = AccountService.targets(context, source.id);
    if (!targets.length)
      throw new AppError(
        400,
        "NO_ACCOUNT",
        "此 Plex 账号尚未绑定 Bangumi 账号",
      );

    const client = new PlexClient(
      source.url,
      source.token,
      context.transport ?? fetch,
    );

    JobsService.reportProgress(context, job.id, owner, "正在连接 Plex");
    const server = await client.identity();
    const scope = tokenDigest(JSON.stringify([server.id, source.userName]));
    const report: ScanReport = {
      scanned: 0,
      queued: 0,
      skipped: 0,
      failedItems: 0,
      failedLibraries: 0,
      issues: [],
      issuesOmitted: 0,
    };
    let retryable = false;
    let retryAfter = 0;
    let lastProgress = 0;
    let batch: EnqueueInput[] = [];
    const progress = () =>
      `已扫描 ${report.scanned} 项，新增 ${report.queued} 项，跳过 ${report.skipped} 项；${report.failedItems} 条数据异常，${report.failedLibraries} 个媒体库未完成`;
    const flush = async () => {
      transaction(
        context.database,
        () => {
          // Check the lease in the same transaction as enqueuing the batch.
          JobsService.reportProgress(context, job.id, owner, progress(), {
            scan: report,
          });
          const added = JobsService.enqueueBatch(context, batch);
          report.queued += added;
          report.skipped += batch.length - added;
          JobsService.reportProgress(context, job.id, owner, progress(), {
            scan: report,
          });
        },
        "immediate",
      );
      batch = [];
      await Bun.sleep(0);
    };
    JobsService.reportProgress(context, job.id, owner, "正在扫描媒体库");

    const iterator = client.watched(source.libraryIds);
    try {
      while (true) {
        let next: Awaited<ReturnType<typeof iterator.next>>;
        try {
          next = await iterator.next();
        } catch (error) {
          // Preserve the valid tail on any read failure. Queue/database errors
          // occur outside this catch and must never cause a second write attempt.
          await flush();
          throw error;
        }
        if (next.done) break;
        const event = next.value;
        if (event.type === "issue") {
          if (event.issue.scope === "item") {
            report.scanned++;
            report.failedItems++;
          } else report.failedLibraries++;
          if (report.issues.length < 100) report.issues.push(event.issue);
          else report.issuesOmitted++;
          retryable ||= event.issue.retryable;
          retryAfter = Math.max(retryAfter, event.issue.retryAfter);
          await flush();
          continue;
        }
        const item = event.item;
        report.scanned++;
        for (const account of targets) {
          if (
            !job.payload.full &&
            TaskService.wasWatched(context, scope, item.ratingKey, account.id)
          ) {
            report.skipped++;

            continue;
          }

          const payload: SyncPayload = {
            item,
            scope,
            userName: source.userName,
            accountId: account.id,
            action: "watched",
            source: "plex_poll",
            plexAccountId: source.id,
            plexAccountName: source.name,
            full: job.payload.full === true,
          };

          batch.push({
            kind: "sync",
            dedupeKey: `sync:${scope}:${item.ratingKey}:${account.id}:watched`,
            payload: { ...payload },
            maxAttempts: config.scheduler.maxAttempts,
          });

          if (batch.length >= 50) await flush();
        }

        if (report.scanned % 25 === 0) await flush();

        if (Date.now() - lastProgress >= 500) {
          JobsService.reportProgress(context, job.id, owner, progress(), {
            scan: report,
          });
          lastProgress = Date.now();
        }
      }
    } finally {
      await iterator.return(undefined);
    }

    await flush();
    if (report.failedItems || report.failedLibraries)
      throw new ScanIncomplete(retryable, retryAfter);
    return { queued: report.queued, skipped: report.skipped, scan: report };
  }

  private static async sync(context: AppContext, job: Job, owner: string) {
    const payload = parseSyncPayload(job.payload);
    const { item, accountId, scope, userName, source, action } = payload;

    if (
      !payload.full &&
      action === "watched" &&
      TaskService.wasWatched(context, scope, item.ratingKey, accountId)
    )
      return { skipped: true, reason: "此账号已同步" };

    const config = SettingsService.read(context);
    const recordId = tokenDigest(
      JSON.stringify([scope, item.ratingKey, accountId]),
    );

    const base = {
      id: recordId,
      jobId: job.id,
      accountId,
      title: item.title,
      season: item.season,
      episode: item.episode,
      mediaType: item.mediaType,
      plexUser: userName,
      source,
      createdAt: Date.now(),
    };

    try {
      const account = AccountService.get(context, accountId);

      if (
        !account.enabled ||
        !AccountService.bindings(context, account.plexUsers).includes(
          payload.plexAccountId ?? "default",
        )
      )
        throw new AppError(
          403,
          "ACCOUNT_UNBOUND",
          "账号已停用或 Plex 用户绑定已变更",
        );

      JobsService.reportProgress(context, job.id, owner, "正在匹配作品与章节");

      if (payload.plexAccountId) {
        const sourceAccount = PlexService.get(context, payload.plexAccountId);
        if (!sourceAccount.enabled)
          throw new AppError(403, "PLEX_DISABLED", "Plex 账号已停用");
        if (
          sourceAccount.userName !== userName ||
          (sourceAccount.serverId &&
            tokenDigest(JSON.stringify([sourceAccount.serverId, userName])) !==
              scope)
        ) {
          throw new AppError(
            409,
            "PLEX_ACCOUNT_CHANGED",
            "Plex 账号已变更，请重新扫描",
          );
        }
      }

      // 保存匹配结果，重试时沿用已确认的目标。
      const match =
        payload.resolved ??
        (await MatchingService.match(
          context,
          item,
          AccountService.client(context, accountId),
          config,
        ));

      JobsService.checkpoint(context, job.id, owner, {
        ...payload,
        resolved: match,
      });

      const api = AccountService.client(context, accountId);

      TaskService.assertLease(context, job.id, owner);

      JobsService.reportProgress(context, job.id, owner, "正在同步观看进度");

      const result =
        action === "watching"
          ? await api.markWatching(match.subjectId, account.private)
          : await api.markWatched(
              match.subjectId,
              match.episodeId,
              account.private,
            );

      if (
        action === "watched" &&
        (item.mediaType === "movie"
          ? config.sync.movieCompleted
          : config.sync.animeCompleted)
      )
        await api.completeIfWatched(
          match.subjectId,
          account.private,
          item.mediaType === "movie",
        );

      transaction(
        context.database,
        () => {
          TaskService.assertLease(context, job.id, owner);

          if (action === "watched")
            insertWatched(context.database, {
              scope,
              ratingKey: item.ratingKey,
              accountId,
              subjectId: match.subjectId,
              episodeId: match.episodeId,
              createdAt: Date.now(),
            });

          saveSyncRecord(context.database, {
            ...base,
            status: "success",
            subjectId: match.subjectId,
            episodeId: match.episodeId,
            trace: match.trace,
            message: result.changed ? "观看进度已同步" : "Bangumi 已有此进度",
          });
        },
        "deferred",
      );

      return { recordId, ...match, changed: result.changed };
    } catch (error) {
      if (error instanceof BlockedTitle) {
        saveSyncRecord(context.database, {
          ...base,
          status: "ignored",
          message: error.message,
          trace: [],
        });

        return { skipped: true, reason: error.message };
      }

      const pending = error instanceof NeedsConfirmation;

      transaction(
        context.database,
        () => {
          TaskService.assertLease(context, job.id, owner);
          saveSyncRecord(context.database, {
            ...base,
            status: pending ? "pending" : "error",
            trace: pending ? error.trace : [],
            message:
              error instanceof AppError ? error.message : "匹配或同步失败",
          });

          if (pending && !findPendingJobCandidate(context.database, job.id))
            insertMatchingCandidate(context.database, {
              id: crypto.randomUUID(),
              jobId: job.id,
              title: item.title,
              season: item.season,
              choices: error.candidates.map((candidate) => ({ ...candidate })),
              state: "pending",
              createdAt: Date.now(),
            });
        },
        "deferred",
      );

      throw error;
    }
  }

  private static assertLease(context: AppContext, id: string, owner: string) {
    if (!JobsService.heartbeat(context, id, owner))
      throw new AppError(409, "JOB_LEASE_LOST", "任务已中断，请重新同步");
  }

  private static wasWatched(
    context: AppContext,
    scope: string,
    ratingKey: string,
    accountId: string,
  ) {
    return Boolean(findWatched(context.database, scope, ratingKey, accountId));
  }
}
