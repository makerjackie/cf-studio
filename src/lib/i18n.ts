import { useAppStore, type AppLanguage } from "@/store/useAppStore";
import { enUS } from "@/lib/i18n/en-US";
import { zhCN } from "@/lib/i18n/zh-CN";

export const translations = {
  "en-US": enUS,
  "zh-CN": zhCN,
} satisfies Record<AppLanguage, Record<keyof typeof enUS, string>>;

export type TranslationKey = keyof typeof enUS;

export function useI18n() {
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);

  const interpolate = (value: string, vars?: Record<string, string | number>) => {
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
  };

  return {
    language,
    setLanguage,
    t: (key: TranslationKey, vars?: Record<string, string | number>) =>
      interpolate(translations[language][key] ?? translations["en-US"][key] ?? key, vars),
  };
}
