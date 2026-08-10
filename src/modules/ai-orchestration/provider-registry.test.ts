import assert from "node:assert/strict";
import test from "node:test";
import { createAiExecutor, type AIExecutorPort } from "./ai-executor.ts";
import { deterministicOfflineFallback } from "./application.ts";
import type { AIRequest } from "./contracts.ts";
import {
  createProviderRegistry,
  createRegistryRouter,
  offlineProvider,
} from "./provider-registry.ts";

const prompt = {
  id: "p1",
  version: 1,
  template: "{input}",
} as const;

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    requestId: "req-1",
    modelId: "test-model",
    prompt,
    input: { text: "hello" },
    ...overrides,
  };
}

test("createProviderRegistry: empty registry resolves nothing", () => {
  const registry = createProviderRegistry();
  assert.equal(registry.resolve("offline"), undefined);
  assert.deepEqual([...registry.list()], []);
});

test("register(offlineProvider): resolve and list expose only the stable id", () => {
  const registry = createProviderRegistry();
  registry.register(offlineProvider);
  assert.equal(registry.resolve("offline"), offlineProvider);
  assert.deepEqual([...registry.list()], ["offline"]);
});

test("createRegistryRouter.route: undefined when unregistered, provider when registered", () => {
  const empty = createProviderRegistry();
  const emptyRouter = createRegistryRouter(empty);
  assert.equal(
    emptyRouter.route(request({ providerId: "offline" })),
    undefined,
  );

  const registry = createProviderRegistry();
  registry.register(offlineProvider);
  const router = createRegistryRouter(registry);
  assert.equal(
    router.route(request({ providerId: "offline" })),
    offlineProvider,
  );
});

test("createRegistryRouter.route: falls back to 'offline' when providerId is omitted", () => {
  const registry = createProviderRegistry();
  registry.register(offlineProvider);
  const router = createRegistryRouter(registry);
  // No providerId on the request — router defaults to "offline".
  assert.equal(router.route(request()), offlineProvider);
});

test("createAiExecutor: empty ports keep executor on the deterministic offline path", async () => {
  const executor: AIExecutorPort = createAiExecutor({
    offlineFallback: deterministicOfflineFallback,
  });
  const result = await executor.execute(request());
  assert.equal(result.summary.status, "offline");
  assert.equal(
    result.response?.text,
    deterministicOfflineFallback(request()).text,
  );
  assert.equal(result.response?.text.length > 0, true);
});

test("createAiExecutor: registered offline provider routes through registry and returns offline text", async () => {
  const registry = createProviderRegistry([offlineProvider]);
  const executor = createAiExecutor({
    router: createRegistryRouter(registry),
  });
  const result = await executor.execute(request());
  assert.equal(result.summary.status, "completed");
  assert.equal(result.response?.providerId, "offline");
  assert.equal(
    result.response?.text,
    "Offline deterministic fallback: model execution was not available.",
  );
});

test("offlineProvider.invoke never echoes request.input or prompt template", async () => {
  const sensitive = request({
    input: {
      text: "top-secret-conversation-content",
      variables: { apiKey: "sk-leak-me" },
    },
    prompt: { id: "p1", version: 1, template: "SECRET-TEMPLATE-DO-NOT-LEAK" },
  });
  const response = await offlineProvider.invoke({
    modelId: sensitive.modelId,
    prompt: sensitive.prompt,
    input: sensitive.input,
    signal: new AbortController().signal,
  });
  assert.equal(response.text.includes("top-secret"), false);
  assert.equal(response.text.includes("sk-leak-me"), false);
  assert.equal(response.text.includes("SECRET-TEMPLATE"), false);
  // Only the model id is echoed back, nothing else from the request.
  assert.equal(response.modelId, "test-model");
  assert.equal(response.providerId, "offline");
});
