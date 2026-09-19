/**
 * Sheaf's icon set: small, original line icons drawn on a 20×20 grid. Kept
 * inline (no icon font, no library) so they're themeable with currentColor
 * and add nothing to the dependency tree.
 */
const PATHS = {
  document:
    "M6 2.5h6l3.5 3.5v11a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-13.5a1 1 0 0 1 1-1zM12 2.5V6h3.5M7.5 10h5M7.5 13h5",
  folder: "M2.5 5.5a1 1 0 0 1 1-1h4l1.5 1.5h7.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z",
  manuscript: "M5 3.5h10v13H5zM7.5 7h5M7.5 10h5M7.5 13h3",
  research: "M8.5 3.5a5 5 0 1 1 0 10a5 5 0 0 1 0-10zM12.2 12.2l4.3 4.3",
  trash:
    "M4 6h12M8 6V4h4v2M5.5 6l.8 10.2a1 1 0 0 0 1 .8h5.4a1 1 0 0 0 1-.8L14.5 6M8.5 9v5M11.5 9v5",
  plusDocument:
    "M6 2.5h6l3.5 3.5v11a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-13.5a1 1 0 0 1 1-1zM10 8.5v6M7 11.5h6",
  plusFolder:
    "M2.5 5.5a1 1 0 0 1 1-1h4l1.5 1.5h7.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM10 8.5v5.5M7.25 11.25h5.5",
  chevron: "M8 5.5l4.5 4.5L8 14.5",
  more: "M5 10h.01M10 10h.01M15 10h.01",
  binder: "M3 3.5h14v13H3zM8 3.5v13",
  inspector: "M3 3.5h14v13H3zM12 3.5v13M14 7h1M14 10h1",
  close: "M5 5l10 10M15 5L5 15",
  back: "M12 4.5L6.5 10l5.5 5.5",
  bold: "M6 4h5a3 3 0 0 1 0 6H6zM6 10h6a3 3 0 0 1 0 6H6z",
  italic: "M9 4h6M5 16h6M12 4L8 16",
  h1: "M3.5 5v10M10.5 5v10M3.5 10h7M14 8.5l2-1.5v8",
  h2: "M3 5v10M9.5 5v10M3 10h6.5M13 8.5a2 2 0 1 1 3.5 1.3L13 15h4",
  quote: "M4.5 14.5c0-4 1-6.5 4-8M11.5 14.5c0-4 1-6.5 4-8M4.5 14.5h3v-3h-3M11.5 14.5h3v-3h-3",
  bullets: "M4 5.5h.01M4 10h.01M4 14.5h.01M7.5 5.5h9M7.5 10h9M7.5 14.5h9",
  numbers: "M3.5 4.5l1-.5v3.5M3.5 13h1.5l-1.5 2h1.5M7.5 5.5h9M7.5 10h9M7.5 14.5h9",
  scene: "M4 10h.01M10 10h.01M16 10h.01",
  up: "M10 15.5v-11M5.5 9L10 4.5 14.5 9",
  down: "M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5",
  indent: "M4 5h12M9 10h7M4 15h12M4 8l3 2-3 2",
  outdent: "M4 5h12M9 10h7M4 15h12M7 8l-3 2 3 2",
  restore: "M4.5 9.5a6 6 0 1 1 1.5 4.5M4.5 5v4.5H9",
  open: "M11.5 3.5h5v5M16.5 3.5l-7 7M14.5 11.5v4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h4",
  rename: "M3.5 16.5h3l9-9-3-3-9 9zM11 6l3 3",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  warning: "M10 3.5l7 12.5H3zM10 8.5v3.5M10 14.5h.01",
  spinner: "M10 3a7 7 0 1 1-7 7",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
