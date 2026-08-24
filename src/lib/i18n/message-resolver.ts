import type { MessageLeaf, PluralMessage, Translations } from "./schema";

function atPath(catalog: Translations, key: string): MessageLeaf | undefined {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, catalog);
  return typeof value === "string" || isPluralMessage(value)
    ? (value as MessageLeaf)
    : undefined;
}

function isPluralMessage(value: unknown): value is PluralMessage {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as PluralMessage).one === "string" &&
    typeof (value as PluralMessage).other === "string"
  );
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (params == null) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function resolveLeaf(
  leaf: MessageLeaf,
  params?: Record<string, string | number>,
): string {
  if (typeof leaf === "string") return interpolate(leaf, params);
  return interpolate(params?.count === 1 ? leaf.one : leaf.other, params);
}

export function getMessage(
  catalog: Translations,
  key: string,
  params?: Record<string, string | number>,
  fallbackCatalog?: Translations,
): string {
  const leaf = atPath(catalog, key);
  if (leaf != null) return resolveLeaf(leaf, params);
  const fallback = fallbackCatalog && atPath(fallbackCatalog, key);
  if (fallback != null) return resolveLeaf(fallback, params);
  console.error(`[i18n] missing translation key: ${key}`);
  return key;
}
