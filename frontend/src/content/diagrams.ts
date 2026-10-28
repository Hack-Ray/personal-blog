import { createHash } from "node:crypto";

/** Rendered SVG for each theme, keyed by diagramKey(source). */
export type Diagrams = Record<string, { light: string; dark: string }>;

export const diagramKey = (source: string) => createHash("sha256").update(source).digest("hex").slice(0, 16);

/** The id mermaid.render gets; it prefixes every id inside the SVG, so diagrams and themes never share one. */
export const diagramId = (key: string, theme: "light" | "dark") => `mermaid-${key}-${theme}`;
