import {
  ArrowRight,
  Braces,
  Check,
  CodeXml,
  Database,
  FolderTree,
  Globe,
  History,
  Languages,
  LockKeyhole,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "../components/ThemeToggle";
import { LANGS, setLang, useLang, type Lang } from "../i18n";
import { usePageMeta } from "../lib/seo";

const FEATURE_ICONS = [Send, FolderTree, History, LockKeyhole, Braces, ShieldCheck] as const;
const TRUST_ICONS = [Sparkles, Database, LockKeyhole] as const;
const SECURITY_ICONS = [LockKeyhole, ShieldCheck, Send, Braces] as const;
const STEP_NUMBERS = ["01", "02", "03"] as const;

const EASE = [0.22, 1, 0.36, 1] as const;

function Brand({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="flex items-center gap-3" aria-label="OmniCloud">
      <span className="relative h-9 w-9 shrink-0">
        <img
          src="/brand/logo-mark.svg"
          alt=""
          className="brand-mark-dark absolute inset-0 h-9 w-9"
        />
        <img
          src="/brand/logo-mark-light.svg"
          alt=""
          className="brand-mark-light absolute inset-0 h-9 w-9"
        />
      </span>
      <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
        Omni<span className="muted font-normal">Cloud</span>
      </span>
    </a>
  );
}

function LanguageSwitcher({ label }: { label: string }) {
  const [lang, t] = useLang();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface/70 px-3 text-sm font-medium hover:bg-surface"
      >
        <Languages className="h-4 w-4 text-gold-text" aria-hidden="true" />
        <span className="uppercase">{lang}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={label}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: EASE }}
            className="absolute end-0 top-11 z-40 w-40 origin-top overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-raised)]"
          >
            {LANGS.map((code) => (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={code === lang}
                onClick={() => {
                  setLang(code as Lang);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-sm hover:bg-bg-soft"
              >
                <span>{t.langSwitcher[code]}</span>
                {code === lang && (
                  <Check className="h-3.5 w-3.5 text-gold-text" aria-hidden="true" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IntroOverlay({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-bg"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-5">
        <motion.div
          initial={{ scale: 0.82, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          onAnimationComplete={onDone}
        >
          <span className="relative block h-14 w-14">
            <img
              src="/brand/logo-mark.svg"
              alt=""
              className="brand-mark-dark absolute inset-0 h-14 w-14"
            />
            <img
              src="/brand/logo-mark-light.svg"
              alt=""
              className="brand-mark-light absolute inset-0 h-14 w-14"
            />
          </span>
        </motion.div>
        <div className="h-0.5 w-32 overflow-hidden rounded-full bg-bg-soft">
          <motion.div
            className="h-full w-full origin-left rounded-full bg-gradient-to-r from-gold/70 to-gold"
            initial={{ x: "-100%" }}
            animate={{ x: "0%" }}
            transition={{ duration: 0.75, ease: EASE, delay: 0.15 }}
          />
        </div>
      </div>
    </motion.div>
  );
}

function MockDrive({
  labels,
}: {
  labels: { allFiles: string; encrypted: string; storage: string; storageUsed: string };
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      aria-hidden="true"
      initial={reduceMotion ? false : { opacity: 0, y: 26, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.35 }}
      className="rounded-[1.5rem] border border-line bg-surface/85 p-3 shadow-[var(--shadow-raised)] backdrop-blur-xl sm:p-4"
    >
      <div className="rounded-xl border border-line bg-bg/70 p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold tracking-tight">{labels.allFiles}</p>
          <span className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-gold-text">
            {labels.encrypted}
          </span>
        </div>
        <div className="grid gap-2">
          {[
            { name: "Q3 planning.pdf", meta: "2.4 MB · v3", icon: "PDF" },
            { name: "product-shots.zip", meta: "184 MB · v1", icon: "ZIP" },
            { name: "notes.md", meta: "12 KB · v7", icon: "MD" },
          ].map((file, index) => (
            <motion.div
              key={file.name}
              initial={reduceMotion ? false : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, ease: EASE, delay: 0.55 + index * 0.09 }}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface/70 px-3 py-2.5"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold/10 text-[9px] font-bold text-gold-text">
                {file.icon}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{file.name}</p>
                <p className="muted text-[11px]">{file.meta}</p>
              </div>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-line bg-surface/70 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="muted">{labels.storage}</span>
            <span className="font-medium">{labels.storageUsed}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-soft">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-gold/70 to-gold"
              initial={reduceMotion ? false : { width: 0 }}
              animate={{ width: "21%" }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.7 }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function LandingPage() {
  const [lang, t] = useLang();
  const reduceMotion = useReducedMotion();
  const [intro, setIntro] = useState(() => !reduceMotion);
  const [scrolled, setScrolled] = useState(false);
  usePageMeta({ title: t.seo.title, description: t.seo.description });

  // Give the intro a bounded lifetime even if animation callbacks misfire.
  useEffect(() => {
    if (!intro) return;
    const timer = window.setTimeout(() => setIntro(false), reduceMotion ? 0 : 1400);
    return () => window.clearTimeout(timer);
  }, [intro, reduceMotion]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = t.meta.dir;
  }, [lang, t.meta.dir]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!intro) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [intro]);

  const heroItem = (index: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 20 },
          animate: intro ? { opacity: 0, y: 20 } : { opacity: 1, y: 0 },
          transition: { duration: 0.6, ease: EASE, delay: 0.1 + index * 0.08 },
        };

  const reveal = (delay = 0) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-70px" },
          transition: { duration: 0.55, ease: EASE, delay },
        };

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg" lang={lang} dir={t.meta.dir}>
      <a href="#main" className="skip-link btn-gold">
        {t.meta.skip}
      </a>

      <AnimatePresence>
        {intro && <IntroOverlay key="intro" onDone={() => setIntro(false)} />}
      </AnimatePresence>

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-[55%] h-[32rem] w-[32rem] rounded-full bg-gold/8 blur-3xl" />
        <div className="absolute top-[38%] -left-40 h-[26rem] w-[26rem] rounded-full bg-gold/5 blur-3xl" />
      </div>

      <header
        className={`sticky top-0 z-30 transition-all duration-300 ${
          scrolled
            ? "border-b border-line bg-bg/80 backdrop-blur-xl"
            : "border-b border-transparent"
        }`}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Brand />
          <nav className="hidden items-center gap-7 text-sm muted md:flex" aria-label="Primary">
            <a href="#features" className="transition-colors hover:text-text">
              {t.nav.features}
            </a>
            <a href="#security" className="transition-colors hover:text-text">
              {t.nav.security}
            </a>
            <a href="#open-source" className="transition-colors hover:text-text">
              {t.nav.openSource}
            </a>
          </nav>
          <div className="flex items-center gap-2.5">
            <LanguageSwitcher label={t.langSwitcher.label} />
            <ThemeToggle />
            <a
              href="/login"
              className="hidden rounded-xl border border-line bg-surface/70 px-3.5 py-2 text-sm font-medium hover:bg-surface sm:block"
            >
              {t.nav.signIn}
            </a>
            <a href="/login" className="btn-gold px-3.5 py-2 text-sm">
              {t.nav.getStarted}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      <main id="main" className="relative z-10">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:pb-24 lg:pt-16">
          <div>
            <motion.div
              {...heroItem(0)}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/10 px-3.5 py-2 text-xs font-semibold tracking-wide text-gold-text"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              {t.hero.badge}
            </motion.div>
            <motion.h1
              {...heroItem(1)}
              className="text-4xl font-semibold leading-[1.08] tracking-[-0.055em] sm:text-5xl xl:text-6xl"
            >
              {t.hero.titleA}
              <br />
              <span className="text-gold-text">{t.hero.titleB}</span>
            </motion.h1>
            <motion.p {...heroItem(2)} className="muted mt-5 max-w-xl text-base leading-7">
              {t.hero.subtitle}
            </motion.p>
            <motion.div {...heroItem(3)} className="mt-7 flex flex-wrap items-center gap-3">
              <a href="/login" className="btn-gold px-5 py-2.5 text-sm">
                {t.hero.cta}
                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              </a>
              <a
                href="#open-source"
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-4 py-2.5 text-sm font-medium hover:bg-surface"
              >
                <CodeXml className="h-4 w-4" aria-hidden="true" />
                {t.hero.secondary}
              </a>
            </motion.div>
            <motion.ul
              {...heroItem(4)}
              className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs muted"
            >
              {t.hero.trust.map((item, index) => {
                const Icon = TRUST_ICONS[index] ?? Sparkles;
                return (
                  <li key={item} className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-gold-text" aria-hidden="true" />
                    {item}
                  </li>
                );
              })}
            </motion.ul>
          </div>
          <MockDrive labels={t.mock} />
        </section>

        <section id="features" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 lg:py-20">
          <motion.div {...reveal()} className="mb-10 max-w-2xl">
            <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-gold-text">
              {t.features.kicker}
            </p>
            <h2 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              {t.features.title}
            </h2>
            <p className="muted mt-3 text-base leading-7">{t.features.subtitle}</p>
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.features.items.map((feature, index) => {
              const Icon = FEATURE_ICONS[index] ?? Sparkles;
              return (
                <motion.article
                  key={feature.title}
                  {...reveal((index % 3) * 0.08)}
                  whileHover={reduceMotion ? undefined : { y: -4 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="rounded-2xl border border-line bg-surface/75 p-5 shadow-sm backdrop-blur transition-colors hover:border-line-strong"
                >
                  <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-gold/10 text-gold-text">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-[15px] font-semibold tracking-tight">{feature.title}</h3>
                  <p className="muted mt-2 text-sm leading-6">{feature.body}</p>
                </motion.article>
              );
            })}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 lg:py-20">
          <motion.div {...reveal()} className="mb-10 max-w-2xl">
            <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-gold-text">
              {t.steps.kicker}
            </p>
            <h2 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              {t.steps.title}
            </h2>
          </motion.div>
          <div className="grid gap-4 md:grid-cols-3">
            {t.steps.items.map((item, index) => (
              <motion.div
                key={item.title}
                {...reveal(index * 0.1)}
                whileHover={reduceMotion ? undefined : { y: -4 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="relative rounded-2xl border border-line bg-surface/75 p-6 shadow-sm backdrop-blur"
              >
                <p className="text-4xl font-semibold tracking-tight text-gold/25">
                  {STEP_NUMBERS[index]}
                </p>
                <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{item.title}</h3>
                <p className="muted mt-2 text-sm leading-6">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="security" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 lg:py-20">
          <motion.div
            {...reveal()}
            className="grid items-start gap-8 rounded-[1.5rem] border border-line bg-surface/75 p-6 shadow-sm backdrop-blur sm:p-10 lg:grid-cols-[0.9fr_1.1fr]"
          >
            <div>
              <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-gold-text">
                {t.security.kicker}
              </p>
              <h2 className="text-3xl font-semibold tracking-[-0.045em]">{t.security.title}</h2>
              <p className="muted mt-4 text-sm leading-6">{t.security.subtitle}</p>
              <a
                href="https://github.com/Hilbras/OmniCloud/blob/main/SECURITY.md"
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-gold-text hover:underline"
              >
                {t.security.link}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
              </a>
            </div>
            <ul className="grid gap-3 text-sm">
              {t.security.items.map((item, index) => {
                const Icon = SECURITY_ICONS[index] ?? ShieldCheck;
                return (
                  <motion.li
                    key={item}
                    {...reveal(index * 0.07)}
                    className="flex items-start gap-3 rounded-xl border border-line bg-bg/60 px-4 py-3.5"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gold-text" aria-hidden="true" />
                    <span className="muted leading-6">{item}</span>
                  </motion.li>
                );
              })}
            </ul>
          </motion.div>
        </section>

        <section id="open-source" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 lg:py-20">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <motion.div {...reveal()}>
              <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-gold-text">
                {t.openSource.kicker}
              </p>
              <h2 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
                {t.openSource.titleA}
                <br />
                {t.openSource.titleB}
              </h2>
              <p className="muted mt-4 max-w-lg text-base leading-7">{t.openSource.subtitle}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="https://github.com/Hilbras/OmniCloud"
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-4 py-2.5 text-sm font-medium hover:bg-surface"
                >
                  <Globe className="h-4 w-4" aria-hidden="true" />
                  {t.openSource.github}
                </a>
                <a
                  href="https://www.npmjs.com/package/@hilbras/omnicloud"
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-4 py-2.5 text-sm font-medium hover:bg-surface"
                >
                  <Braces className="h-4 w-4" aria-hidden="true" />
                  {t.openSource.npm}
                </a>
              </div>
            </motion.div>
            <motion.div
              {...reveal(0.1)}
              className="min-w-0 rounded-2xl border border-line bg-bg/80 p-4 shadow-sm sm:p-5"
            >
              <div className="mb-3 flex items-center gap-1.5" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              </div>
              <pre
                dir="ltr"
                className="overflow-x-auto rounded-xl bg-bg-soft/80 p-4 text-[12.5px] leading-6"
              >
                <code>
                  <span className="muted">$</span> git clone github.com/Hilbras/OmniCloud
                  {"\n"}
                  <span className="muted">$</span> cd OmniCloud && docker compose up
                  {"\n\n"}
                  <span className="text-gold-text">$</span> npx omnicloud upload notes.md
                </code>
              </pre>
              <p className="muted mt-3 px-1 text-xs">{t.openSource.note}</p>
            </motion.div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
          <motion.div
            {...reveal()}
            className="relative overflow-hidden rounded-[1.5rem] border border-gold/25 bg-gold/5 px-6 py-12 text-center sm:px-10"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-gold/10 blur-3xl"
            />
            <h2 className="relative text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              {t.cta.title}
            </h2>
            <p className="muted relative mx-auto mt-3 max-w-md text-sm leading-6">
              {t.cta.subtitle}
            </p>
            <div className="relative mt-6">
              <a href="/login" className="btn-gold px-5 py-2.5 text-sm">
                {t.cta.button}
                <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              </a>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
          <Brand />
          <nav className="flex items-center gap-5 text-xs muted" aria-label="Footer">
            <a href="#features" className="transition-colors hover:text-text">
              {t.footer.features}
            </a>
            <a
              href="https://github.com/Hilbras/OmniCloud/blob/main/SECURITY.md"
              className="transition-colors hover:text-text"
            >
              {t.footer.security}
            </a>
            <a
              href="https://github.com/Hilbras/OmniCloud"
              className="transition-colors hover:text-text"
            >
              {t.footer.github}
            </a>
            <a href="/login" className="transition-colors hover:text-text">
              {t.footer.signIn}
            </a>
          </nav>
          <p className="text-xs muted">{t.footer.license}</p>
        </div>
      </footer>
    </div>
  );
}
