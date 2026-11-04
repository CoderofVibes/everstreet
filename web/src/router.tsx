// A small history router: one path state, links that push, back/forward that pop.

import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

const RouterContext = createContext<{ path: string; go: (to: string) => void }>({
  path: "/",
  go: () => {},
});

export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Job 001b: a link may carry a query (e.g. /build/:id?view=service); routes match the path only.
  const go = (to: string) => {
    if (to !== window.location.pathname + window.location.search)
      window.history.pushState(null, "", to);
    setPath(to.split(/[?#]/)[0] || "/");
    window.scrollTo(0, 0);
  };
  return <RouterContext.Provider value={{ path, go }}>{children}</RouterContext.Provider>;
}

export const useRouter = () => useContext(RouterContext);

/** Job 001b: one query parameter of the current location (read when a page mounts). */
export function queryParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
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
