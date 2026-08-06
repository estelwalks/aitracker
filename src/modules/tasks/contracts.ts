export const tasksModuleId = "tasks" as const;
export type TasksModuleId = typeof tasksModuleId;
export interface TasksModuleContract {
  readonly module: TasksModuleId;
  readonly schemaVersion: 1;
}
