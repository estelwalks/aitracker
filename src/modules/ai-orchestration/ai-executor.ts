/** Adapts the orchestration core to distillation/reports' port shape.
 *
 * Distillation declares `AIOrchestrationPort { execute(request): Promise<AIExecutionResult> }`.
 * Importing that interface here would create a reverse dependency
 * (ai-orchestration -> distillation), which the module-boundary verifier
 * forbids. Instead we declare a structurally-compatible local interface and
 * rely on TypeScript's structural typing: the returned object satisfies any
 * `AIOrchestrationPort` consumer.
 *
 * This factory is the single place production wiring will later inject real
 * providers (via a populated `AIOrchestrationPorts.router`). For now an empty
 * `ports` keeps the executor on the deterministic offline path.
 */
import { executeAIRequest } from "./application.ts";
import type {
  AIExecutionResult,
  AIRequest,
  AIOrchestrationPorts,
} from "./contracts.ts";

/**
 * Structurally compatible with `distillation/contracts.ts#AIOrchestrationPort`.
 * Do not widen this without updating the distillation port.
 */
export interface AIExecutorPort {
  execute(request: AIRequest): Promise<AIExecutionResult>;
}

export function createAiExecutor(
  ports: AIOrchestrationPorts = {},
): AIExecutorPort {
  return {
    execute(request) {
      return executeAIRequest(request, ports);
    },
  };
}
