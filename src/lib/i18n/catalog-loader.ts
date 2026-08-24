import type { Locale } from "./locale";
import type { Translations } from "./schema";

export async function loadCatalog(locale: Locale): Promise<Translations> {
  switch (locale) {
    case "en-US":
      return (await import("./locales/en-US")).en;
    case "ja-JP":
      return (await import("./locales/ja-JP")).ja;
    case "ko-KR":
      return (await import("./locales/ko-KR")).ko;
    case "zh-CN":
      return (await import("./locales/zh-CN")).zh;
  }
}
