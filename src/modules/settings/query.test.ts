import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("settings route uses the public data-lifecycle facade", () => {
  const source = readFileSync(
    new URL("../../routes/settings.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /data-lifecycle\.server/);
  assert.match(source, /getStorageUsageQuery/);
  const facade = readFileSync(new URL("./query.ts", import.meta.url), "utf8");
  assert.match(facade, /applyRetentionPolicyQuery/);
  assert.match(facade, /clearRegenerableCacheQuery/);
});

test("settings query facade exposes no filesystem implementation symbols", () => {
  const source = readFileSync(new URL("./query.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:fs|node:path|homedir|readdir|rm\(/);
  assert.match(source, /await import\([\s\S]*data-lifecycle\.server/);
});

test("settings route delegates rendering to the module presentation", () => {
  const source = readFileSync(
    new URL("../../routes/settings.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.split("\n").length < 80);
  // The lazy chunk (P6-T6-04 split) renders the module presentation
  // without redefining it.
  const lazySource = readFileSync(
    new URL("../../routes/settings.lazy.tsx", import.meta.url),
    "utf8",
  );
  assert.match(lazySource, /SettingsPage/);
  assert.doesNotMatch(
    lazySource,
    /function SettingsPage|useAppSettings|AlertDialog/,
  );
});

test("model settings follow the prototype's official entry and modal form layout", () => {
  const source = readFileSync(
    new URL("./presentation/ModelProfilesSection.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /settings\.modelProfiles\.add/);
  assert.match(source, /<Dialog/);
  assert.match(source, /OFFICIAL_ENTRY_ID/);
  assert.match(source, /OFFICIAL_ENDPOINT/);
  assert.match(source, /form\.mode === "custom"/);
  assert.doesNotMatch(source, /form\.mode === "official" &&/);
  assert.match(source, /t\("common\.save"\)/);
  assert.match(source, /disabled=\{!formValid \|\| saving\}/);
  assert.doesNotMatch(source, /testPassed|setTestPassed/);
  assert.doesNotMatch(source, /modeCustomCardDesc/);
  assert.doesNotMatch(source, /saveNew|saveEdit/);
  assert.match(source, /OFFICIAL_MODEL_DISPLAY_NAME/);
  assert.match(source, /settings\.modelProfiles\.enable/);
  assert.match(source, /settings\.modelProfiles\.officialDeleteDisabled/);
  assert.match(source, /disabled=\{isOfficial\}/);
  assert.match(source, /\{endpoint\} · \{model\}/);
  assert.doesNotMatch(source, /settings\.modelProfiles\.authLabel/);
  assert.match(source, /setForm\(\(current\)/);
  assert.doesNotMatch(source, /currentActive/);
});
