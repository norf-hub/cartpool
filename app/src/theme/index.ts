// Visual constants. Sizes here are BASE sizes — multiply by the large-text
// scale (see useScale in hooks/useProfile) before use, so the in-app toggle
// grows text and tap targets together (addendum §4.1).
import { MIN_TAP_TARGET_IOS_PT } from "@/theme/accessibility";

export const colors = {
  background: "#FFFFFF",
  surface: "#F6F7F8",
  text: "#1A1D1F",
  textSecondary: "#5C6570",
  accent: "#2E7D5B", // primary green
  accentText: "#FFFFFF",
  danger: "#B3261E",
  border: "#E2E5E8",
  purchased: "#9AA3AC",
};

// Per-group color tags for the merged list (spec §2). Assigned by stable
// group-id sort order so a group keeps its color between launches.
export const groupPalette = [
  "#2E7D5B", // green
  "#3A6EA5", // blue
  "#B0631C", // amber
  "#7B4FA6", // purple
  "#A63A5A", // rose
  "#3A8FA6", // teal
];

export const base = {
  fontSize: 17,
  fontSizeSmall: 13,
  fontSizeTitle: 22,
  rowMinHeight: Math.max(56, MIN_TAP_TARGET_IOS_PT),
  tapTarget: MIN_TAP_TARGET_IOS_PT,
  spacing: 12,
  radius: 10,
};
