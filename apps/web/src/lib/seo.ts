import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SITE_URL } from "./site-url";

export { SITE_URL } from "./site-url";

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

interface PageMeta {
  title: string;
  description: string;
  /** Public pages are indexable; authenticated app pages must not be. */
  noindex?: boolean;
  path?: string;
}

/** Applies per-route title, description, canonical URL and robots policy. */
export function usePageMeta({ title, description, noindex = false, path }: PageMeta): void {
  const location = useLocation();
  const route = path ?? location.pathname;

  useEffect(() => {
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    const url = `${SITE_URL}${route === "/" ? "/" : route}`;
    setMeta("property", "og:url", url);
    setCanonical(url);
    setMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");
  }, [title, description, noindex, route]);
}
