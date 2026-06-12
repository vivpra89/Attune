import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect } from "react";
import {
  getCustomizableState,
  OVERLAY_WIDTH_DEFAULT,
  OVERLAY_WIDTH_MAX,
  OVERLAY_WIDTH_MIN,
} from "@/lib/storage/customizable.storage";

// Helper function to check if any popover is open in the DOM
const isAnyPopoverOpen = (): boolean => {
  const popoverContents = document.querySelectorAll(
    "[data-radix-popper-content-wrapper]"
  );
  return popoverContents.length > 0;
};

const COLLAPSED_HEIGHT = 54;
const EXPANDED_HEIGHT = 600;

let overlaySizeInitialized = false;

/** Prefer the window's current logical width so resize survives stale localStorage / competing resize calls. */
async function resolveOverlayWidth(
  window: Awaited<ReturnType<typeof getCurrentWebviewWindow>>
): Promise<number> {
  const stored =
    getCustomizableState().overlayWidth ?? OVERLAY_WIDTH_DEFAULT;
  try {
    const b = await invoke<[number, number, number, number]>(
      "get_window_logical_bounds",
      { window }
    );
    const cw = b[2];
    if (cw >= OVERLAY_WIDTH_MIN && cw <= OVERLAY_WIDTH_MAX) {
      return cw;
    }
  } catch {
    /* use stored */
  }
  return stored;
}

export const useWindowResize = () => {
  const applyWindowSize = useCallback(async (expanded: boolean) => {
    try {
      const window = getCurrentWebviewWindow();
      const width = await resolveOverlayWidth(window);
      const height = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

      await invoke("set_window_size", {
        window,
        width,
        height,
      });
    } catch (error) {
      console.error("Failed to resize window:", error);
    }
  }, []);

  const resizeWindow = useCallback(
    async (expanded: boolean) => {
      try {
        if (!expanded && isAnyPopoverOpen()) {
          return;
        }

        await applyWindowSize(expanded);
      } catch (error) {
        console.error("Failed to resize window:", error);
      }
    },
    [applyWindowSize]
  );

  // Apply persisted width once (webview starts at tauri.conf defaults) + re-center horizontally
  useEffect(() => {
    if (overlaySizeInitialized) return;
    overlaySizeInitialized = true;

    const init = async () => {
      try {
        const window = getCurrentWebviewWindow();
        const width = await resolveOverlayWidth(window);
        await invoke("set_window_size", {
          window,
          width,
          height: COLLAPSED_HEIGHT,
        });
        await invoke("recenter_overlay_window", { window });
      } catch (e) {
        console.debug("Overlay init size/recenter:", e);
      }
    };
    void init();
  }, []);

  // Setup drag handling and popover monitoring
  useEffect(() => {
    let isDragging = false;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isDragRegion = target.closest('[data-tauri-drag-region="true"]');

      if (isDragRegion) {
        isDragging = true;
      }
    };

    const handleMouseUp = async () => {
      if (isDragging) {
        isDragging = false;

        setTimeout(() => {
          if (!isAnyPopoverOpen()) {
            resizeWindow(false);
          }
        }, 100);
      }
    };

    const observer = new MutationObserver(() => {
      if (!isAnyPopoverOpen()) {
        resizeWindow(false);
      }
    });

    // Observe the body for changes to detect popover open/close
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      observer.disconnect();
    };
  }, [resizeWindow]);

  return { resizeWindow, applyWindowSize };
};

interface UseWindowFocusOptions {
  onFocusLost?: () => void;
  onFocusGained?: () => void;
}

export const useWindowFocus = ({
  onFocusLost,
  onFocusGained,
}: UseWindowFocusOptions = {}) => {
  const handleFocusChange = useCallback(
    async (focused: boolean) => {
      if (focused && onFocusGained) {
        onFocusGained();
      } else if (!focused && onFocusLost) {
        onFocusLost();
      }
    },
    [onFocusLost, onFocusGained]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupFocusListener = async () => {
      try {
        const window = getCurrentWebviewWindow();

        // Listen to focus change events
        unlisten = await window.onFocusChanged(({ payload: focused }) => {
          handleFocusChange(focused);
        });
      } catch (error) {
        console.error("Failed to setup focus listener:", error);
      }
    };

    setupFocusListener();

    // Cleanup
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleFocusChange]);
};
