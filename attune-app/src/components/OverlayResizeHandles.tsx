import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  clampOverlayWidth,
  updateOverlayWidth,
} from "@/lib/storage/customizable.storage";

type Edge = "left" | "right";

/**
 * Thin drag zones on the left/right edges of the overlay to resize window width.
 */
export function OverlayResizeHandles() {
  const draggingRef = useRef<Edge | null>(null);

  const startResize = useCallback((edge: Edge, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = edge;

    const win = getCurrentWebviewWindow();
    const startMouseX = e.clientX;

    void (async () => {
      try {
        const bounds = await invoke<[number, number, number, number]>(
          "get_window_logical_bounds",
          { window: win }
        );
        const [startX, startY, startW, startH] = bounds;
        const rightEdge = startX + startW;

        const onMove = async (ev: MouseEvent) => {
          if (!draggingRef.current) return;
          try {
            if (draggingRef.current === "right") {
              const newW = clampOverlayWidth(
                startW + (ev.clientX - startMouseX)
              );
              await invoke("set_window_logical_bounds", {
                window: win,
                x: startX,
                y: startY,
                width: newW,
                height: startH,
              });
            } else {
              const newW = clampOverlayWidth(
                startW - (ev.clientX - startMouseX)
              );
              const newX = rightEdge - newW;
              await invoke("set_window_logical_bounds", {
                window: win,
                x: newX,
                y: startY,
                width: newW,
                height: startH,
              });
            }
          } catch (err) {
            console.error("Resize drag:", err);
          }
        };

        const onUp = async () => {
          draggingRef.current = null;
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          try {
            const b = await invoke<[number, number, number, number]>(
              "get_window_logical_bounds",
              { window: win }
            );
            updateOverlayWidth(b[2]);
          } catch {
            /* ignore */
          }
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      } catch (err) {
        console.error("Failed to start overlay resize:", err);
        draggingRef.current = null;
      }
    })();
  }, []);

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize overlay from left edge"
        className="absolute left-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize hover:bg-primary/15"
        onMouseDown={(e) => startResize("left", e)}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize overlay from right edge"
        className="absolute right-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize hover:bg-primary/15"
        onMouseDown={(e) => startResize("right", e)}
      />
    </>
  );
}
