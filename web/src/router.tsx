// A small history router: one path state, links that push, back/forward that pop.

import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

const RouterContext = createContext<{ path: string; search: string; go: (to: string) => void }>({
  path: "/",
  search: "",
  go: () => {},
});

/** Job 001b1: a link's path (what routes match) and its query (what a page may read). */
export function splitLocation(to: string): { path: string; search: string } {
  const noHash = to.split("#")[0] ?? "";
  const i = noHash.indexOf("?");
  const path = (i < 0 ? noHash : noHash.slice(0, i)) || "/";
  return { path, search: i < 0 ? "" : noHash.slice(i) };
}

export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));
  useEffect(() => {
    const onPop = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Job 001b/001b1: a link may carry a query (e.g. /build/:id?view=service). Routes match the
  // path only, so a query-only change keeps the page mounted; the page reads `search`.
  const go = (to: string) => {
    const next = splitLocation(to);
    const samePage = next.path === window.location.pathname;
    if (next.path + next.search !== window.location.pathname + window.location.search)
      window.history.pushState(null, "", to);
    setLoc(next);
    if (!samePage) window.scrollTo(0, 0);
  };
  return (
    <RouterContext.Provider value={{ path: loc.path, search: loc.search, go }}>
      {children}
    </RouterContext.Provider>
  );
}

export const useRouter = () => useContext(RouterContext);

/** Job 001b: one query parameter of a query string (the current location's by default). */
export function queryParam(name: string, search = window.location.search): string | null {
  try {
    return new URLSearchParams(search).get(name);
  } catch {
    return null;
  }
}

/** Matches "/studio/:id" style patterns; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] as string;
    const val = s[i] as string;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}

export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const { go } = useRouter();
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(to);
  };
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
