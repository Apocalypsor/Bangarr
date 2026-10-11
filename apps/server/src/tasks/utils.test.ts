import { expect, test } from "bun:test";
import { JobsService } from "@server/modules/jobs/service";
import type { EnqueueInput } from "@server/modules/jobs/types";
import { parseTask, plexScope, syncTask } from "@server/tasks/utils";
import { testContext, testSyncPayload } from "@server/utils/testing";

const parseSyncPayload = (payload: unknown) => {
  const task = parseTask({ kind: "sync", payload });
  if (task.kind !== "sync") throw new Error("Unexpected task kind");
  return task.payload;
};

test("sync contracts reject incomplete or mistyped persisted payloads and preserve E00", () => {
  const valid = testSyncPayload();
  expect(parseSyncPayload(valid)).toEqual(valid);
  for (const field of Object.keys(valid.item)) {
    const item = { ...valid.item } as Record<string, unknown>;
    delete item[field];
    expect(() => parseSyncPayload({ ...valid, item })).toThrow(
      "任务数据不完整",
    );
  }
  for (const changes of [
    { full: "false" },
    { action: "delete" },
    { accountId: "" },
  ])
    expect(() => parseSyncPayload({ ...valid, ...changes })).toThrow();
  expect(
    parseSyncPayload({ ...valid, item: { ...valid.item, episode: 0 } }).item
      .episode,
  ).toBe(0);
  const resolved = { subjectId: 1, episodeId: 0, trace: [], mapped: true };
  expect(() => parseSyncPayload({ ...valid, resolved })).toThrow();
  expect(
    parseSyncPayload({ ...valid, action: "watching", resolved }).resolved,
  ).toEqual(resolved);
});

test("task construction shares scope and dedupe without leaking old scheduling state", () => {
  const scope = plexScope("server", "alice");
  const payload = testSyncPayload({ scope });
  const scan = syncTask({ ...payload, source: "plex_poll" }, 5);
  const webhook = syncTask({ ...payload, source: "plex" }, 5);
  expect(scan.dedupeKey).toBe(webhook.dedupeKey);
  expect(syncTask({ ...payload, accountId: "other" }, 5).dedupeKey).not.toBe(
    scan.dedupeKey,
  );
  expect(plexScope("server", "other")).not.toBe(scope);
  expect(
    parseTask({ ...scan, availableAt: 999, attempt: 5, state: "failed" }),
  ).toEqual({ kind: scan.kind, payload: scan.payload });
});

test("enqueue validates the whole batch before accepting any task", () => {
  const context = testContext();
  try {
    const valid = syncTask(testSyncPayload(), 5);
    const invalid = {
      kind: "sync",
      payload: {},
      dedupeKey: "bad",
    } as EnqueueInput;
    expect(() => JobsService.enqueueBatch(context, [valid, invalid])).toThrow(
      "任务数据不完整",
    );
    expect(JobsService.list(context)).toEqual([]);
    expect(JobsService.enqueueBatch(context, [valid, valid])).toBe(1);
    expect(JobsService.list(context)).toHaveLength(1);
  } finally {
    context.dispose();
  }
});
