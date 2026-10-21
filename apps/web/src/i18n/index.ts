import { useSyncExternalStore } from "react";
import { translations, type Translation } from "./landing";

export type Lang = keyof typeof translations;
export const LANGS: Lang[] = ["en", "ar", "ru"];
const STORAGE_KEY = "omnicloud-lang";

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ar" || stored === "ru") return stored;
  } catch {
    // Storage unavailable; fall back to system language.
  }
  const candidates = navigator.languages ?? [navigator.language];
  for (const raw of candidates) {
    const base = raw.toLowerCase().split("-")[0];
    if (base === "ar") return "ar";
    if (base === "ru") return "ru";
    if (base === "en") return "en";
  }
  return "en";
}

let current: Lang = typeof navigator === "undefined" ? "en" : detectLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Preference applies for this session only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLang(): [Lang, Translation, "ltr" | "rtl"] {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return [lang, translations[lang], translations[lang].meta.dir];
}
