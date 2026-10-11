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
import type {
  useCandidatesQuery,
  useMappingsQuery,
} from "@page/hooks/use-matching-queries";
import { api, unwrap } from "@page/lib/api";
import { candidateEpisodes, mappingScope } from "@page/modules/matching/utils";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

type Candidate = NonNullable<
  ReturnType<typeof useCandidatesQuery>["data"]
>[number];
type Mapping = NonNullable<ReturnType<typeof useMappingsQuery>["data"]>[number];
export type MappingSelection = { candidate?: Candidate; mapping?: Mapping };

export const MappingDialog = ({
  selection,
  onClose,
  onSaved,
}: {
  selection: MappingSelection;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const selected = selection.candidate;
  const mapping = selection.mapping;
  const candidateId = selected?.id;
  const mappingId = mapping?.id;
  const [title, setTitle] = useState(selected?.title ?? mapping?.title ?? "");
  const [season, setSeason] = useState(
    selected?.season ?? mapping?.season ?? 1,
  );
  const [episode, setEpisode] = useState(
    selected?.episode ?? mapping?.episode ?? -1,
  );
  const [subjectId, setSubjectId] = useState(
    mapping ? String(mapping.subjectId) : "",
  );
  const [episodeOffset, setEpisodeOffset] = useState(
    mapping?.episodeOffset ?? 0,
  );
  const [resolveSeries, setResolveSeries] = useState(
    mapping?.resolveSeries ?? false,
  );

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
        episode,
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
      onClose();
      onSaved();
      toast.success(candidateId ? "已确认匹配" : "映射已保存");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle>{candidateId ? "确认匹配结果" : "设置映射"}</DialogTitle>
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
                  {selected.episode === 0
                    ? `确认后仅重新同步 E00 的 ${selected.taskCount} 个任务，其他集数不受影响。`
                    : `确认后将重新同步以上 ${selected.taskCount} 个任务，E00 需单独确认。`}
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
                      min={episode === -1 ? -1 : 0}
                      max={100}
                      required
                      value={season}
                      disabled={Boolean(candidateId)}
                      onChange={(event) =>
                        setSeason(Number(event.target.value))
                      }
                    />
                    <FieldDescription>
                      {episode === -1
                        ? "-1 为全部季度，0 为特别篇"
                        : "指定此单集所属季度，0 为特别篇"}
                    </FieldDescription>
                  </Field>

                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="mapping-single">仅指定单集</FieldLabel>
                    <Switch
                      id="mapping-single"
                      checked={episode !== -1}
                      onCheckedChange={(checked) => {
                        setEpisode(checked ? 0 : -1);
                        if (checked) {
                          setResolveSeries(false);
                          if (season === -1) setSeason(1);
                        }
                      }}
                    />
                  </Field>

                  {episode !== -1 ? (
                    <Field>
                      <FieldLabel htmlFor="mapping-episode">
                        Plex 集数
                      </FieldLabel>
                      <Input
                        id="mapping-episode"
                        type="number"
                        min={0}
                        max={9999}
                        required
                        value={episode}
                        onChange={(event) =>
                          setEpisode(Number(event.target.value))
                        }
                      />
                      <FieldDescription>
                        只匹配这一集；第 0 集填写 0。
                      </FieldDescription>
                    </Field>
                  ) : (
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
                  min={-9999}
                  max={9999}
                  required
                  value={episodeOffset}
                  onChange={(event) =>
                    setEpisodeOffset(Number(event.target.value))
                  }
                />
                <FieldDescription>
                  偏移 = Bangumi 条目内集数 − Plex 集数。
                  {episode === -1
                    ? "应用于所选季度；单集映射优先。"
                    : `${mappingScope(episode)} 生效，其他集数沿用整季映射或自动匹配。`}
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
            onClick={onClose}
          >
            取消
          </Button>
          <Button type="submit" form="matching-form" disabled={save.isPending}>
            {save.isPending ? "保存中…" : candidateId ? "确认并同步" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
