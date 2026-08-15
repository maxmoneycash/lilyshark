/** Color themes: they only change --fg/--bg/--panel/--map-tint; the rest of
 *  the theme (dim, border, glow) derives from --fg via color-mix in meshterm.css.
 *  Ported from meshcore-terminal (MIT). */
import { useEffect, useState } from "react";

/** `tint` colours the map tiles. CSS hue-rotate is a matrix approximation, not
 *  a real HSL rotation, so these can't be derived from fg by hand; theme.test.ts
 *  reproduces the chain and checks each one lands on its theme's hue. The rest
 *  of the filter chain lives in meshterm.css.
 *
 *  `hc` is the same hue at full saturation, over `hcBg` (pure black on the dark
 *  themes, pure white on the light one) when high contrast is on. Violet is
 *  lighter than the rest because that hue is intrinsically dark: saturating it
 *  costs luminance, and the point of the mode is to gain it. theme.test.ts
 *  checks every one really contrasts more. */
export const THEMES = {
	/* Light paper, pink ink. The brand pink (#FF4F9D) only reaches 2.8:1 against
	   a near-white page, so text runs at a deeper tone of the same hue and the
	   bright pink is kept for fills and the wordmark, where the type is large
	   enough for the 3:1 rule. */
	lilyshark: {
		fg: "#C00068",
		hc: "#8A0049",
		bg: "#F2E2EC",
		panel: "#FBF3F7",
		hcBg: "#FFFFFF",
		tint: "hue-rotate(281deg) saturate(1.8)",
	},
	verde: {
		fg: "#39ff5a",
		hc: "#4dff6a",
		bg: "#0a0f0a",
		panel: "#0b110b",
		hcBg: "#000000",
		tint: "hue-rotate(83deg) saturate(2.2)",
	},
	ambar: {
		fg: "#e8a84c",
		hc: "#ffb64d",
		bg: "#0f0c07",
		panel: "#130f09",
		hcBg: "#000000",
		tint: "hue-rotate(-9deg) saturate(2)",
	},
	cian: {
		fg: "#5ccfe6",
		hc: "#4de1ff",
		bg: "#070f13",
		panel: "#091316",
		hcBg: "#000000",
		tint: "hue-rotate(141deg) saturate(1.8)",
	},
	hueso: {
		fg: "#cfcfc2",
		hc: "#ffffff",
		bg: "#0d0d0c",
		panel: "#111110",
		hcBg: "#000000",
		tint: "saturate(0.3)",
	},
	huesoinv: {
		fg: "#2b2b26",
		hc: "#000000",
		bg: "#e8e6dd",
		panel: "#dcdad0",
		hcBg: "#ffffff",
		tint: "saturate(0.3)",
	},
	violeta: {
		fg: "#b3a5e3",
		hc: "#b9a3ff",
		bg: "#0c0a12",
		panel: "#0f0c16",
		hcBg: "#000000",
		tint: "hue-rotate(216deg) saturate(1.5)",
	},
} as const;

export type Theme = keyof typeof THEMES;

/** Menu names, in Spanish (the base language) so t() translates them. They live
 *  here and not in Config.tsx so i18n.test.ts can walk them: t(THEME_LABELS[x])
 *  hides the literals from its source scan, and a new theme went untranslated
 *  because the check kept its own hand-written copy of the list. */
export const THEME_LABELS: Record<Theme, string> = {
	lilyshark: "LILYSHARK",
	verde: "VERDE FÓSFORO",
	ambar: "ÁMBAR",
	cian: "CIAN",
	hueso: "HUESO",
	huesoinv: "HUESO INVERTIDO",
	violeta: "VIOLETA",
};

/** Light-background themes: the map filter chain and the second color flip.
 *  Everything else derives from --fg/--bg and needs no special case. */
const CLAROS = new Set<Theme>(["lilyshark", "huesoinv"]);

export function isLight(): boolean {
	return CLAROS.has(getTheme());
}

const THEME_KEY = "theme";
const HC_KEY = "hicontrast";
const THEME_EVENT = "themechange";

export function getTheme(): Theme {
	const saved = localStorage.getItem(THEME_KEY);
	return saved && saved in THEMES ? (saved as Theme) : "lilyshark";
}

export function getHiContrast(): boolean {
	return localStorage.getItem(HC_KEY) === "1";
}

export function applyTheme(): void {
	const th = THEMES[getTheme()];
	const hc = getHiContrast();
	// The terminal UI is scoped under .meshterm (see meshterm.css), so the vars
	// go both on :root (fallback outside the wrapper) and on every mounted
	// .meshterm wrapper, whose own defaults would otherwise shadow :root's.
	const targets: HTMLElement[] = [
		document.documentElement,
		...document.querySelectorAll<HTMLElement>(".meshterm"),
	];
	for (const el of targets) {
		el.style.setProperty("--fg", hc ? th.hc : th.fg);
		el.style.setProperty("--bg", hc ? th.hcBg : th.bg);
		el.style.setProperty("--panel", hc ? th.hcBg : th.panel);
		el.style.setProperty("--map-tint", th.tint);
	}
	// the stronger --fg-dim/--border/--glow mixes, and dropping the CRT overlay,
	// live in meshterm.css under :root.hc
	document.documentElement.classList.toggle("hc", hc);
	// map tiles, color-scheme and a softer CRT overlay live under :root.light
	document.documentElement.classList.toggle("light", isLight());
}

/** Text color of the active theme, for canvas/SVG that can't read CSS vars
 *  (uPlot, Leaflet markers). Accepts a hex alpha suffix: fg("88"). */
export function fg(alpha = ""): string {
	const th = THEMES[getTheme()];
	return (getHiContrast() ? th.hc : th.fg) + alpha;
}

/** Second color, legible over any of the themes: the neutral extreme opposite
 *  to the background (near-white on the dark themes, near-black on the light). */
export function accent(): string {
	return isLight() ? "#111111" : "#e6e6e6";
}

export function setTheme(name: Theme): void {
	localStorage.setItem(THEME_KEY, name);
	applyTheme(); // live, without reloading
	// CSS vars repaint on their own; canvas and SVG don't, they have to be told
	window.dispatchEvent(new Event(THEME_EVENT));
}

export function setHiContrast(on: boolean): void {
	localStorage.setItem(HC_KEY, on ? "1" : "0");
	applyTheme();
	window.dispatchEvent(new Event(THEME_EVENT));
}

/** Re-renders the component when the theme changes. Needed by whatever draws
 *  with fg()/ACCENT instead of CSS vars: uPlot, Leaflet, the mesh SVG. */
export function useThemeTick(): number {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const on = () => setTick((v) => v + 1);
		window.addEventListener(THEME_EVENT, on);
		return () => window.removeEventListener(THEME_EVENT, on);
	}, []);
	return tick;
}
