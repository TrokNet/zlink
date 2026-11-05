import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import es from "./locales/es.json";
import en from "./locales/en.json";
import hi from "./locales/hi.json";
import zh from "./locales/zh.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en },
      hi: { translation: hi },
      zh: { translation: zh },
    },
    supportedLngs: ["es", "en", "hi", "zh"],
    fallbackLng: {
      es: ["es"],
      en: ["en"],
      hi: ["en"],
      zh: ["en"],
      default: ["es"],
    },
    load: "languageOnly",
    keySeparator: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "zlink.language",
      caches: ["localStorage"],
    },
  });

export default i18n;
