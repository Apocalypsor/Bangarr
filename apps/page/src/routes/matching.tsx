import { ConfirmAction } from "@page/components/confirm-action";
import { EmptyState, ErrorState } from "@page/components/page-state";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [season, setSeason] = useState(1);
  const [subjectId, setSubjectId] = useState("");
  const [episodeOffset, setEpisodeOffset] = useState(0);
  const [resolveSeries, setResolveSeries] = useState(false);

  const refresh = () => {
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

  const selected = candidates.data?.find((row) => row.id === candidateId);

  const add = () => {
    setCandidateId(null);
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
                        <TableHead>候选</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {candidates.data.map((candidate) => (
                        <TableRow key={candidate.id}>
                          <TableCell>{candidate.title}</TableCell>
                          <TableCell>{candidate.season}</TableCell>
                          <TableCell>{candidate.choices.length}</TableCell>
                          <TableCell className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setCandidateId(candidate.id);
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
                                setCandidateId(null);
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
        <DialogContent className="max-h-[85dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {candidateId ? "确认匹配结果" : "设置映射"}
            </DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="flex flex-col gap-2">
              {selected.choices.map((choice) => (
                <Button
                  key={String(choice.id)}
                  variant="outline"
                  className="justify-start"
                  disabled={save.isPending}
                  onClick={() => setSubjectId(String(choice.id))}
                >
                  {String(choice.nameCn || choice.name)} · {String(choice.id)}
                </Button>
              ))}
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <fieldset disabled={save.isPending} className="min-w-0">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="mapping-title">Plex 作品标题</FieldLabel>
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
                    onChange={(event) => setSeason(Number(event.target.value))}
                  />
                  <FieldDescription>-1 为全部季度，0 为特别篇</FieldDescription>
                </Field>

                {!candidateId && (
                  <>
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

                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "保存中…" : "保存"}
                </Button>
              </FieldGroup>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
