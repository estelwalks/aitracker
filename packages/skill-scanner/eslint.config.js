import tseslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
export default [{ files: ["**/*.ts"], languageOptions: { parser, parserOptions: { project: "./tsconfig.json" } }, plugins: { "@typescript-eslint": tseslint }, rules: { ...tseslint.configs.recommended.rules, "@typescript-eslint/no-explicit-any": "error" } }];
