import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const projectRoot = process.cwd();

/**
 * Every shipped locale must render from a font the app carries itself.
 *
 * The failure this guards against was real: Korean is a supported locale, but
 * the font stack only bundled `Inter` plus `Noto Sans SC`, so Hangul fell
 * through to the host's fonts. A Kali install whose only CJK font was
 * DroidSansFallbackFull — which has no Hangul at all — rendered every Korean
 * string as tofu, including the language's own name in Settings. The user could
 * see the problem before switching locale, which is what made it look like an
 * encoding bug rather than a missing font.
 *
 * The second half of this test exists because the first fix silently did
 * nothing: the `@import` was preceded by a `//` comment. That is not CSS
 * syntax, so the CSS optimiser swallowed the import together with the following
 * line and reported only a warning. A grep for the font name would not have
 * caught it — the family name still appeared in the emitted CSS via the
 * `--font-sans` variable — so this asserts the import lines themselves.
 */
test("each shipped CJK locale is backed by a bundled font", () => {
  const styles = readFileSync(join(projectRoot, "src", "styles.css"), "utf8");
  const pkg = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };

  /** Locales that need a CJK face, and the @fontsource package that provides it. */
  const required = [
    {
      locale: "zh-CN",
      family: "Noto Sans SC Variable",
      pkg: "@fontsource-variable/noto-sans-sc",
    },
    {
      locale: "ko-KR",
      family: "Noto Sans KR Variable",
      pkg: "@fontsource-variable/noto-sans-kr",
    },
  ];

  for (const { locale, family, pkg: packageName } of required) {
    assert.ok(
      pkg.dependencies?.[packageName],
      `${locale}: ${packageName} must be a runtime dependency`,
    );
    assert.ok(
      styles.includes(`@import "${packageName}/wght.css";`),
      `${locale}: styles.css must import ${packageName}/wght.css`,
    );
    assert.ok(
      styles.includes(`"${family}"`),
      `${locale}: the font stack must name ${family}`,
    );
  }

  // A `//` line is not a CSS comment; it makes the optimiser drop the import.
  for (const line of styles.split("\n")) {
    if (!line.includes("@import")) continue;
    assert.ok(
      !line.trimStart().startsWith("//"),
      `"@import" must not be commented with // (it is not CSS syntax): ${line.trim()}`,
    );
  }
});

test("the font stack keeps a generic fallback last", () => {
  const styles = readFileSync(join(projectRoot, "src", "styles.css"), "utf8");
  const stack = styles.match(/--font-sans:\s*([^;]+);/u)?.[1];
  assert.ok(stack, "--font-sans must be defined");
  // Without a generic family, a missing bundled font has nothing to fall back to
  // and text can disappear entirely rather than degrade.
  assert.match(
    stack,
    /sans-serif\s*$/u,
    `--font-sans must end in sans-serif: ${stack}`,
  );
});
