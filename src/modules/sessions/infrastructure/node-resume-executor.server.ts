import { spawn, type ChildProcess } from "node:child_process";

import {
  buildResumeCommandTokens,
  isResumeSafeId,
} from "../../../lib/local-sessions/resume-id.ts";
import type { ResumeSessionRequest } from "../contracts.ts";
import type { ResumeCommandExecutor } from "./session-adapter.server.ts";

type Spawn = typeof spawn;

export interface NodeResumeExecutorOptions {
  /** Test seam. Production always uses Node's `child_process.spawn`. */
  readonly spawn?: Spawn;
}

/**
 * Launches a registered resume command without a shell. The only executable
 * and arguments come from the tool registry's tokenized session plan; the
 * renderer can never supply a command, a working directory, or a file path.
 *
 * A resumed CLI is deliberately detached because it can be long-running and
 * interactive. `accepted` means the OS accepted the child process launch, not
 * that the external CLI completed a conversation recovery.
 */
export function createNodeResumeExecutor(
  options: NodeResumeExecutorOptions = {},
): ResumeCommandExecutor {
  const start = options.spawn ?? spawn;
  return {
    async execute(
      request: Pick<ResumeSessionRequest, "source" | "sessionId">,
      signal?: AbortSignal,
    ): Promise<void> {
      if (signal?.aborted) throw new Error("resume cancelled");
      if (!isResumeSafeId(request.sessionId))
        throw new Error("unsafe session id");
      const command = buildResumeCommandTokens(
        request.source,
        request.sessionId,
      );
      if (!command) throw new Error("unsupported session source");

      const [file, ...args] = command;
      if (!file) throw new Error("missing resume executable");

      await new Promise<void>((resolve, reject) => {
        let child: ChildProcess;
        let settled = false;

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", cancel);
          callback();
        };
        const cancel = () => {
          // This only handles cancellation before `spawn` confirms. After a
          // launch is accepted the child is detached and must stay independent
          // from a transient HTTP/navigation cancellation.
          child.kill();
          finish(() => reject(new Error("resume cancelled")));
        };

        try {
          child = start(file, args, {
            detached: true,
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
        } catch (error) {
          finish(() => reject(error));
          return;
        }

        signal?.addEventListener("abort", cancel, { once: true });
        // An abort may happen between the initial check and listener setup.
        // Do not let that race launch a process after its caller has gone away.
        if (signal?.aborted) {
          cancel();
          return;
        }
        child.once("error", (error) => finish(() => reject(error)));
        child.once("spawn", () =>
          finish(() => {
            child.unref();
            resolve();
          }),
        );
      });
    },
  };
}
