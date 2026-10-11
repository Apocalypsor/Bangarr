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
import {
  MappingDialog,
  type MappingSelection,
} from "@page/modules/matching/mapping-dialog";
import { candidateEpisodes, mappingScope } from "@page/modules/matching/utils";
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

  const [editor, setEditor] = useState<MappingSelection | null>(null);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["jobs"] });
    void client.invalidateQueries({ queryKey: ["mappings"] });
    void client.invalidateQueries({ queryKey: ["candidates"] });
  };

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

  return (
    <div className="flex flex-col gap-6">
      <ConfirmAction
        open={Boolean(confirmation)}
        title={confirmation?.kind === "reject" ? "屏蔽此作品？" : "删除映射？"}
        description={
          confirmation?.kind === "reject"
            ? `「${confirmation.title}」会加入屏蔽词。`
            : "对应集数将使用其他适用映射或重新自动匹配。"
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
        <Button onClick={() => setEditor({})}>
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
                              onClick={() => setEditor({ candidate })}
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
                        <TableHead>集数范围</TableHead>
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
                          <TableCell>{mappingScope(mapping.episode)}</TableCell>
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
                              onClick={() => setEditor({ mapping })}
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

      {editor && (
        <MappingDialog
          selection={editor}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
};
