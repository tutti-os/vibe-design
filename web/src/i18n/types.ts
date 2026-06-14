import type { en } from './locales/en';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type StringKey<T> = Extract<keyof T, string>;

type DeepTranslationShape<T> = T extends string
  ? string
  : T extends Record<string, unknown>
    ? { readonly [K in keyof T]: DeepTranslationShape<T[K]> }
    : never;

type NestedLeafPaths<T> = {
  [Key in StringKey<T>]: T[Key] extends Primitive
    ? Key
    : T[Key] extends readonly unknown[]
      ? Key
      : `${Key}.${NestedLeafPaths<T[Key]>}`;
}[StringKey<T>];

export type TranslationDictionary = DeepTranslationShape<typeof en>;
export type VibeDesignI18nKey = NestedLeafPaths<typeof en>;
export type I18nParams = Record<string, string | number | boolean | null | undefined>;
