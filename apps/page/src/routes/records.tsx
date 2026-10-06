import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@page/components/page-state";
import { Badge } from "@page/components/ui/badge";
import { Button } from "@page/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@page/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@page/components/ui/dialog";
import { Input } from "@page/components/ui/input";
import {
  Select,
  SelectContent,
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
import {
  type RecordFilters,
  useRecordQuery,
  useRecordsQuery,
} from "@page/hooks/use-records-query";
import { api, unwrap } from "@page/lib/api";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

export const RecordsPage = () => {
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [userName, setUserName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [filters, setFilters] = useState<RecordFilters>({});

  const [status, setStatus] = useState("all");
  const [mediaType, setMediaType] = useState("all");

  const records = useRecordsQuery({ page, filters, status, mediaType });

  const selectedQuery = useRecordQuery(detail);

  const selected = selectedQuery.data;

  const retry = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.records({ id }).retry.post()),
    onSuccess: () => toast.success("原始任务已重新入队，结果将写入新记录"),
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">同步记录</h1>
        <p className="mt-2 text-muted-foreground">
          查看每次同步结果和匹配过程。
        </p>
      </header>

      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters({
            search: search || undefined,
            userName: userName || undefined,
            from: from ? new Date(`${from}T00:00:00`).getTime() : undefined,
            to: to ? new Date(`${to}T23:59:59.999`).getTime() : undefined,
          });

          setPage(0);
        }}
      >
        <Input
          aria-label="作品标题"
          placeholder="作品标题"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Input
          aria-label="Plex 用户名筛选"
          placeholder="Plex 用户名"
          value={userName}
          onChange={(event) => setUserName(event.target.value)}
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
        >
          <SelectTrigger aria-label="记录状态">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              ["all", "全部状态"],
              ["success", "成功"],
              ["error", "失败"],
              ["pending", "待确认"],
              ["ignored", "已忽略"],
            ].map(([value, label]) => (
              <SelectItem key={value} value={value ?? ""}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={mediaType}
          onValueChange={(value) => {
            setMediaType(value);
            setPage(0);
          }}
        >
          <SelectTrigger aria-label="媒体类型">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部媒体</SelectItem>
            <SelectItem value="episode">剧集</SelectItem>
            <SelectItem value="movie">电影</SelectItem>
          </SelectContent>
        </Select>
        <Input
          aria-label="起始日期（本地时区）"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input
          aria-label="结束日期（本地时区）"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <div className="flex gap-2">
          <Button type="submit">应用筛选</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSearch("");
              setUserName("");
              setFrom("");
              setTo("");
              setFilters({});
              setStatus("all");
              setMediaType("all");
              setPage(0);
            }}
          >
            重置
          </Button>
        </div>
      </form>

      {records.error && <ErrorState error={records.error} />}
      {records.error && !records.data ? null : records.isPending ? (
        <LoadingState />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>记录列表</CardTitle>
          </CardHeader>

          <CardContent>
            {records.data.items.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>作品</TableHead>
                    <TableHead>进度</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead>详情</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {records.data.items.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{record.title}</TableCell>
                      <TableCell>
                        S{record.season} E{record.episode}
                      </TableCell>
                      <TableCell>{record.plexUser}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {(
                            {
                              success: "成功",
                              error: "失败",
                              pending: "待确认",
                              ignored: "已忽略",
                            } as Record<string, string>
                          )[record.status] ?? record.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(record.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          onClick={() => setDetail(record.id)}
                        >
                          查看
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState description="还没有同步记录。连接账号后启动 Plex 扫描。" />
            )}
            <div className="mt-4 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                disabled={page === 0 || records.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </Button>
              <span className="text-sm">
                第 {page + 1} 页 · 共 {records.data.total} 条
              </span>
              <Button
                variant="outline"
                disabled={
                  (page + 1) * 30 >= records.data.total || records.isFetching
                }
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.title ?? "记录详情"}</DialogTitle>
          </DialogHeader>
          {selectedQuery.error && <ErrorState error={selectedQuery.error} />}
          {selectedQuery.isPending && <LoadingState />}
          <p className="text-sm">{selected?.message}</p>
          {selected && selected.status !== "success" && (
            <Button
              variant="outline"
              disabled={retry.isPending}
              onClick={() => retry.mutate(selected.id)}
            >
              重试原始任务
            </Button>
          )}
          {selected?.subjectId ? (
            <a
              href={`https://bgm.tv/subject/${selected.subjectId}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              打开 Bangumi 条目
            </a>
          ) : null}
          <pre className="overflow-auto rounded-md bg-muted p-4 text-xs">
            {JSON.stringify(selected?.trace ?? [], null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
};
