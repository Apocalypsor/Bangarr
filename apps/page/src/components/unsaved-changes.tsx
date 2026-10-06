import { Button } from "@page/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@page/components/ui/dialog";
import { useBlocker } from "@tanstack/react-router";

export const UnsavedChanges = ({ dirty }: { dirty: boolean }) => {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  return (
    <Dialog
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>离开前保存配置？</DialogTitle>
          <DialogDescription>
            当前修改尚未保存。继续编辑可以保留草稿，放弃修改会返回已保存的配置。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.reset?.()}>
            继续编辑
          </Button>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            放弃修改并离开
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
