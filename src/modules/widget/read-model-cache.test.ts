import assert from "node:assert/strict";
import test from "node:test";

import {
  readCachedWidgetReadModel,
  writeCachedWidgetReadModel,
} from "./read-model-cache";

test("widget compact cache is safe in SSR without window", () => {
  assert.equal(readCachedWidgetReadModel("zh-CN"), undefined);
  assert.doesNotThrow(() => writeCachedWidgetReadModel("zh-CN", {} as never));
});
