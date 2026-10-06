import { ErrorState } from "@page/components/page-state";
import { Button } from "@page/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@page/components/ui/card";
import { useCatalogQuery } from "@page/hooks/use-catalog-queries";
import { api, unwrap } from "@page/lib/api";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export const TitleIndex = () => {
  const status = useCatalogQuery();
  const update = useMutation({
    mutationFn: async () => unwrap(await api.api.catalog.update.post()),
    onSuccess: () => toast.success("标题索引更新已加入队列"),
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>标题索引</CardTitle>
        <CardDescription>
          bangumi-data 提供作品标题和别名，章节信息按需在线查询。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        {status.error && <ErrorState error={status.error} />}
        <p className="text-sm text-muted-foreground">
          {status.data?.ready
            ? `${status.data.subjects.toLocaleString()} 个条目 · 更新于 ${new Date(status.data.updatedAt).toLocaleString()}`
            : "尚未建立索引，启用后会自动下载。"}
        </p>
        <Button
          variant="outline"
          disabled={update.isPending}
          onClick={() => update.mutate()}
        >
          更新标题索引
        </Button>
      </CardContent>
    </Card>
  );
};
