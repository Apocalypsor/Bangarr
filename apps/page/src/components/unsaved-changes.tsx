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
          <DialogTitle>放弃未保存的修改？</DialogTitle>
          <DialogDescription>离开后，未保存的修改将丢失。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.reset?.()}>
            继续编辑
          </Button>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            放弃修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
