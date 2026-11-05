import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import es from "./locales/es.json";
import en from "./locales/en.json";
import hi from "./locales/hi.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
      en: { translation: en },
      hi: { translation: hi },
    },
    supportedLngs: ["es", "en", "hi"],
    fallbackLng: {
      es: ["es"],
      en: ["en"],
      hi: ["en"],
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
