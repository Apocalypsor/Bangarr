import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@page/components/page-state";
import { Badge } from "@page/components/ui/badge";
import { Button } from "@page/components/ui/button";
import { Card, CardContent } from "@page/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@page/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@page/components/ui/table";
import { type JobFilters, useJobsQuery } from "@page/hooks/use-jobs-query";
import { api, unwrap } from "@page/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const states = {
  waiting: "等待执行",
  running: "执行中",
  retrying: "等待重试",
  failed: "失败 / 未完成",
} as const;

const stateVariants = {
  waiting: "warning",
  running: "info",
  retrying: "warning",
  failed: "destructive",
} as const;

const kinds: Record<string, string> = {
  "plex-scan": "Plex 扫描",
  "catalog-data": "标题索引更新",
  sync: "观看进度同步",
};

export const TaskList = () => {
  const [filters, setFilters] = useState<JobFilters>({});
  const [page, setPage] = useState(0);
  const jobs = useJobsQuery(filters, page);
  const client = useQueryClient();

  useEffect(() => {
    if (!jobs.data || jobs.isPlaceholderData) return;
    const lastPage = Math.max(0, Math.ceil(jobs.data.total / 30) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [jobs.data, jobs.isPlaceholderData, page]);

  const cancel = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.jobs({ id }).cancel.post()),
    onSuccess: () => {
      toast.success("已取消");
      void client.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const retry = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.jobs({ id }).retry.post()),
    onSuccess: () => {
      toast.success("已重新入队");
      void client.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {Object.entries(states).map(([state, label]) => (
          <Badge
            key={state}
            variant={stateVariants[state as keyof typeof states]}
          >
            {label} {jobs.data?.counts[state as keyof typeof states] ?? "—"}
          </Badge>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Select
          value={filters.kind ?? "all"}
          onValueChange={(value) => {
            setFilters((current) => ({
              ...current,
              kind: value === "all" ? undefined : (value as JobFilters["kind"]),
            }));
            setPage(0);
          }}
        >
          <SelectTrigger aria-label="任务类型">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部类型</SelectItem>
              {Object.entries(kinds).map(([kind, label]) => (
                <SelectItem key={kind} value={kind}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={filters.state ?? "all"}
          onValueChange={(value) => {
            setFilters((current) => ({
              ...current,
              state:
                value === "all" ? undefined : (value as JobFilters["state"]),
            }));
            setPage(0);
          }}
        >
          <SelectTrigger aria-label="任务状态">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">进行中的任务</SelectItem>
              {Object.entries(states).map(([state, label]) => (
                <SelectItem key={state} value={state}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {jobs.error && <ErrorState error={jobs.error} />}
      {jobs.isPending ? (
        <LoadingState />
      ) : (
        jobs.data && (
          <Card>
            <CardContent>
              {jobs.data.items.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>任务</TableHead>
                      <TableHead>账号</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>进度</TableHead>
                      <TableHead>尝试</TableHead>
                      <TableHead>更新时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.data.items.map((job) => {
                      const pendingAction =
                        cancel.isPending && cancel.variables === job.id;
                      const waitingRetry =
                        job.state === "pending" && job.attempt > 0;

                      const state =
                        job.state === "failed"
                          ? "failed"
                          : job.state === "running"
                            ? "running"
                            : waitingRetry
                              ? "retrying"
                              : "waiting";

                      return (
                        <TableRow key={job.id}>
                          <TableCell>
                            <p>{kinds[job.kind] ?? "其他任务"}</p>
                            {job.title && (
                              <p className="text-sm text-muted-foreground">
                                {job.title} · S{job.season} E{job.episode}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            {job.plexAccountName || job.userName || "—"}
                            {job.accountName && (
                              <span> → {job.accountName}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={stateVariants[state]}>
                              {states[state]}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-sm whitespace-normal">
                            {job.progress && <p>{job.progress}</p>}
                            {job.lastError && (
                              <p className="text-muted-foreground">
                                {job.lastError}
                              </p>
                            )}
                            {job.scan &&
                              (job.scan.failedItems > 0 ||
                                job.scan.failedLibraries > 0) && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer">
                                    扫描问题：{job.scan.failedItems}{" "}
                                    条数据异常，{job.scan.failedLibraries}{" "}
                                    个媒体库未完成
                                  </summary>
                                  <ul className="mt-2 flex flex-col gap-2">
                                    {job.scan.issues.map((issue) => (
                                      <li key={issue.id}>
                                        {issue.libraryTitle} ·{" "}
                                        {issue.title ||
                                          (issue.scope === "item"
                                            ? "未知项目"
                                            : "媒体库")}
                                        {issue.ratingKey &&
                                          `（ID ${issue.ratingKey}）`}
                                        ：{issue.message}
                                      </li>
                                    ))}
                                  </ul>
                                  {job.scan.issuesOmitted > 0 && (
                                    <p>
                                      仅保留前 100 条详情，另有{" "}
                                      {job.scan.issuesOmitted} 条问题。
                                    </p>
                                  )}
                                </details>
                              )}
                            {waitingRetry && (
                              <p className="text-muted-foreground">
                                下次尝试：
                                {new Date(job.availableAt).toLocaleString()}
                              </p>
                            )}
                            {!job.progress &&
                              !job.lastError &&
                              !waitingRetry &&
                              "—"}
                          </TableCell>
                          <TableCell>
                            {job.attempt} / {job.maxAttempts}
                          </TableCell>
                          <TableCell>
                            {new Date(job.updatedAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {job.state === "pending" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pendingAction}
                                onClick={() => cancel.mutate(job.id)}
                              >
                                取消
                              </Button>
                            ) : job.state === "failed" &&
                              !job.needsConfirmation ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  retry.isPending && retry.variables === job.id
                                }
                                onClick={() => retry.mutate(job.id)}
                              >
                                重试
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState title="暂无待处理任务" />
              )}
              <div className="mt-4 flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  disabled={page === 0 || jobs.isPlaceholderData}
                  onClick={() => setPage((value) => value - 1)}
                >
                  上一页
                </Button>
                <span className="text-sm">
                  第 {page + 1} 页 · 共 {jobs.data.total} 条
                </span>
                <Button
                  variant="outline"
                  disabled={
                    (page + 1) * 30 >= jobs.data.total || jobs.isPlaceholderData
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
};
