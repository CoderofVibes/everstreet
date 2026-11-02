// One consistent set of line icons (24px grid, 1.7 stroke, currentColor). Decorative by default.

const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
  studio: "M4 5h16v11H4zM8 20h8M12 16v4M8 9l2 2-2 2M13 13h3",
  rocket:
    "M5 15c-1.5 1.5-2 4-2 6 2 0 4.5-.5 6-2M9 15l-3-3c2-6 6.5-9 13-9 0 6.5-3 11-9 13zM14.5 9.5h.01",
  briefcase: "M4 7h16v12H4zM9 7V5h6v2M4 12h16",
  inbox: "M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  handshake: "M3 11l4-4 5 2 5-2 4 4-7 7zM7 7l5 5M12 9l4 4M9 14l2 2",
  api: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  workflow: "M4 5h6v5H4zM14 14h6v5h-6zM14 5h6v5h-6zM7 10v4a2 2 0 0 0 2 2h5",
  agent:
    "M12 3v3M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM9 13h.01M15 13h.01M9.5 16h5",
  portal: "M4 4h16v16H4zM4 9h16M9 9v11",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  layers: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
  shield: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  plug: "M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  dot: "M12 12h.01",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  store: "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size,
  label,
}: {
  name: IconName;
  size?: "sm" | "lg";
  /** Give a label only when the icon carries meaning on its own. */
  label?: string;
}) {
  return (
    <svg
      className={`icon${size ? ` ${size}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {label && <title>{label}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}

export const FOUNDATION_ICON: Record<string, IconName> = {
  ai_api: "api",
  saas_workflow: "workflow",
  agent_service: "agent",
  client_portal: "portal",
};
