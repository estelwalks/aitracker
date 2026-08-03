import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const labHome = join(projectRoot, ".trusttools-lab", "first-run-home");
const prepareOnly = process.argv.includes("--prepare-only");
const seedOnly = process.argv.includes("--seed-only");

async function prepareEmptyHome() {
  await rm(labHome, { recursive: true, force: true });
  await mkdir(labHome, { recursive: true });
  process.stdout.write(`首次安装测试目录已重置：${labHome}\n`);
}

async function seedWorkbuddyUsage() {
  const sessionDirectory = join(
    labHome,
    ".workbuddy",
    "projects",
    "first-run-demo",
  );
  await mkdir(sessionDirectory, { recursive: true });
  const record = {
    id: "first-run-demo-response",
    timestamp: Date.now(),
    type: "message",
    role: "assistant",
    sessionId: "first-run-demo-session",
    cwd: join(labHome, "demo-project"),
    providerData: {
      requestModelName: "Auto",
      rawUsage: {
        prompt_tokens: 1200,
        completion_tokens: 180,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 200,
        completion_tokens_details: { reasoning_tokens: 40 },
      },
    },
  };
  await writeFile(
    join(sessionDirectory, "session.jsonl"),
    `${JSON.stringify(record)}\n`,
    "utf8",
  );
  process.stdout.write(
    `已写入无对话正文的 WorkBuddy 测试用量：${sessionDirectory}\n`,
  );
}

async function launchDesktop() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "dev:desktop"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      TRUSTTOOLS_USAGE_HOME: labHome,
    },
    stdio: "inherit",
  });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
}

if (seedOnly) {
  await mkdir(labHome, { recursive: true });
  await seedWorkbuddyUsage();
} else {
  await prepareEmptyHome();
  if (!prepareOnly) await launchDesktop();
}
