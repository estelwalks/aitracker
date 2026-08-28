import { describe, expect, it } from "vitest";
import { format, getMessages } from "../src/i18n/index.js";
import { RISK_KINDS, SEVERITIES, THREAT_LEVELS, type LocaleKey } from "../src/types.js";

const LOCALES: LocaleKey[] = ["zh-CN", "en-US", "ja-JP", "ko-KR"];
const RULE_IDS = Array.from({ length: 61 }, (_, i) => `builtin-${String(i + 1).padStart(2, "0")}`);

describe("getMessages", () => {
  it("returns a complete resource for every supported locale", () => {
    for (const locale of LOCALES) {
      const m = getMessages(locale);
      for (const kind of RISK_KINDS) expect(m.kind[kind], `${locale} kind ${kind}`).toBeTruthy();
      for (const sev of SEVERITIES) expect(m.severity[sev], `${locale} severity ${sev}`).toBeTruthy();
      for (const level of THREAT_LEVELS) expect(m.threatLevel[level], `${locale} threatLevel ${level}`).toBeTruthy();
      for (const id of RULE_IDS) {
        expect(m.ruleName[id], `${locale} ruleName ${id}`).toBeTruthy();
        expect(m.ruleMessage[id], `${locale} ruleMessage ${id}`).toBeTruthy();
      }
      for (const fc of ["file-01", "file-02", "file-03", "file-04", "file-05"] as const) {
        expect(m.fileCheck[fc].name, `${locale} ${fc} name`).toBeTruthy();
        expect(m.fileCheck[fc].message, `${locale} ${fc} message`).toBeTruthy();
        expect(m.fileCheck[fc].remediation, `${locale} ${fc} remediation`).toBeTruthy();
      }
      expect(m.summary.clean, `${locale} summary`).toBeTruthy();
    }
  });
  it("translates the same rule differently per locale", () => {
    const names = LOCALES.map((l) => getMessages(l).ruleName["builtin-01"]);
    expect(new Set(names).size).toBe(LOCALES.length);
  });
  it("falls back to en-US for an unknown locale", () => {
    const m = getMessages("xx" as LocaleKey);
    expect(m.ruleName["builtin-01"]).toBe("Download-and-execute script pipe");
  });
});

describe("format", () => {
  it("interpolates string and numeric placeholders", () => {
    expect(format("scanned {count} files: {cats}", { count: 3, cats: "a, b" })).toBe("scanned 3 files: a, b");
  });
  it("keeps missing keys verbatim", () => {
    expect(format("x={n} y={missing}", { n: 42 })).toBe("x=42 y={missing}");
  });
});
