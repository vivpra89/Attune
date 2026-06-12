import { STORAGE_KEYS } from "@/config";

export type CursorType = "invisible" | "default" | "auto";

/** Main overlay window width (logical px). */
export const OVERLAY_WIDTH_MIN = 400;
export const OVERLAY_WIDTH_MAX = 1200;
export const OVERLAY_WIDTH_DEFAULT = 600;

export interface CustomizableState {
  appIcon: {
    isVisible: boolean;
  };
  alwaysOnTop: {
    isEnabled: boolean;
  };
  autostart: {
    isEnabled: boolean;
  };
  cursor: {
    type: CursorType;
  };
  /** Persisted width for the frameless overlay window */
  overlayWidth: number;
}

export const DEFAULT_CUSTOMIZABLE_STATE: CustomizableState = {
  appIcon: { isVisible: true },
  alwaysOnTop: { isEnabled: false },
  autostart: { isEnabled: true },
  cursor: { type: "invisible" },
  overlayWidth: OVERLAY_WIDTH_DEFAULT,
};

export function clampOverlayWidth(width: number): number {
  return Math.min(
    OVERLAY_WIDTH_MAX,
    Math.max(OVERLAY_WIDTH_MIN, Math.round(width))
  );
}

/**
 * Get customizable state from localStorage
 */
export const getCustomizableState = (): CustomizableState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CUSTOMIZABLE);
    if (!stored) {
      return DEFAULT_CUSTOMIZABLE_STATE;
    }

    const parsedState = JSON.parse(stored);

    return {
      appIcon: parsedState.appIcon || DEFAULT_CUSTOMIZABLE_STATE.appIcon,
      alwaysOnTop:
        parsedState.alwaysOnTop || DEFAULT_CUSTOMIZABLE_STATE.alwaysOnTop,
      autostart: parsedState.autostart || DEFAULT_CUSTOMIZABLE_STATE.autostart,
      cursor: parsedState.cursor || DEFAULT_CUSTOMIZABLE_STATE.cursor,
      overlayWidth:
        typeof parsedState.overlayWidth === "number"
          ? clampOverlayWidth(parsedState.overlayWidth)
          : DEFAULT_CUSTOMIZABLE_STATE.overlayWidth,
    };
  } catch (error) {
    console.error("Failed to get customizable state:", error);
    return DEFAULT_CUSTOMIZABLE_STATE;
  }
};

/**
 * Save customizable state to localStorage
 */
export const setCustomizableState = (state: CustomizableState): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.CUSTOMIZABLE, JSON.stringify(state));
  } catch (error) {
    console.error("Failed to save customizable state:", error);
  }
};

/**
 * Update app icon visibility
 */
export const updateAppIconVisibility = (
  isVisible: boolean
): CustomizableState => {
  const currentState = getCustomizableState();
  const newState = { ...currentState, appIcon: { isVisible } };
  setCustomizableState(newState);
  return newState;
};

/**
 * Update always on top state
 */
export const updateAlwaysOnTop = (isEnabled: boolean): CustomizableState => {
  const currentState = getCustomizableState();
  const newState = { ...currentState, alwaysOnTop: { isEnabled } };
  setCustomizableState(newState);
  return newState;
};

/**
 * Update cursor type
 */
export const updateCursorType = (type: CursorType): CustomizableState => {
  const currentState = getCustomizableState();
  const newState = { ...currentState, cursor: { type } };
  setCustomizableState(newState);
  return newState;
};

/**
 * Update autostart state
 */
export const updateAutostart = (isEnabled: boolean): CustomizableState => {
  const currentState = getCustomizableState();
  const newState = { ...currentState, autostart: { isEnabled } };
  setCustomizableState(newState);
  return newState;
};

/**
 * Persist overlay window width (clamped to OVERLAY_WIDTH_MIN..OVERLAY_WIDTH_MAX).
 */
export const updateOverlayWidth = (width: number): CustomizableState => {
  const currentState = getCustomizableState();
  const newState = {
    ...currentState,
    overlayWidth: clampOverlayWidth(width),
  };
  setCustomizableState(newState);
  return newState;
};
