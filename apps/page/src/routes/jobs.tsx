import { RefreshButton } from "@page/components/refresh-button";
import { TaskList } from "@page/modules/jobs/task-list";
import { useQueryClient } from "@tanstack/react-query";

export const JobsPage = () => {
  const client = useQueryClient();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">任务</h1>
        <RefreshButton
          onRefresh={() =>
            client.refetchQueries(
              { queryKey: ["jobs"], type: "active" },
              { throwOnError: true, cancelRefetch: false },
            )
          }
        />
      </header>
      <TaskList />
    </div>
  );
};
