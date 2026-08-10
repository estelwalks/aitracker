import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  CorrelationContext,
  ObservationInput,
  ObservationLogger,
} from "../contracts.ts";
import { redactObservation } from "../redaction.ts";

export interface NodeJsonlLoggerOptions {
  /** App-owned data root, supplied by the runtime; never inferred from HOME. */
  readonly dataRoot: string;
  readonly clock?: { now(): Date };
  readonly correlationContext?: CorrelationContext;
  readonly fileName?: string;
  readonly maxFileBytes?: number;
  /** Number of rotated archives to retain, excluding the active JSONL file. */
  readonly maxRotatedFiles?: number;
}

const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MAX_ROTATED_FILES = 3;

/** Node-only append-only JSONL adapter with bounded numbered rotation. */
export class NodeJsonlLogger implements ObservationLogger {
  private readonly fileName: string;
  private readonly maxFileBytes: number;
  private readonly maxRotatedFiles: number;
  private readonly now: () => Date;

  constructor(private readonly options: NodeJsonlLoggerOptions) {
    this.fileName = options.fileName ?? "observability.jsonl";
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxRotatedFiles = options.maxRotatedFiles ?? DEFAULT_MAX_ROTATED_FILES;
    this.now = () => options.clock?.now() ?? new Date();
    if (!/^[a-z][a-z0-9._-]*\.jsonl$/.test(this.fileName)) {
      throw new TypeError("fileName must be a relative JSONL file name");
    }
    if (!Number.isInteger(this.maxFileBytes) || this.maxFileBytes < 1) {
      throw new TypeError("maxFileBytes must be a positive integer");
    }
    if (!Number.isInteger(this.maxRotatedFiles) || this.maxRotatedFiles < 0) {
      throw new TypeError("maxRotatedFiles must be a non-negative integer");
    }
  }

  async write(input: ObservationInput): Promise<void> {
    const context = this.options.correlationContext?.current();
    const entry = redactObservation(
      {
        ...input,
        module: input.module || context?.module || "platform",
        ...(input.taskId
          ? {}
          : context?.taskId
            ? { taskId: context.taskId }
            : {}),
        ...(input.runId ? {} : context?.runId ? { runId: context.runId } : {}),
        ...(input.correlationId
          ? {}
          : context?.correlationId
            ? { correlationId: context.correlationId }
            : {}),
      },
      this.now().toISOString(),
    );
    const line = `${JSON.stringify(entry)}\n`;
    const path = join(this.options.dataRoot, this.fileName);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (
      (await this.currentSize(path)) + Buffer.byteLength(line) >
      this.maxFileBytes
    ) {
      await this.rotate(path);
    }
    await writeFile(path, line, { encoding: "utf8", flag: "a", mode: 0o600 });
  }

  private async currentSize(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch (error: unknown) {
      if (isNotFound(error)) return 0;
      throw error;
    }
  }

  private async rotate(path: string): Promise<void> {
    if (this.maxRotatedFiles === 0) {
      await removeIfPresent(path);
      return;
    }
    await removeIfPresent(`${path}.${this.maxRotatedFiles}`);
    for (let index = this.maxRotatedFiles - 1; index >= 1; index -= 1) {
      await renameIfPresent(`${path}.${index}`, `${path}.${index + 1}`);
    }
    await renameIfPresent(path, `${path}.1`);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

async function renameIfPresent(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
