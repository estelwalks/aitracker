import { zh } from "./locales/zh-CN";

/** Shared schema types; locale dictionaries depend on this, never messages. */
export type PluralMessage = { one: string; other: string };
export type MessageLeaf = string | PluralMessage;
type DeepWiden<T> = T extends string ? string : T extends PluralMessage
  ? { one: string; other: string }
  : T extends readonly unknown[] ? { [K in keyof T]: DeepWiden<T[K]> }
  : T extends object ? { [K in keyof T]: DeepWiden<T[K]> } : T;
export type Translations = DeepWiden<typeof zh>;
export type MessageKey = Paths<typeof zh>;
type Paths<T, P extends string = ""> = {
  [K in keyof T]: T[K] extends MessageLeaf ? `${P}${K & string}` : Paths<T[K], `${P}${K & string}.`>
}[keyof T];
type At<T, K extends string> = K extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T ? At<T[Head], Tail> : never
  : K extends keyof T ? T[K] : never;
type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest> : never;
export type MessageParams<K extends MessageKey> = [Placeholders<At<typeof zh, K>>] extends [never]
  ? undefined : Record<Placeholders<At<typeof zh, K>>, string | number>;
