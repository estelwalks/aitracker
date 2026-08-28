import assert from "node:assert/strict";
import test from "node:test";

import type { CompositionRoot } from "../../app/composition.server.ts";
import type { ModelProfileView } from "./model-profile.ts";
import {
  parseSetActiveModelProfileInput,
  resolveModelActivationLocale,
  triggerInitialInsightRefreshAfterModelActivation,
} from "./model-profile.server-fns.ts";

function root(options: {
  readonly activeId: string | null;
  readonly mode?: "rules" | "enhanced-auto";
}): CompositionRoot {
  const active =
    options.activeId === null
      ? null
      : ({ id: options.activeId } as ModelProfileView);
  return {
    modelProfiles: {
      getActiveView: async () => active,
    },
    database: {
      features: {
        insights: {
          getEffectivePreference: () => ({
            mode: options.mode ?? "enhanced-auto",
          }),
        },
      },
    },
  } as unknown as CompositionRoot;
}

test("set-active input accepts an optional supported locale and rejects unknown locales", () => {
  assert.deepEqual(
    parseSetActiveModelProfileInput({ id: "profile-1", locale: "en-US" }),
    { id: "profile-1", locale: "en-US" },
  );
  assert.deepEqual(parseSetActiveModelProfileInput({ id: "profile-1" }), {
    id: "profile-1",
  });
  assert.throws(
    () => parseSetActiveModelProfileInput({ id: "profile-1", locale: "fr-FR" }),
    /AppError/,
  );
});

test("model activation locale prefers explicit route locale, then referer, then Accept-Language", () => {
  const request = new Request("http://localhost/__tsr", {
    headers: {
      referer: "http://localhost/settings?locale=ja-JP",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  assert.equal(resolveModelActivationLocale("ko-KR", request), "ko-KR");
  assert.equal(resolveModelActivationLocale(undefined, request), "ja-JP");
  assert.equal(
    resolveModelActivationLocale(
      undefined,
      new Request("http://localhost/__tsr", {
        headers: { "accept-language": "en-GB,en;q=0.9" },
      }),
    ),
    "en-US",
  );
  assert.equal(resolveModelActivationLocale(undefined), "zh-CN");
});

test("first successful activation starts one enhanced-auto batch with the resolved locale", async () => {
  const calls: string[] = [];
  const activationRoot = root({ activeId: "profile-1" });
  const startBatch = async (locale: "zh-CN" | "en-US" | "ja-JP" | "ko-KR") => {
    calls.push(locale);
  };

  await Promise.all([
    triggerInitialInsightRefreshAfterModelActivation({
      root: activationRoot,
      profileId: "profile-1",
      wasUnconfigured: true,
      locale: "en-US",
      startBatch,
    }),
    triggerInitialInsightRefreshAfterModelActivation({
      root: activationRoot,
      profileId: "profile-1",
      wasUnconfigured: true,
      locale: "en-US",
      startBatch,
    }),
  ]);
  await triggerInitialInsightRefreshAfterModelActivation({
    root: activationRoot,
    profileId: "profile-1",
    wasUnconfigured: true,
    locale: "en-US",
    startBatch,
  });

  assert.deepEqual(calls, ["en-US"]);
});

test("activation refresh skips configured, disabled, or replaced profiles and swallows batch errors", async () => {
  let calls = 0;
  const startBatch = async () => {
    calls += 1;
    throw new Error("refresh failed");
  };

  await triggerInitialInsightRefreshAfterModelActivation({
    root: root({ activeId: "profile-1" }),
    profileId: "profile-1",
    wasUnconfigured: false,
    locale: "zh-CN",
    startBatch,
  });
  await triggerInitialInsightRefreshAfterModelActivation({
    root: root({ activeId: "profile-1", mode: "rules" }),
    profileId: "profile-1",
    wasUnconfigured: true,
    locale: "zh-CN",
    startBatch,
  });
  await triggerInitialInsightRefreshAfterModelActivation({
    root: root({ activeId: "profile-2" }),
    profileId: "profile-1",
    wasUnconfigured: true,
    locale: "zh-CN",
    startBatch,
  });
  await assert.doesNotReject(
    triggerInitialInsightRefreshAfterModelActivation({
      root: root({ activeId: "profile-1" }),
      profileId: "profile-1",
      wasUnconfigured: true,
      locale: "zh-CN",
      startBatch,
    }),
  );

  assert.equal(calls, 1);
});
