import { ConfirmAction } from "@page/components/confirm-action";
import { EmptyState, ErrorState } from "@page/components/page-state";
import { Button } from "@page/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@page/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@page/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@page/components/ui/field";
import { Input } from "@page/components/ui/input";
import { Switch } from "@page/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@page/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@page/components/ui/tabs";
import {
  useCandidatesQuery,
  useMappingsQuery,
} from "@page/hooks/use-matching-queries";
import { api, unwrap } from "@page/lib/api";
import { candidateEpisodes } from "@page/modules/matching/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Candidate = NonNullable<
  ReturnType<typeof useCandidatesQuery>["data"]
>[number];

export const MatchingPage = () => {
  const [confirmation, setConfirmation] = useState<{
    id: string;
    kind: "reject" | "delete";
    title: string;
  } | null>(null);

  const client = useQueryClient();

  const mappings = useMappingsQuery();

  const candidates = useCandidatesQuery();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const candidateId = selected?.id ?? null;
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [season, setSeason] = useState(1);
  const [subjectId, setSubjectId] = useState("");
  const [episodeOffset, setEpisodeOffset] = useState(0);
  const [resolveSeries, setResolveSeries] = useState(false);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["jobs"] });
    void client.invalidateQueries({ queryKey: ["mappings"] });
    void client.invalidateQueries({ queryKey: ["candidates"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (candidateId)
        return unwrap(
          await api.api
            .candidates({ id: candidateId })
            .resolve.post({ subjectId: Number(subjectId), episodeOffset }),
        );

      const body = {
        title,
        season,
        subjectId: Number(subjectId),
        episodeOffset,
        resolveSeries,
      };

      return unwrap(
        mappingId
          ? await api.api.mappings({ id: mappingId }).put(body)
          : await api.api.mappings.post(body),
      );
    },
    onSuccess: () => {
      setOpen(false);
      refresh();
      toast.success(candidateId ? "已确认匹配" : "映射已保存");
    },
    onError: (error) => toast.error(error.message),
  });

  const reject = useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await api.api
          .candidates({ id })
          .resolve.post({ subjectId: null, episodeOffset: 0 }),
      ),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.mappings({ id }).delete()),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  const add = () => {
    setSelected(null);
    setMappingId(null);
    setTitle("");
    setSeason(1);
    setSubjectId("");
    setEpisodeOffset(0);
    setResolveSeries(false);
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <ConfirmAction
        open={Boolean(confirmation)}
        title={confirmation?.kind === "reject" ? "屏蔽此作品？" : "删除映射？"}
        description={
          confirmation?.kind === "reject"
            ? `「${confirmation.title}」会加入屏蔽词。`
            : "之后此作品将重新自动匹配。"
        }
        pending={reject.isPending || remove.isPending}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        onConfirm={() =>
          confirmation?.kind === "reject"
            ? reject.mutateAsync(confirmation.id)
            : remove.mutateAsync(confirmation?.id ?? "")
        }
      />

      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">匹配与映射</h1>
        </div>
        <Button onClick={add}>
          <Plus data-icon="inline-start" />
          添加映射
        </Button>
      </header>

      <Tabs defaultValue="candidates">
        <TabsList>
          <TabsTrigger value="candidates">
            待确认 · {candidates.data?.length ?? 0}
          </TabsTrigger>
          <TabsTrigger value="mappings">自定义映射</TabsTrigger>
        </TabsList>

        <TabsContent value="candidates">
          {candidates.error ? (
            <ErrorState error={candidates.error} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>需要确认的作品</CardTitle>
              </CardHeader>

              <CardContent>
                {candidates.data?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>作品</TableHead>
                        <TableHead>季度</TableHead>
                        <TableHead>待匹配集数</TableHead>
                        <TableHead>候选</TableHead>
                        <TableHead>待处理任务</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {candidates.data.map((candidate) => (
                        <TableRow key={candidate.id}>
                          <TableCell>{candidate.title}</TableCell>
                          <TableCell>
                            {candidate.season === 0
                              ? "特别篇"
                              : `第 ${candidate.season} 季`}
                          </TableCell>
                          <TableCell className="max-w-xs whitespace-normal break-words">
                            {candidateEpisodes(candidate)}
                          </TableCell>
                          <TableCell>{candidate.choices.length}</TableCell>
                          <TableCell>{candidate.taskCount}</TableCell>
                          <TableCell className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setSelected(candidate);
                                setMappingId(null);
                                setTitle(candidate.title);
                                setSeason(candidate.season);
                                setSubjectId("");
                                setEpisodeOffset(0);
                                setResolveSeries(false);
                                setOpen(true);
                              }}
                            >
                              查看候选
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={reject.isPending}
                              onClick={() =>
                                setConfirmation({
                                  id: candidate.id,
                                  kind: "reject",
                                  title: candidate.title,
                                })
                              }
                            >
                              屏蔽作品
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState title="暂无待确认的作品" />
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="mappings">
          {mappings.error ? (
            <ErrorState error={mappings.error} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>自定义映射</CardTitle>
              </CardHeader>

              <CardContent>
                {mappings.data?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>作品</TableHead>
                        <TableHead>季度</TableHead>
                        <TableHead>Bangumi ID</TableHead>
                        <TableHead>集数偏移</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {mappings.data.map((mapping) => (
                        <TableRow key={mapping.id}>
                          <TableCell>{mapping.title}</TableCell>
                          <TableCell>
                            {mapping.season === -1
                              ? "全部季度"
                              : mapping.season}
                            {mapping.resolveSeries
                              ? " · 系列起点"
                              : " · 指定条目"}
                          </TableCell>
                          <TableCell>
                            <a
                              className="text-primary underline"
                              href={`https://bgm.tv/subject/${mapping.subjectId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {mapping.subjectId}
                            </a>
                          </TableCell>
                          <TableCell>{mapping.episodeOffset}</TableCell>
                          <TableCell className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setSelected(null);
                                setMappingId(mapping.id);
                                setTitle(mapping.title);
                                setSeason(mapping.season);
                                setSubjectId(String(mapping.subjectId));
                                setEpisodeOffset(mapping.episodeOffset);
                                setResolveSeries(mapping.resolveSeries);
                                setOpen(true);
                              }}
                            >
                              编辑
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={remove.isPending}
                              onClick={() =>
                                setConfirmation({
                                  id: mapping.id,
                                  kind: "delete",
                                  title: mapping.title,
                                })
                              }
                            >
                              删除
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState title="暂无自定义映射" />
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!save.isPending) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85dvh] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
          <DialogHeader className="pr-8">
            <DialogTitle>
              {candidateId ? "确认匹配结果" : "设置映射"}
            </DialogTitle>
          </DialogHeader>
          <form
            id="matching-form"
            className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-1 pb-1"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <fieldset
              disabled={save.isPending}
              className="flex min-w-0 flex-col gap-5"
            >
              {selected && (
                <div className="flex min-w-0 flex-col gap-3">
                  <p className="break-words font-medium">
                    {title} · {season === 0 ? "特别篇" : `第 ${season} 季`}
                  </p>
                  <p className="break-words font-medium">
                    待匹配：{candidateEpisodes(selected)}
                  </p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      查看各集与账号（{selected.taskCount} 个任务）
                    </summary>
                    <Table className="mt-2">
                      <TableHeader>
                        <TableRow>
                          <TableHead>集数</TableHead>
                          <TableHead>Plex 账号 / 用户</TableHead>
                          <TableHead>Bangumi 账号</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.tasks.map((task) => (
                          <TableRow key={task.jobId}>
                            <TableCell>
                              {task.mediaType === "movie"
                                ? "电影"
                                : task.episode === null
                                  ? "集数未知"
                                  : `S${season}E${task.episode}`}
                            </TableCell>
                            <TableCell className="whitespace-normal break-words">
                              {[task.plexAccountName, task.plexUser]
                                .filter(Boolean)
                                .join(" / ") || "未记录"}
                            </TableCell>
                            <TableCell className="whitespace-normal break-words">
                              {task.accountName ?? "账号已删除或不可用"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </details>
                  <p className="text-sm text-muted-foreground">
                    确认后将重新同步此季度的 {selected.taskCount} 个任务。
                  </p>
                  {selected.choices.map((choice) => {
                    const chosen = subjectId === String(choice.id);
                    const name = String(
                      choice.nameCn || choice.name || "未命名条目",
                    );

                    return (
                      <Card
                        key={String(choice.id)}
                        size="sm"
                        className={chosen ? "min-w-0 ring-primary" : "min-w-0"}
                      >
                        <CardHeader className="min-w-0">
                          <CardTitle className="break-words [overflow-wrap:anywhere]">
                            {name}
                          </CardTitle>
                          {typeof choice.name === "string" &&
                            choice.name !== name && (
                              <CardDescription className="break-words [overflow-wrap:anywhere]">
                                {choice.name}
                              </CardDescription>
                            )}
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                          <p className="text-sm text-muted-foreground">
                            放送日期：
                            {typeof choice.date === "string" && choice.date
                              ? choice.date
                              : "暂无"}{" "}
                            · ID {String(choice.id)}
                          </p>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <a
                              href={`https://bgm.tv/subject/${Number(choice.id)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-primary underline underline-offset-4"
                              aria-label={`在 Bangumi 查看${name}`}
                            >
                              在 Bangumi 查看
                            </a>
                            <Button
                              type="button"
                              variant={chosen ? "default" : "outline"}
                              aria-pressed={chosen}
                              onClick={() => setSubjectId(String(choice.id))}
                            >
                              {chosen ? "已选择" : "选择此条目"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
              <FieldGroup>
                {!candidateId && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="mapping-title">
                        Plex 作品标题
                      </FieldLabel>
                      <Input
                        id="mapping-title"
                        required
                        value={title}
                        disabled={Boolean(candidateId)}
                        onChange={(event) => setTitle(event.target.value)}
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="mapping-season">季度</FieldLabel>
                      <Input
                        id="mapping-season"
                        type="number"
                        min={-1}
                        max={100}
                        value={season}
                        disabled={Boolean(candidateId)}
                        onChange={(event) =>
                          setSeason(Number(event.target.value))
                        }
                      />
                      <FieldDescription>
                        -1 为全部季度，0 为特别篇
                      </FieldDescription>
                    </Field>

                    <Field orientation="horizontal">
                      <FieldLabel htmlFor="mapping-series">
                        自动识别季度
                      </FieldLabel>
                      <Switch
                        id="mapping-series"
                        checked={resolveSeries}
                        onCheckedChange={setResolveSeries}
                      />
                    </Field>

                    <FieldDescription>
                      开启时填写系列首部作品的 ID
                    </FieldDescription>
                  </>
                )}

                <Field>
                  <FieldLabel htmlFor="mapping-subject">
                    Bangumi 条目 ID
                  </FieldLabel>
                  <Input
                    id="mapping-subject"
                    type="number"
                    min={1}
                    required
                    value={subjectId}
                    onChange={(event) => setSubjectId(event.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="mapping-offset">集数偏移</FieldLabel>
                  <Input
                    id="mapping-offset"
                    type="number"
                    value={episodeOffset}
                    onChange={(event) =>
                      setEpisodeOffset(Number(event.target.value))
                    }
                  />
                  <FieldDescription>
                    例如 Plex 第 13 集对应 Bangumi 第 1 集，填写 -12
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </fieldset>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="matching-form"
              disabled={save.isPending}
            >
              {save.isPending ? "保存中…" : candidateId ? "确认并同步" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
