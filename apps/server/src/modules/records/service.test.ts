import { expect, test } from "bun:test";
import { records } from "@server/db/schema";
import { JobsService } from "@server/modules/jobs/service";
import { RecordsService } from "@server/modules/records/service";
import { testContext } from "@server/utils/testing";

test("history filters before counting and paginating, with literal substring search", () => {
  const ctx = testContext();

  try {
    for (let i = 0; i < 6; i++)
      ctx.database.orm
        .insert(records)
        .values({
          id: String(i),
          title: i < 4 ? "番剧 100%" : "其他作品",
          season: 1,
          episode: i + 1,
          mediaType: i === 5 ? "movie" : "episode",
          plexUser: i === 0 ? "bob" : "alice",
          accountId: i === 0 ? "b" : "a",
          source: "plex",
          status: i === 1 ? "error" : "success",
          message: "",
          trace: [],
          createdAt: 1000 + i,
        })
        .run();

    const history = {
      database: ctx.database,
    };

    const filtered = RecordsService.list(history, {
      search: "100%",
      userName: "alice",
      status: "success",
      from: 1000,
      to: 1005,
      limit: 1,
      offset: 1,
    });

    expect(filtered.total).toBe(2);
    expect(filtered.items[0]?.id).toBe("2");
    expect(RecordsService.list(history, { accountId: "b" }).total).toBe(1);
    expect(RecordsService.list(history, { mediaType: "movie" }).total).toBe(1);
    expect(RecordsService.list(history, { search: "' OR 1=1 --" }).total).toBe(
      0,
    );
    expect(() => RecordsService.list(history, { from: 10, to: 1 })).toThrow(
      "起始时间",
    );
  } finally {
    ctx.dispose();
  }
});

test("record retry uses the persisted original job without erasing historical outcomes", () => {
  const ctx = testContext();

  try {
    const queue = {
      database: ctx.database,
    };

    const job = JobsService.enqueue(queue, {
      kind: "sync",
      dedupeKey: "1",
      payload: { original: true },
    }).job;

    JobsService.claim(queue, "test");
    JobsService.fail(queue, job.id, "test", "temporary", false);
    ctx.database.orm
      .insert(records)
      .values({
        id: "failure",
        jobId: job.id,
        title: "番剧",
        season: 1,
        episode: 1,
        mediaType: "episode",
        plexUser: "alice",
        source: "plex",
        status: "error",
        message: "original error",
        trace: [],
        createdAt: 1,
      })
      .run();

    const history = queue;
    const retry = RecordsService.retry(history, "failure");

    expect(retry.job.id).not.toBe(job.id);
    expect(retry.job.payload).toEqual({ original: true });
    expect(RecordsService.get(history, "failure").message).toBe(
      "original error",
    );
    expect(JobsService.get(queue, job.id)?.state).toBe("failed");
  } finally {
    ctx.dispose();
  }
});
