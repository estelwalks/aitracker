import { describe, expect, it } from "vitest";
import { normalizeKind, normalizeSeverity, redact } from "../src/model/normalize.js";

describe("normalizeKind", () => {
  it("passes through canonical slug kinds case-insensitively", () => {
    expect(normalizeKind("remote_execution")).toBe("remote_execution");
    expect(normalizeKind("PROMPT_INJECTION")).toBe("prompt_injection");
    expect(normalizeKind("network_abuse")).toBe("network_abuse");
  });
  it("maps Chinese display names", () => {
    expect(normalizeKind("远程命令执行")).toBe("remote_execution");
    expect(normalizeKind("数据泄露")).toBe("data_exfiltration");
    expect(normalizeKind("提示注入")).toBe("prompt_injection");
  });
  it("maps English display names and aliases, normalizing case/space/separators", () => {
    expect(normalizeKind("Command Injection")).toBe("command_injection");
    expect(normalizeKind("remote_code_execution")).toBe("remote_execution");
    expect(normalizeKind("  network-egress  ")).toBe("network_abuse");
    expect(normalizeKind("sql injection")).toBeNull();
  });
  it("returns null for unclassifiable or empty values", () => {
    expect(normalizeKind("some weird label")).toBeNull();
    expect(normalizeKind("")).toBeNull();
    expect(normalizeKind("   ")).toBeNull();
  });
});

describe("normalizeSeverity", () => {
  it("maps English, Chinese and alias labels to the canonical severity", () => {
    expect(normalizeSeverity("high")).toBe("high");
    expect(normalizeSeverity("高危")).toBe("high");
    expect(normalizeSeverity("严重")).toBe("critical");
    expect(normalizeSeverity("critical")).toBe("critical");
    expect(normalizeSeverity("medium")).toBe("medium");
    expect(normalizeSeverity("中危")).toBe("medium");
    expect(normalizeSeverity("警告")).toBe("medium");
    expect(normalizeSeverity("low")).toBe("low");
    expect(normalizeSeverity("低危")).toBe("low");
  });
  it("defaults unknown labels to low", () => {
    expect(normalizeSeverity("anything else")).toBe("low");
    expect(normalizeSeverity("")).toBe("low");
  });
});

describe("redact", () => {
  it("masks access keys and credentials", () => {
    expect(redact("key: sk-abcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED]");
    expect(redact("AKIA1234567890ABCDEFGH")).toContain("[REDACTED]");
    expect(redact("token=ghp_abcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED]");
    expect(redact("password=supersecretvalue123")).toContain("[REDACTED]");
  });
  it("leaves ordinary text untouched", () => {
    expect(redact("just a normal string")).toBe("just a normal string");
  });
  it("truncates long output to 240 chars", () => {
    expect(redact("x".repeat(500))).toHaveLength(240);
  });
});
