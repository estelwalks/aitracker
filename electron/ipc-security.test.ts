import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedIpcSender } from "./ipc-security.js";

const valid = {
  senderWebContentsId: 7,
  expectedWebContentsId: 7,
  senderFrameRoutingId: 11,
  mainFrameRoutingId: 11,
  senderFrameUrl: "http://127.0.0.1:5173/security",
  allowedOrigin: "http://127.0.0.1:5173",
};

test("accepts only the expected window main frame and origin", () => {
  assert.equal(isTrustedIpcSender(valid), true);
  assert.equal(isTrustedIpcSender({ ...valid, senderWebContentsId: 8 }), false);
  assert.equal(
    isTrustedIpcSender({ ...valid, senderFrameRoutingId: 12 }),
    false,
  );
  assert.equal(
    isTrustedIpcSender({ ...valid, senderFrameUrl: "about:blank" }),
    false,
  );
  assert.equal(
    isTrustedIpcSender({
      ...valid,
      senderFrameUrl: "http://evil.invalid/security",
    }),
    false,
  );
});
