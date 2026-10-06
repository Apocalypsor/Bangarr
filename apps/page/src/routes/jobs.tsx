import { TaskList } from "@page/modules/jobs/task-list";

export const JobsPage = () => (
  <div className="flex flex-col gap-6">
    <h1 className="text-3xl font-semibold tracking-tight">任务</h1>
    <TaskList />
  </div>
);
