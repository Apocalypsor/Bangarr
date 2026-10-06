import { Button } from "@page/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@page/components/ui/dialog";

interface ConfirmActionProps {
  open: boolean;
  title: string;
  description: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<unknown>;
}

export const ConfirmAction = ({
  open,
  title,
  description,
  pending,
  onOpenChange,
  onConfirm,
}: ConfirmActionProps) => (
  <Dialog
    open={open}
    onOpenChange={(next) => {
      if (!pending) onOpenChange(next);
    }}
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          取消
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => {
            void onConfirm()
              .then(() => onOpenChange(false))
              .catch(() => {});
          }}
        >
          {pending ? "处理中…" : "确认"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
