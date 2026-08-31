import assert from "node:assert/strict";
import test from "node:test";

import {
  readCachedWidgetReadModel,
  writeCachedWidgetReadModel,
} from "./read-model-cache";

test("widget compact cache is safe in SSR without window", async () => {
  assert.equal(await readCachedWidgetReadModel("zh-CN"), undefined);
  await assert.doesNotReject(() =>
    writeCachedWidgetReadModel("zh-CN", {} as never),
  );
});
