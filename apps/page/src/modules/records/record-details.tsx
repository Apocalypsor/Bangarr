import type { useRecordQuery } from "@page/hooks/use-records-query";

type SyncRecord = NonNullable<ReturnType<typeof useRecordQuery>["data"]>;

export const RecordDetails = ({ record }: { record: SyncRecord }) => {
  const account = record.accountNickname || record.accountName || "账号已删除";
  const fields = [
    ["媒体类型", record.mediaType === "movie" ? "电影" : "剧集"],
    ["Plex 账号", record.plexAccountName ?? record.plexUser],
    ["Plex 用户", record.plexUser],
    [
      "Bangumi 账号",
      record.accountName && account !== record.accountName
        ? `${account}（${record.accountName}）`
        : account,
    ],
    [
      "同步来源",
      record.source === "plex"
        ? "Plex Webhook"
        : record.source === "plex_poll"
          ? "Plex 扫描"
          : "未知来源",
    ],
    [
      "同步动作",
      record.action === "watched"
        ? "标记已看"
        : record.action === "watching"
          ? "标记在看"
          : "未记录",
    ],
    ["记录时间", new Date(record.createdAt).toLocaleString()],
    [
      "匹配方式",
      record.matching === "manual"
        ? "自定义映射"
        : record.matching === "automatic"
          ? "自动匹配"
          : "尚未匹配成功",
    ],
  ];

  if (record.episodeOffset !== null)
    fields.push(["集数偏移", String(record.episodeOffset)]);

  if (record.job) {
    fields.push([
      "关联任务",
      {
        pending: "等待中",
        running: "处理中",
        succeeded: "已完成",
        failed: "失败",
        cancelled: "已取消",
      }[record.job.state],
    ]);
    fields.push([
      "执行次数",
      `${record.job.attempt} / ${record.job.maxAttempts}`,
    ]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 border-t pt-4 text-sm">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {record.subjectId ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <a
            href={`https://bgm.tv/subject/${record.subjectId}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            Bangumi 条目 · {record.subjectId}
          </a>
          {record.episodeId ? (
            <a
              href={`https://bgm.tv/ep/${record.episodeId}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-4"
            >
              对应章节 · {record.episodeId}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
