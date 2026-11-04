/**
 * Themes: one set of colours and a font, applied to every title, callout, text, step
 * and caption in the project in one click, so a series of lessons looks the same.
 */
import type { Project } from "../project/schema";

export interface Theme {
  id: string;
  /** i18n key of the name; custom themes have `name` instead. */
  label?: string;
  name?: string;
  /** Main colour: title accents, callout borders, step numbers. */
  accent: string;
  /** Backgrounds of cards and title bars. */
  surface: string;
  /** Text on those backgrounds. */
  text: string;
  fontFamily?: string;
}

export const THEMES: Theme[] = [
  { id: "gold", label: "theme.gold", accent: "#d4a94a", surface: "#14151c", text: "#ffffff" },
  { id: "crimson", label: "theme.crimson", accent: "#c0392b", surface: "#1d1014", text: "#fff7f0" },
  { id: "sky", label: "theme.sky", accent: "#3b82f6", surface: "#0f1b33", text: "#f4f8ff" },
  { id: "forest", label: "theme.forest", accent: "#2f9e6a", surface: "#0f1f18", text: "#f2fbf6" },
  { id: "paper", label: "theme.paper", accent: "#9b1b30", surface: "#f7f1e3", text: "#20140c" },
];

/** Set the theme's colours and font on every styled clip and on the captions. */
export function applyTheme(p: Project, theme: Pick<Theme, "accent" | "surface" | "text" | "fontFamily">): Project {
  const font = theme.fontFamily ? { fontFamily: theme.fontFamily } : {};
  return {
    ...p,
    clips: p.clips.map((clip) => {
      const c = clip.content;
      switch (c.type) {
        case "title":
          return { ...clip, content: { ...c, accent: theme.accent, background: theme.surface, color: theme.text, ...font } };
        case "callout":
          return { ...clip, content: { ...c, fill: theme.surface, color: theme.text, border: theme.accent, ...font } };
        case "text":
          return { ...clip, content: { ...c, ...font } };
        case "step":
          return { ...clip, content: { ...c, fill: theme.accent, color: theme.surface } };
        case "shape":
          return { ...clip, content: { ...c, color: theme.accent } };
        default:
          return clip;
      }
    }),
    captionStyle: { ...p.captionStyle, color: theme.text, background: theme.surface, ...font },
  };
}
