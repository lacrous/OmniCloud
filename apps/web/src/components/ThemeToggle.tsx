import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { onThemeChange } from "../lib/theme";

type Theme = "light" | "dark";

/** How long the color-morph class stays on <html> (CSS animates for 350ms). */
const THEME_ANIM_MS = 450;

function currentTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === "light" ? "light" : "dark";
}

/* "Sparkle" icon set (from the house design review):
   solid crescent + 4-point star for light mode,
   diamond-ray sparkle sun for dark mode.
   fill="currentColor" so the theme rules (black in light /
   gold in dark) keep applying automatically. */
function MoonSparkle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      <path d="M20 2 21.1 3.9 23 5 21.1 6.1 20 8 18.9 6.1 17 5 18.9 3.9Z" />
    </svg>
  );
}

function SunSparkle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 1.6 13.6 4.6 12 7.6 10.4 4.6Z" />
      <path d="M12 16.4 13.6 19.4 12 22.4 10.4 19.4Z" />
      <path d="M1.6 12 4.6 10.4 7.6 12 4.6 13.6Z" />
      <path d="M16.4 12 19.4 10.4 22.4 12 19.4 13.6Z" />
    </svg>
  );
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const reduceMotion = useReducedMotion();
  // External flips (e.g. keyboard actions) stay in sync via event.
  useEffect(() => onThemeChange(setTheme), []);
  const animTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("omnicloud-theme", theme);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  }, [theme]);

  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  const next: Theme = theme === "dark" ? "light" : "dark";

  function toggle() {
    if (!reduceMotion) {
      // Enable the 350ms color morph for this switch only, then clean up.
      const root = document.documentElement;
      root.classList.add("theme-anim");
      window.clearTimeout(animTimer.current);
      animTimer.current = window.setTimeout(
        () => root.classList.remove("theme-anim"),
        THEME_ANIM_MS,
      );
    }
    setTheme(next);
  }

  const iconSize = compact ? 15 : 16;
  const icon = theme === "light" ? <MoonSparkle size={iconSize} /> : <SunSparkle size={iconSize} />;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`theme-toggle relative grid place-items-center rounded-full ${compact ? "h-7 w-7" : "h-9 w-9"}`}
    >
      {reduceMotion ? (
        icon
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            className="grid place-items-center"
            initial={{ opacity: 0, scale: 0.4, rotate: -120 }}
            animate={{
              opacity: 1,
              scale: 1,
              rotate: 0,
              transition: { duration: 0.3, ease: [0.34, 1.56, 0.64, 1] },
            }}
            exit={{
              opacity: 0,
              scale: 0.4,
              rotate: 120,
              transition: { duration: 0.15, ease: "easeIn" },
            }}
          >
            {icon}
          </motion.span>
        </AnimatePresence>
      )}
    </button>
  );
}
