export const projectsModuleId = "projects" as const;
export type ProjectsModuleId = typeof projectsModuleId;
export interface ProjectsModuleContract {
  readonly module: ProjectsModuleId;
  readonly schemaVersion: 1;
}
