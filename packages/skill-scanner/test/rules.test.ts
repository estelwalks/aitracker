import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, RULES_VERSION, STATIC_RULES } from "../src/rules/index.js";
import { RISK_KINDS, SEVERITIES } from "../src/types.js";

describe("static rule library", () => {
  it("ships the exact 76-rule knownsec library", () => {
    expect(STATIC_RULES).toHaveLength(76);
    expect(STATIC_RULES[0]?.id).toBe("RM_RF_ROOT");
    expect(STATIC_RULES.at(-1)?.id).toBe("DAN_MODE");
    const seen = new Set<string>();
    for (const rule of STATIC_RULES) {
      expect(RISK_KINDS).toContain(rule.kind);
      expect(SEVERITIES).toContain(rule.severity);
      expect(rule.weight).toBeGreaterThan(0);
      expect(seen.has(rule.id)).toBe(false);
      seen.add(rule.id);
      if (rule.fileTypes) expect(rule.fileTypes.length).toBeGreaterThan(0);
      if (rule.cweId) expect(rule.cweId).toMatch(/^CWE-\d+$/);
    }
  });
  it("marks high-confidence IOC/file rules as bypassVerification", () => {
    const bypass = STATIC_RULES.filter((r) => r.bypassVerification);
    expect(bypass.map((r) => r.id)).toEqual(expect.arrayContaining(["IOC_C2_IP", "IOC_EXFIL_DOMAIN", "MALICIOUS_GLOT_SNIPPET", "MALICIOUS_OPENCLAW_DOWNLOAD"]));
    for (const rule of bypass) expect(rule.weight).toBeGreaterThanOrEqual(45);
  });
  it("exposes language-specific command-injection rules scoped by file type", () => {
    const py = STATIC_RULES.find((r) => r.id === "OS_SYSTEM");
    expect(py?.fileTypes).toContain("py");
    const node = STATIC_RULES.find((r) => r.id === "NODE_CHILD_EXEC");
    expect(node?.fileTypes).toEqual(["js", "ts", "jsx", "tsx"]);
  });
  it("exports version constants", () => {
    expect(RULES_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}/);
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
