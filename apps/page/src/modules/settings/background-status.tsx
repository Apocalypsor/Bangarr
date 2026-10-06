import { ErrorState } from "@page/components/page-state";
import { Button } from "@page/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@page/components/ui/card";
import { useBackgroundJobsQuery } from "@page/hooks/use-background-jobs-query";
import { api, unwrap } from "@page/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const labels: Record<string, string> = {
  pending: "等待中",
  running: "执行中",
  succeeded: "完成",
  failed: "失败",
  cancelled: "已取消",
};

export const BackgroundStatus = () => {
  const jobs = useBackgroundJobsQuery();
  const client = useQueryClient();
  const retry = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.jobs({ id }).retry.post()),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["background-jobs"] }),
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>后台状态</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {jobs.error && <ErrorState error={jobs.error} />}
        {jobs.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">暂无后台任务。</p>
        )}
        {jobs.data?.map((job) => (
          <div
            key={job.id}
            className="flex flex-wrap items-center justify-between gap-3 text-sm"
          >
            <div>
              <p>
                {job.kind === "plex-scan" ? "Plex 扫描" : "标题索引更新"} ·{" "}
                {labels[job.state]}
              </p>
              <p className="text-muted-foreground">
                {job.lastError || new Date(job.updatedAt).toLocaleString()}
              </p>
            </div>
            {(job.state === "failed" || job.state === "cancelled") && (
              <Button
                size="sm"
                variant="outline"
                disabled={retry.isPending}
                onClick={() => retry.mutate(job.id)}
              >
                重试
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
