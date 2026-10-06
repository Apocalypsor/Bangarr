import { Alert, AlertDescription, AlertTitle } from "@page/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@page/components/ui/empty";
import { Skeleton } from "@page/components/ui/skeleton";
import { AlertCircle, Inbox } from "lucide-react";

interface EmptyStateProps {
  title?: string;
  description: string;
}

export const ErrorState = ({ error }: { error: Error }) => (
  <Alert variant="destructive">
    <AlertCircle />
    <AlertTitle>暂时无法加载</AlertTitle>
    <AlertDescription>{error.message}</AlertDescription>
  </Alert>
);

export const LoadingState = () => (
  <div className="flex flex-col gap-4">
    <Skeleton className="h-9 w-40" />
    <Skeleton className="h-64 w-full" />
  </div>
);

export const EmptyState = ({
  title = "暂无记录",
  description,
}: EmptyStateProps) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Inbox />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
  </Empty>
);
