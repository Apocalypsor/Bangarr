import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { openDatabase } from "@server/db/client";
import { JobsService } from "@server/modules/jobs/service";
import { testContext } from "@server/utils/testing";

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
    kind: "sync",
    dedupeKey: "server:user:1",
    payload: { ratingKey: "1" },
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
    kind: "sync",
    dedupeKey: "1",
    payload: {},
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
    kind: "sync",
    dedupeKey: "1",
    payload: {},
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
    kind: "sync",
    dedupeKey: "1",
    payload: {},
    maxAttempts: 1,
  });

  JobsService.claim(queue, "a", 1000);
  expect(() => JobsService.cancel(queue, job.id)).toThrow("只能取消");
  advance(1001);
  expect(JobsService.claim(queue, "b")).toBeNull();
  expect(JobsService.get(queue, job.id)?.state).toBe("failed");
});

test("only a live lease can checkpoint resolved targets or renew itself", () => {
  const { queue, advance } = fixture();

  const { job } = JobsService.enqueue(queue, {
    kind: "sync",
    dedupeKey: "target",
    payload: {},
  });

  JobsService.claim(queue, "a", 1000);

  const resolved = { subjectId: 10, episodeId: 101 };

  JobsService.checkpoint(queue, job.id, "a", { resolved });
  expect(JobsService.get(queue, job.id)?.payload).toEqual({ resolved });
  expect(() => JobsService.checkpoint(queue, job.id, "b", {})).toThrow("租约");
  advance(1001);
  expect(JobsService.heartbeat(queue, job.id, "a")).toBe(false);
  expect(() => JobsService.checkpoint(queue, job.id, "a", {})).toThrow("租约");
  expect(JobsService.claim(queue, "b")?.payload).toEqual({ resolved });
});

test("background status retains scan failures even after many sync jobs and exposes no payload", () => {
  const { queue, advance } = fixture();

  const scan = JobsService.enqueue(queue, {
    kind: "plex-scan",
    dedupeKey: "scan",
    payload: { privateDetail: "not-for-status" },
  });

  JobsService.claim(queue, "worker");
  JobsService.fail(queue, scan.job.id, "worker", "Plex 暂时无法连接", false);
  advance(1);

  for (let index = 0; index < 110; index++)
    JobsService.enqueue(queue, {
      kind: "sync",
      dedupeKey: `sync:${index}`,
      payload: {},
    });

  expect(JobsService.backgroundStatus(queue)).toEqual([
    {
      id: scan.job.id,
      kind: "plex-scan",
      state: "failed",
      lastError: "Plex 暂时无法连接",
      updatedAt: 10000,
    },
  ]);
  advance(1);

  const retry = JobsService.retry(queue, scan.job.id);

  expect(JobsService.backgroundStatus(queue)[0]?.id).toBe(retry.job.id);
  expect(JobsService.backgroundStatus(queue)[0]?.state).toBe("pending");
});
