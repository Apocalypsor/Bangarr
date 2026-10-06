import { Button } from "@page/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface RefreshButtonProps {
  onRefresh: () => Promise<unknown>;
}

export const RefreshButton = ({ onRefresh }: RefreshButtonProps) => {
  const refresh = useMutation({
    mutationFn: onRefresh,
    onSuccess: () => toast.success("已刷新"),
    onError: (error) => toast.error(error.message || "刷新失败，请重试"),
  });

  return (
    <Button
      type="button"
      variant="outline"
      className="w-28 shrink-0"
      disabled={refresh.isPending}
      aria-busy={refresh.isPending}
      onClick={() => refresh.mutate()}
    >
      <RefreshCw
        data-icon="inline-start"
        className={refresh.isPending ? "animate-spin" : undefined}
      />
      {refresh.isPending ? "刷新中…" : "刷新"}
    </Button>
  );
};
