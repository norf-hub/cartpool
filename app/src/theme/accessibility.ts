// Accessibility numbers from the spec/addendum. These are hard constraints:
// wireframes and code reviews flag anything that violates them.

export const MIN_TAP_TARGET_IOS_PT = 44; // every interactive element
export const MIN_TAP_TARGET_ANDROID_DP = 48;

// In-app "Large text" toggle: fixed scale applied to text AND row height
// together, so tap targets grow with the type.
export const LARGE_TEXT_SCALE = 1.4;

// OS Dynamic Type / font scaling must be honored up to this factor.
export const MAX_OS_FONT_SCALE = 2.0;

// Navigation depth budget, from app launch:
export const MAX_TAPS_ADD_ITEM = 2; // open app -> add -> type/confirm
export const MAX_TAPS_MARK_PURCHASED = 1; // no confirmation dialog (unmark is the undo)
