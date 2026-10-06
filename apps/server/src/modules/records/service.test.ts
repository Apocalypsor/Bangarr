import { expect, test } from "bun:test";
import { saveSyncRecord } from "@server/db/records";
import { accounts, records } from "@server/db/schema";
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

test("retry updates the same record and its detail instead of retaining the failed result", () => {
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

    const previous = ctx.database.orm.select().from(records).get();
    if (!previous) throw new Error("missing record");
    saveSyncRecord(ctx.database, {
      ...previous,
      jobId: retry.job.id,
      status: "success",
      message: "观看进度已同步",
      subjectId: 10,
      episodeId: 101,
      trace: [],
      createdAt: 2,
    });
    expect(ctx.database.orm.select().from(records).all()).toHaveLength(1);
    expect(RecordsService.get(history, "failure")).toMatchObject({
      id: "failure",
      jobId: retry.job.id,
      status: "success",
      message: "观看进度已同步",
      createdAt: 2,
    });
    expect(RecordsService.list(history, { status: "error" }).total).toBe(0);
    expect(RecordsService.list(history, { to: 1 }).total).toBe(0);
    expect(() => RecordsService.retry(history, "failure")).toThrow(
      "此记录已同步成功",
    );

    const {
      subjectId: _subjectId,
      episodeId: _episodeId,
      ...withoutMatch
    } = previous;
    saveSyncRecord(ctx.database, {
      ...withoutMatch,
      status: "error",
      message: "账号已停用",
      trace: [],
      createdAt: 3,
    });
    expect(RecordsService.get(history, "failure")).toMatchObject({
      status: "error",
      subjectId: null,
      episodeId: null,
      trace: [],
      createdAt: 3,
    });
    expect(ctx.database.orm.select().from(records).all()).toHaveLength(1);
  } finally {
    ctx.dispose();
  }
});

test("record details include account and task context without exposing credentials or job payloads", () => {
  const context = testContext();

  try {
    context.database.orm
      .insert(accounts)
      .values({
        id: "account",
        username: "bangumi-user",
        nickname: "昵称",
        accessToken: context.vault.seal("private-token"),
        plexUsers: ["plex"],
        createdAt: 0,
      })
      .run();
    const job = JobsService.enqueue(context, {
      kind: "sync",
      dedupeKey: "detail",
      payload: {
        action: "watched",
        plexAccountName: "Home",
        privateField: "never-return-this",
      },
    }).job;
    context.database.orm
      .insert(records)
      .values({
        id: "detail",
        jobId: job.id,
        accountId: "account",
        title: "作品",
        season: 1,
        episode: 8,
        mediaType: "episode",
        plexUser: "plex-user",
        source: "plex_poll",
        status: "success",
        subjectId: 10,
        episodeId: 108,
        message: "Bangumi 已有此进度",
        trace: [{ step: "mapping", offset: -12, subjectId: 10 }],
        createdAt: 100,
      })
      .run();

    const detail = RecordsService.get(context, "detail");
    expect(detail).toMatchObject({
      accountName: "bangumi-user",
      accountNickname: "昵称",
      plexAccountName: "Home",
      action: "watched",
      matching: "manual",
      episodeOffset: -12,
      job: { state: "pending", attempt: 0, maxAttempts: 5 },
      subjectId: 10,
      episodeId: 108,
    });
    expect(JSON.stringify(detail)).not.toContain("private-token");
    expect(JSON.stringify(detail)).not.toContain("accessToken");
    expect(JSON.stringify(detail)).not.toContain("never-return-this");
    context.database.orm.delete(accounts).run();
    expect(RecordsService.get(context, "detail").accountName).toBeNull();
    expect(RecordsService.get(context, "detail").message).toBe(
      "Bangumi 已有此进度",
    );
  } finally {
    context.dispose();
  }
});
