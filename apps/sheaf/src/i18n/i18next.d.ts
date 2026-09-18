// Makes translation keys type-checked: `t("phase0.notic")` is a compile error.
// English is the source of truth for the key set; the locale test enforces
// that every other locale has the same keys.
import "i18next";
import type common from "../locales/en/common.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: { common: typeof common };
  }
}
