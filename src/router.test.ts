import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUTER_PERFORMANCE_DEFAULTS,
  routerPerformanceOptions,
} from "./router-performance.ts";

test("router keeps intent preloads and pending feedback within performance bounds", () => {
  const component = () => null;
  const options = routerPerformanceOptions(component);

  assert.equal(ROUTER_PERFORMANCE_DEFAULTS.preloadStaleTime, 30_000);
  assert.equal(options.defaultStaleTime, 30_000);
  assert.equal(options.defaultPendingMs, 100);
  assert.equal(options.defaultPendingMinMs, 200);
  assert.equal(options.defaultPendingComponent, component);
});
