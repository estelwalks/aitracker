import assert from "node:assert/strict";
import { describe, test as it } from "node:test";

import {
  __resetSessionReaders,
  getSessionReader,
  listSessionReaders,
  registerSessionReader,
} from "./session-readers.ts";

describe("SessionReader factory (P1-3)", () => {
  it("has no readers until the feature module registers them", () => {
    assert.equal(getSessionReader("claude-session-v1"), undefined);
    assert.equal(listSessionReaders().length, 0);
  });

  it("registers custom keys and resolves them", () => {
    const scan = async () => [];
    registerSessionReader({
      key: "fake-session-v1",
      scan,
      defaultRoots: [".fake"],
    });
    const def = getSessionReader("fake-session-v1");
    assert.equal(def?.scan, scan);
    assert.deepEqual(def?.defaultRoots, [".fake"]);
    assert.equal(listSessionReaders().length, 1);
  });

  it("rejects duplicate registration", () => {
    registerSessionReader({
      key: "dup-session-v1",
      scan: async () => [],
      defaultRoots: [],
    });
    assert.throws(
      () =>
        registerSessionReader({
          key: "dup-session-v1",
          scan: async () => [],
          defaultRoots: [],
        }),
      /already registered/,
    );
  });

  it("__resetSessionReaders clears custom registrations", () => {
    registerSessionReader({
      key: "scratch-session-v1",
      scan: async () => [],
      defaultRoots: [],
    });
    assert.ok(getSessionReader("scratch-session-v1") != null);
    __resetSessionReaders();
    assert.equal(getSessionReader("scratch-session-v1"), undefined);
    assert.equal(getSessionReader("fake-session-v1"), undefined);
    assert.equal(listSessionReaders().length, 0);
  });
});
