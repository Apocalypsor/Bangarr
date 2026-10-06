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
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

const states = {
  pending: "等待中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
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

  const action = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "retry" | "cancel";
    }) => {
      if (action === "retry")
        return unwrap(await api.api.jobs({ id }).retry.post());
      return unwrap(await api.api.jobs({ id }).cancel.post());
    },
    onSuccess: (_, input) => {
      toast.success(input.action === "retry" ? "已安排重试" : "已取消");
      void client.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {Object.entries(states).map(([state, label]) => (
          <Badge key={state} variant="secondary">
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
              <SelectItem value="all">全部状态</SelectItem>
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
                        action.isPending && action.variables.id === job.id;
                      const waitingRetry =
                        job.state === "pending" && job.attempt > 0;

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
                            {job.accountName || job.userName || "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                job.state === "failed" && !job.needsConfirmation
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {job.needsConfirmation
                                ? "待确认"
                                : waitingRetry
                                  ? "等待重试"
                                  : states[job.state]}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-sm whitespace-normal">
                            {job.progress && <p>{job.progress}</p>}
                            {job.lastError && (
                              <p className="text-muted-foreground">
                                {job.lastError}
                              </p>
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
                            {job.needsConfirmation ? (
                              <Button size="sm" variant="outline" asChild>
                                <Link to="/matching">确认匹配</Link>
                              </Button>
                            ) : job.state === "failed" ||
                              job.state === "cancelled" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pendingAction}
                                onClick={() =>
                                  action.mutate({ id: job.id, action: "retry" })
                                }
                              >
                                重试
                              </Button>
                            ) : job.state === "pending" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pendingAction}
                                onClick={() =>
                                  action.mutate({
                                    id: job.id,
                                    action: "cancel",
                                  })
                                }
                              >
                                取消
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState title="暂无任务" />
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
