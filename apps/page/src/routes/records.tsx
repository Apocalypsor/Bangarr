import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@page/components/page-state";
import { RefreshButton } from "@page/components/refresh-button";
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
import { Field, FieldGroup, FieldLabel } from "@page/components/ui/field";
import { Input } from "@page/components/ui/input";
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
import { usePlexAccountsQuery } from "@page/hooks/use-plex-queries";
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

  const records = useRecordsQuery({ page, filters });
  const plexAccounts = usePlexAccountsQuery();
  const plexUsers = [
    ...new Set([
      ...(plexAccounts.data ?? []).map((account) => account.userName),
      ...(userName ? [userName] : []),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const selectedQuery = useRecordQuery(detail);

  const selected = selectedQuery.data;

  const retry = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.records({ id }).retry.post()),
    onSuccess: () => toast.success("已安排重新同步"),
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">同步记录</h1>
        <RefreshButton
          onRefresh={() =>
            records.refetch({ throwOnError: true, cancelRefetch: false })
          }
        />
      </header>

      <Card>
        <CardContent>
          <form
            aria-label="筛选同步记录"
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters({
                search: search.trim() || undefined,
                userName: userName.trim() || undefined,
                status: status === "all" ? undefined : status,
                mediaType:
                  mediaType === "movie" || mediaType === "episode"
                    ? mediaType
                    : undefined,
                from: from ? new Date(`${from}T00:00:00`).getTime() : undefined,
                to: to ? new Date(`${to}T23:59:59.999`).getTime() : undefined,
              });
              setPage(0);
            }}
          >
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field className="min-w-0">
                <FieldLabel htmlFor="records-search">作品</FieldLabel>
                <Input
                  id="records-search"
                  placeholder="搜索作品标题"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="records-user">Plex 用户</FieldLabel>
                <Select
                  value={userName ? `user:${userName}` : "all"}
                  onValueChange={(value) =>
                    setUserName(value === "all" ? "" : value.slice(5))
                  }
                  disabled={plexAccounts.isPending}
                >
                  <SelectTrigger id="records-user" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">全部用户</SelectItem>
                      {plexUsers.map((name) => (
                        <SelectItem key={name} value={`user:${name}`}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {plexAccounts.error && (
                  <ErrorState error={plexAccounts.error} />
                )}
              </Field>
            </FieldGroup>

            <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field className="min-w-0">
                <FieldLabel htmlFor="records-status">状态</FieldLabel>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="records-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
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
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="records-media">媒体类型</FieldLabel>
                <Select value={mediaType} onValueChange={setMediaType}>
                  <SelectTrigger id="records-media" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">全部媒体</SelectItem>
                      <SelectItem value="episode">剧集</SelectItem>
                      <SelectItem value="movie">电影</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="records-from">开始日期</FieldLabel>
                <Input
                  id="records-from"
                  aria-label="开始日期（本地时区）"
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="records-to">结束日期</FieldLabel>
                <Input
                  id="records-to"
                  aria-label="结束日期（本地时区）"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setTo(event.target.value)}
                />
              </Field>
            </FieldGroup>

            <div className="flex justify-end gap-2">
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
              <Button type="submit">筛选</Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
              <EmptyState title="暂无同步记录" />
            )}
            <div className="mt-4 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                disabled={page === 0 || records.isPlaceholderData}
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
                  (page + 1) * 30 >= records.data.total ||
                  records.isPlaceholderData
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
              重新同步
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
        </DialogContent>
      </Dialog>
    </div>
  );
};
