import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import commonEn from "./locales/en/common.json";
import commonZh from "./locales/zh-CN/common.json";
import frontingEn from "./locales/en/fronting.json";
import frontingZh from "./locales/zh-CN/fronting.json";
import loginEn from "./locales/en/login.json";
import loginZh from "./locales/zh-CN/login.json";
import overviewEn from "./locales/en/overview.json";
import overviewZh from "./locales/zh-CN/overview.json";
import clientsEn from "./locales/en/clients.json";
import clientsZh from "./locales/zh-CN/clients.json";
import usersEn from "./locales/en/users.json";
import usersZh from "./locales/zh-CN/users.json";
import auditEn from "./locales/en/audit.json";
import auditZh from "./locales/zh-CN/audit.json";
import providersEn from "./locales/en/providers.json";
import providersZh from "./locales/zh-CN/providers.json";
import grantsEn from "./locales/en/grants.json";
import grantsZh from "./locales/zh-CN/grants.json";
import issuancesEn from "./locales/en/issuances.json";
import issuancesZh from "./locales/zh-CN/issuances.json";
import signingKeysEn from "./locales/en/signingKeys.json";
import signingKeysZh from "./locales/zh-CN/signingKeys.json";
import systemEn from "./locales/en/system.json";
import systemZh from "./locales/zh-CN/system.json";
import tokensEn from "./locales/en/tokens.json";
import tokensZh from "./locales/zh-CN/tokens.json";
import resourcesEn from "./locales/en/resources.json";
import resourcesZh from "./locales/zh-CN/resources.json";

export { useTranslation } from "react-i18next";
export type Language = "zh-CN" | "en";

const preferenceKey = "authplane_language";

function storedLanguage(): Language {
  if (typeof window === "undefined") return "zh-CN";
  try {
    return window.localStorage.getItem(preferenceKey) === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

function applyDocumentLanguage(language: Language) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
    document.title = i18n.t("common:pageTitle");
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn, fronting: frontingEn, login: loginEn,
      overview: overviewEn, clients: clientsEn, users: usersEn, audit: auditEn,
      providers: providersEn, grants: grantsEn, issuances: issuancesEn,
      signingKeys: signingKeysEn, system: systemEn, tokens: tokensEn,
      resources: resourcesEn,
    },
    "zh-CN": {
      common: commonZh, fronting: frontingZh, login: loginZh,
      overview: overviewZh, clients: clientsZh, users: usersZh, audit: auditZh,
      providers: providersZh, grants: grantsZh, issuances: issuancesZh,
      signingKeys: signingKeysZh, system: systemZh, tokens: tokensZh,
      resources: resourcesZh,
    },
  },
  lng: storedLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  initAsync: false,
});

applyDocumentLanguage(i18n.language === "en" ? "en" : "zh-CN");

export async function setLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  applyDocumentLanguage(language);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(preferenceKey, language);
  } catch {
    // Private browsing can disable storage; switching still works for this page.
  }
}

export { i18n };
