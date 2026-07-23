// Visual constants. Sizes here are BASE sizes — multiply by the large-text
// scale (see useScale in hooks/useProfile) before use, so the in-app toggle
// grows text and tap targets together (addendum §4.1).
//
// Palette + type follow the "Organic" design system (design-tool export):
// a warm cream ground, terracotta accent, sage secondary, Caprasimo display
// over Figtree body. Tokens mirror styles.css / the _ds_manifest exactly,
// except where the app's hard accessibility constraints take precedence
// (noted inline).
import { MIN_TAP_TARGET_IOS_PT } from "@/theme/accessibility";

export const colors = {
  background: "#f5ead8", // --color-bg
  surface: "#ebddc5", // --color-surface
  text: "#201e1d", // --color-text
  // RN has no color-mix(): --color-text @55% ≈ neutral-600, used for muted text.
  textSecondary: "#82796a", // --color-neutral-600
  accent: "#c67139", // --color-accent (terracotta)
  accent2: "#728157", // --color-accent-2-600 (sage) — checkmarks, hero fill kin
  // Text/icons drawn ON the accent fill. Organic uses the cream bg here; we
  // use white for a stronger contrast on small controls (a11y is a hard
  // constraint for this audience).
  accentText: "#ffffff",
  danger: "#9e2f1a", // warm red that sits in the Organic family
  border: "#dcd3c4", // --color-neutral-300 (~ --color-divider)
  purchased: "#a19786", // --color-neutral-500
  // The List "Waiting for you" hero (mockup): sage fill with cream text.
  heroBg: "#728157", // --color-accent-2-600
  heroText: "#f5ead8", // cream, same as bg
  // The trial banner strip above the hero.
  trialBg: "#fff2eb", // --color-accent-100
  trialText: "#643312", // --color-accent-800
};

// Per-person color tags for the merged cross-group list (v3.3). Drawn from
// the Organic accent + accent-2 ramps so every tag stays on-theme while
// remaining distinguishable. Assigned by stable pool order.
export const groupPalette = [
  "#c67139", // accent-500 terracotta
  "#7a8a5e", // accent-2 sage
  "#8c491a", // accent-700 burnt
  "#8fa073", // accent-2-500 light sage
  "#b2622d", // accent-600 amber-brown
  "#56633f", // accent-2-700 olive
];

// Font family names as registered by @expo-google-fonts (see App.tsx).
// Caprasimo is display-only (per the Fonts choice); Figtree carries body.
export const fonts = {
  heading: "Caprasimo_400Regular",
  body: "Figtree_400Regular",
  bodyMedium: "Figtree_600SemiBold",
  bodyBold: "Figtree_700Bold",
};

export const base = {
  fontSize: 17,
  fontSizeSmall: 13,
  fontSizeTitle: 22,
  rowMinHeight: Math.max(56, MIN_TAP_TARGET_IOS_PT),
  tapTarget: MIN_TAP_TARGET_IOS_PT,
  spacing: 12,
  radius: 16, // --radius-md (Organic softens corners)
};
