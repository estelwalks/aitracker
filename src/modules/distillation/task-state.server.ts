import type {
  CandidateOutput,
  DistillationTaskPhase,
  DistillationTaskProgress,
} from "./contracts.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const tasks = new Map<string, DistillationTaskProgress>();
const taskFile = join(homedir(), ".trusttools", "tasks", "distillation-tasks.json");
let loaded = false;

function loadTasks() {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(taskFile, "utf8")) as DistillationTaskProgress[];
    for (const task of parsed) {
      if (task?.taskId && task.phase) tasks.set(task.taskId, task);
    }
  } catch {
    // First run or an interrupted write: start with an empty task index.
  }
}

function persistTasks() {
  mkdirSync(join(homedir(), ".trusttools", "tasks"), { recursive: true });
  writeFileSync(taskFile, JSON.stringify([...tasks.values()]), "utf8");
}

export function createDistillationTask(
  kind: CandidateOutput["kind"],
): DistillationTaskProgress {
  loadTasks();
  const task: DistillationTaskProgress = {
    taskId: `distill-task:${crypto.randomUUID()}`,
    phase: "queued",
    percent: 0,
    kind,
    updatedAt: new Date().toISOString(),
  };
  tasks.set(task.taskId, task);
  persistTasks();
  return task;
}

export function updateDistillationTask(
  taskId: string,
  phase: DistillationTaskPhase,
  percent: number,
  extra: Pick<DistillationTaskProgress, "candidateId" | "candidate" | "errorCode"> = {},
): DistillationTaskProgress | undefined {
  loadTasks();
  const current = tasks.get(taskId);
  if (!current) return undefined;
  const next: DistillationTaskProgress = {
    ...current,
    ...extra,
    phase,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    updatedAt: new Date().toISOString(),
  };
  tasks.set(taskId, next);
  persistTasks();
  return next;
}

export function getDistillationTask(
  taskId: string,
): DistillationTaskProgress | null {
  loadTasks();
  return tasks.get(taskId) ?? null;
}
