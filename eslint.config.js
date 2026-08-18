import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "build",
      "release",
      "test-results",
      "vendor",
      "docs", // 文档目录(含外部 zip 解包样例),非本仓库代码
      "src/lib/tool-registry/public-manifest.generated.ts", // 生成产物,由 generate:manifest 重建
      "src/lib/tool-registry/definitions.generated.ts", // 生成产物,由 generate:tool-imports 重建
      "src/lib/pricing/pricing-definitions.generated.ts", // 生成产物,由 generate:pricing-imports 重建
      "src/lib/security/security-rules.generated.ts", // 生成产物,由 generate:security-rules 重建
      "src/modules/tasks/definitions/job-catalog.generated.ts", // 生成产物,由 generate:job-imports 重建
      "src/routeTree.gen.ts", // 生成产物,由 TanStack Router 插件重建
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/lib/theme.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  eslintPluginPrettier,
);
