export type Theme = "light" | "dark";

const THEME_EVENT = "omnicloud:theme-changed";
const THEME_ANIM_MS = 450;

let animTimer = 0;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * Apply a theme the same way the toggle does: 350ms color morph (unless the
 * user prefers reduced motion), dataset + storage update, then a broadcast so
 * every mounted ThemeToggle stays in sync.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) {
    root.classList.add("theme-anim");
    window.clearTimeout(animTimer);
    animTimer = window.setTimeout(() => root.classList.remove("theme-anim"), THEME_ANIM_MS);
  }
  root.dataset.theme = theme;
  try {
    localStorage.setItem("omnicloud-theme", theme);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}

export function onThemeChange(handler: (theme: Theme) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<Theme>).detail);
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
}
