import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { openDatabase } from "@server/db/client";
import { candidates, jobs } from "@server/db/schema";
import { JobsService } from "@server/modules/jobs/service";
import { testContext, testSyncPayload } from "@server/utils/testing";

const disposables: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

const fixture = () => {
  const context = testContext();

  disposables.push(context.dispose);

  let now = 10000;

  return {
    ...context,
    queue: {
      database: context.database,
      now: () => now,
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
};

test("active dedupe persists across connections and only one worker can claim", () => {
  const { queue, directory } = fixture();
  const secondDb = openDatabase(join(directory, "test.sqlite"));

  disposables.unshift(secondDb.close);

  const second = {
    database: secondDb,
    now: () => 10000,
  };

  const input = {
    kind: "sync" as const,
    dedupeKey: "server:user:1",
    payload: testSyncPayload(),
  };

  const original = JobsService.enqueue(queue, input);

  expect(JobsService.enqueue(second, input)).toEqual({
    job: original.job,
    created: false,
  });

  const claimed = JobsService.claim(queue, "worker-a");

  expect(claimed?.id).toBe(original.job.id);
  expect(JobsService.claim(second, "worker-b")).toBeNull();
  expect(JobsService.complete(second, original.job.id, "worker-b")).toBe(false);
  expect(JobsService.complete(queue, original.job.id, "worker-a")).toBe(true);
  expect(JobsService.get(second, original.job.id)?.state).toBe("succeeded");
});

test("crashed worker lease recovers, heartbeat protects a live job, stale owner cannot finish", () => {
  const { queue, advance } = fixture();

  const { job } = JobsService.enqueue(queue, {
    kind: "sync" as const,
    dedupeKey: "1",
    payload: testSyncPayload(),
  });

  JobsService.claim(queue, "a", 1000);
  advance(500);
  expect(JobsService.heartbeat(queue, job.id, "a", 1000)).toBe(true);
  advance(800);
  expect(JobsService.claim(queue, "b")).toBeNull();
  advance(300);
  expect(JobsService.claim(queue, "b")?.attempt).toBe(2);
  expect(JobsService.complete(queue, job.id, "a")).toBe(false);
  expect(JobsService.complete(queue, job.id, "b")).toBe(true);
});

test("retry backoff respects cap and retains auditable failed jobs", () => {
  const { queue, advance } = fixture();

  const { job } = JobsService.enqueue(queue, {
    kind: "sync" as const,
    dedupeKey: "1",
    payload: testSyncPayload(),
    maxAttempts: 2,
  });

  JobsService.claim(queue, "a");
  JobsService.fail(queue, job.id, "a", "temporary", true);
  expect(JobsService.claim(queue, "a")).toBeNull();
  advance(3000);
  expect(JobsService.claim(queue, "a")?.attempt).toBe(2);
  JobsService.fail(queue, job.id, "a", "failed twice", true);
  expect(JobsService.get(queue, job.id)?.state).toBe("failed");

  const newJob = JobsService.retry(queue, job.id).job;

  expect(newJob.id).not.toBe(job.id);
  expect(JobsService.get(queue, job.id)?.lastError).toBe("failed twice");
});

test("expired final attempt becomes failed and running writes cannot be cancelled", () => {
  const { queue, advance } = fixture();

  const { job } = JobsService.enqueue(queue, {
    kind: "sync" as const,
    dedupeKey: "1",
    payload: testSyncPayload(),
    maxAttempts: 1,
  });

  JobsService.claim(queue, "a", 1000);
  expect(() => JobsService.cancel(queue, job.id)).toThrow("只能取消");
  advance(1001);
  expect(JobsService.claim(queue, "b")).toBeNull();
  expect(JobsService.get(queue, job.id)?.state).toBe("failed");
});

test("failed tasks can be cancelled without deleting history or restarting after recovery", () => {
  const { queue, advance, directory } = fixture();
  const { job } = JobsService.enqueue(queue, {
    kind: "plex-scan",
    dedupeKey: "failed-scan",
    payload: {},
  });
  JobsService.claim(queue, "worker");
  JobsService.reportProgress(queue, job.id, "worker", "已扫描部分项目", {
    scan: { scanned: 5, failedItems: 1 },
  });
  JobsService.fail(queue, job.id, "worker", "部分项目失败", false);
  expect(JobsService.page(queue, { state: "failed" }).total).toBe(1);

  advance(1000);
  expect(JobsService.cancel(queue, job.id)).toMatchObject({
    state: "cancelled",
    lastError: "部分项目失败",
    result: { scan: { scanned: 5, failedItems: 1 } },
    attempt: 1,
    updatedAt: 11000,
    leaseOwner: null,
    leaseUntil: null,
  });
  expect(JobsService.page(queue, { state: "failed" })).toMatchObject({
    total: 0,
    counts: { failed: 0, cancelled: 1 },
  });

  const reopened = openDatabase(join(directory, "test.sqlite"));
  try {
    const restored = { database: reopened, now: () => 1000000 };
    expect(JobsService.claim(restored, "other-worker")).toBeNull();
    expect(JobsService.get(restored, job.id)?.state).toBe("cancelled");
    const retry = JobsService.retry(restored, job.id).job;
    expect(retry.id).not.toBe(job.id);
    expect(retry).toMatchObject({ state: "pending", attempt: 0 });
  } finally {
    reopened.close();
  }
});

test("cancelling a retry closes earlier matching candidates and rolls back if cleanup fails", () => {
  const { queue } = fixture();
  const { job } = JobsService.enqueue(queue, {
    kind: "sync",
    dedupeKey: "unmatched",
    payload: testSyncPayload(),
  });
  JobsService.claim(queue, "worker");
  JobsService.fail(queue, job.id, "worker", "需要手动匹配", false);
  queue.database.orm
    .insert(candidates)
    .values({
      id: "candidate",
      jobId: job.id,
      title: "番剧",
      season: 1,
      choices: [],
      state: "pending",
      createdAt: 0,
    })
    .run();
  const retry = JobsService.retry(queue, job.id).job;
  queue.database.sqlite.exec(`
    CREATE TRIGGER prevent_candidate_close BEFORE UPDATE ON candidates
    BEGIN SELECT RAISE(ABORT, 'candidate cleanup failed'); END;
  `);
  expect(() => JobsService.cancel(queue, retry.id)).toThrow(
    "candidate cleanup failed",
  );
  expect(JobsService.get(queue, retry.id)?.state).toBe("pending");
  expect(queue.database.orm.select().from(candidates).get()?.state).toBe(
    "pending",
  );

  queue.database.sqlite.exec("DROP TRIGGER prevent_candidate_close");
  JobsService.cancel(queue, retry.id);
  expect(queue.database.orm.select().from(candidates).get()?.state).toBe(
    "rejected",
  );
  expect(JobsService.claim(queue, "worker")).toBeNull();
  expect(JobsService.get(queue, job.id)?.state).toBe("failed");
});

test("only a live lease can checkpoint resolved targets or renew itself", () => {
  const { queue, advance } = fixture();

  const { job } = JobsService.enqueue(queue, {
    kind: "sync" as const,
    dedupeKey: "target",
    payload: testSyncPayload(),
  });

  JobsService.claim(queue, "a", 1000);

  const resolved = { subjectId: 10, episodeId: 101 };

  JobsService.checkpoint(queue, job.id, "a", { resolved });
  expect(JobsService.get(queue, job.id)?.payload).toEqual({ resolved });
  expect(() => JobsService.checkpoint(queue, job.id, "b", {})).toThrow(
    "任务已中断",
  );
  advance(1001);
  expect(JobsService.heartbeat(queue, job.id, "a")).toBe(false);
  expect(() => JobsService.checkpoint(queue, job.id, "a", {})).toThrow(
    "任务已中断",
  );
  expect(JobsService.claim(queue, "b")?.payload).toEqual({ resolved });
});

test("task filters retain scan failures after many sync jobs and expose no payload", () => {
  const { queue, advance } = fixture();

  const scan = JobsService.enqueue(queue, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: { full: false, ...{ privateDetail: "not-for-status" } },
  });

  JobsService.claim(queue, "worker");
  JobsService.fail(queue, scan.job.id, "worker", "Plex 暂时无法连接", false);
  advance(1);

  for (let index = 0; index < 110; index++)
    JobsService.enqueue(queue, {
      kind: "sync" as const,
      dedupeKey: `sync:${index}`,
      payload: testSyncPayload(),
    });

  const failed = JobsService.page(queue, { state: "failed", limit: 1 });
  expect(failed.total).toBe(1);
  expect(failed.items[0]).toMatchObject({
    id: scan.job.id,
    kind: "plex-scan",
    state: "failed",
    lastError: "Plex 暂时无法连接",
  });
  expect(JSON.stringify(failed)).not.toContain("not-for-status");
  expect(failed.counts.pending).toBe(110);
  expect(
    JobsService.page(queue, { kind: "sync" as const, limit: 10, offset: 100 })
      .items,
  ).toHaveLength(10);
  expect(
    JobsService.page(queue, { kind: "sync" as const, limit: 10, offset: 110 })
      .items,
  ).toHaveLength(0);
  advance(1);

  const retry = JobsService.retry(queue, scan.job.id);
  const scans = JobsService.page(queue, { kind: "plex-scan" });
  expect(scans.items[0]?.id).toBe(retry.job.id);
  expect(scans.items[0]?.state).toBe("pending");
});

test("task progress persists and expired workers cannot overwrite it", () => {
  const { queue, directory, advance } = fixture();
  const task = JobsService.enqueue(queue, {
    kind: "sync" as const,
    dedupeKey: "progress",
    payload: testSyncPayload({ token: "not-public" }),
  });
  JobsService.claim(queue, "first", 1000);
  JobsService.reportProgress(queue, task.job.id, "first", "正在匹配作品与章节");

  const reopened = openDatabase(join(directory, "test.sqlite"));
  try {
    const current = JobsService.page({ database: reopened }).items[0];
    expect(current?.progress).toBe("正在匹配作品与章节");
    expect(current).not.toHaveProperty("payload");
    expect(current).not.toHaveProperty("result");
    expect(current).not.toHaveProperty("leaseOwner");
  } finally {
    reopened.close();
  }

  advance(1001);
  expect(() =>
    JobsService.reportProgress(queue, task.job.id, "first", "旧进度"),
  ).toThrow("任务已中断");
  JobsService.claim(queue, "second");
  expect(JobsService.page(queue).items[0]?.progress).toBe("");
  JobsService.reportProgress(queue, task.job.id, "second", "正在同步观看进度");
  JobsService.complete(queue, task.job.id, "second", { changed: true });
  expect(JobsService.page(queue).items[0]?.progress).toBe("观看进度已同步");
});

test("scan diagnostics expose only safe fields and remain available after failure", () => {
  const { queue } = fixture();
  const { job } = JobsService.enqueue(queue, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: { full: false, ...{ token: "payload-secret" } },
  });
  JobsService.claim(queue, "worker");
  JobsService.reportProgress(queue, job.id, "worker", "扫描未完成", {
    scan: {
      scanned: 1,
      queued: 0,
      skipped: 0,
      failedItems: 1,
      failedLibraries: 0,
      issuesOmitted: 0,
      token: "report-secret",
      issues: [
        {
          id: "issue-1",
          scope: "item",
          libraryTitle: "动画",
          ratingKey: "bad",
          title: "番剧",
          message: "集数无效",
          token: "issue-secret",
          raw: { token: "raw-secret" },
        },
      ],
    },
  });
  JobsService.fail(queue, job.id, "worker", "有异常项目", false);
  const page = JobsService.page(queue, { state: "failed" });
  expect(page.items[0]?.scan?.issues).toEqual([
    {
      id: "issue-1",
      scope: "item",
      libraryTitle: "动画",
      ratingKey: "bad",
      title: "番剧",
      message: "集数无效",
    },
  ]);
  expect(JSON.stringify(page)).not.toContain("secret");
});

test("active task pages exclude finished history before pagination and separate waiting from retrying", () => {
  const { queue, advance } = fixture();
  const enqueue = (key: string) =>
    JobsService.enqueue(queue, {
      kind: "sync" as const,
      dedupeKey: key,
      payload: testSyncPayload(),
    }).job;

  for (let index = 0; index < 35; index++) {
    const completed = enqueue(`history:${index}`);
    JobsService.claim(queue, "worker");
    JobsService.complete(queue, completed.id, "worker");
    advance(1);
  }

  const failed = enqueue("failed");
  JobsService.claim(queue, "worker");
  JobsService.fail(queue, failed.id, "worker", "terminal failure", false);
  const cancelled = enqueue("cancelled");
  JobsService.cancel(queue, cancelled.id);
  const retrying = enqueue("retrying");
  JobsService.claim(queue, "worker");
  JobsService.fail(queue, retrying.id, "worker", "temporary failure", true);
  const running = enqueue("running");
  expect(JobsService.claim(queue, "worker")?.id).toBe(running.id);
  const waiting = enqueue("waiting");

  const page = JobsService.page(queue, { state: "active", limit: 1 });
  expect(page.total).toBe(3);
  expect(page.items[0]?.id).toBe(running.id);
  expect(page.counts).toMatchObject({ waiting: 1, running: 1, retrying: 1 });
  const rest = JobsService.page(queue, {
    state: "active",
    offset: 1,
    limit: 2,
  });
  expect(rest.items.map((job) => job.id).sort()).toEqual(
    [retrying.id, waiting.id].sort(),
  );
  expect(
    JobsService.page(queue, { state: "waiting" }).items.map((job) => job.id),
  ).toEqual([waiting.id]);
  expect(
    JobsService.page(queue, { state: "retrying" }).items.map((job) => job.id),
  ).toEqual([retrying.id]);
  expect(
    JobsService.page(queue, { state: "active", kind: "plex-scan" }).total,
  ).toBe(0);

  JobsService.complete(queue, running.id, "worker");
  JobsService.cancel(queue, waiting.id);
  JobsService.cancel(queue, retrying.id);
  expect(JobsService.page(queue, { state: "active" }).total).toBe(0);
  expect(JobsService.get(queue, running.id)?.state).toBe("succeeded");

  const retry = JobsService.retry(queue, failed.id);
  expect(
    JobsService.page(queue, { state: "active" }).items.map((job) => job.id),
  ).toEqual([retry.job.id]);
  expect(JobsService.get(queue, failed.id)?.state).toBe("failed");
});

test("failed task counts follow retries and later scans without deleting history", () => {
  const { queue } = fixture();
  const original = JobsService.enqueue(queue, {
    kind: "plex-scan",
    dedupeKey: "scan:one",
    payload: testSyncPayload(),
  }).job;
  JobsService.claim(queue, "worker");
  JobsService.fail(queue, original.id, "worker", "failed", false);
  expect(JobsService.page(queue, { state: "failed" })).toMatchObject({
    total: 1,
    counts: { failed: 1 },
  });

  const retry = JobsService.retry(queue, original.id).job;
  expect(JobsService.page(queue, { state: "failed" })).toMatchObject({
    total: 0,
    counts: { failed: 0, waiting: 1 },
  });
  expect(JobsService.claim(queue, "worker")?.id).toBe(retry.id);
  JobsService.complete(queue, retry.id, "worker");
  expect(JobsService.page(queue)).toMatchObject({
    total: 1,
    counts: { failed: 0, succeeded: 1 },
  });
  expect(JobsService.get(queue, original.id)?.state).toBe("failed");
  expect(JobsService.list(queue)).toHaveLength(2);

  const nextScan = JobsService.enqueue(queue, {
    kind: "plex-scan",
    dedupeKey: "scan:one",
    payload: testSyncPayload(),
  }).job;
  JobsService.claim(queue, "worker");
  JobsService.fail(queue, nextScan.id, "worker", "failed again", false);
  expect(JobsService.page(queue, { state: "failed" })).toMatchObject({
    total: 1,
    counts: { failed: 1, succeeded: 0 },
  });
  expect(JobsService.page(queue, { state: "failed" }).items[0]?.id).toBe(
    nextScan.id,
  );
  expect(JobsService.list(queue)).toHaveLength(3);
});

test("latest-task filtering precedes pagination and uses insertion order when timestamps tie", () => {
  const { queue, directory } = fixture();
  for (const [id, key, state] of [
    ...Array.from(
      { length: 35 },
      (_, index) =>
        [`z-history-${index}`, "same-account-episode", "failed"] as const,
    ),
    ["a-current", "same-account-episode", "succeeded"],
    ["other-account", "other-account-episode", "failed"],
    ["other-library", "other-library-scan", "failed"],
  ] as const) {
    queue.database.orm
      .insert(jobs)
      .values({
        id,
        dedupeKey: key,
        kind: key.endsWith("scan") ? "plex-scan" : "sync",
        state,
        payload: testSyncPayload(),
        createdAt: 10000,
        updatedAt: 10000,
        availableAt: 10000,
      })
      .run();
  }
  const reopened = openDatabase(join(directory, "test.sqlite"));
  try {
    const context = { database: reopened };
    const first = JobsService.page(context, { state: "failed", limit: 1 });
    const second = JobsService.page(context, {
      state: "failed",
      limit: 1,
      offset: 1,
    });
    expect(first).toMatchObject({
      total: 2,
      counts: { failed: 2, succeeded: 1 },
    });
    expect(new Set([first.items[0]?.id, second.items[0]?.id])).toEqual(
      new Set(["other-account", "other-library"]),
    );
    expect(
      JobsService.page(context, { state: "failed", kind: "sync" }).total,
    ).toBe(1);
    expect(
      JobsService.page(context, { state: "failed", offset: 2 }).items,
    ).toEqual([]);
    expect(JobsService.list(context)).toHaveLength(38);
  } finally {
    reopened.close();
  }
});
