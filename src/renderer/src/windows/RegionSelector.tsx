/** Full-screen overlay: drag a rectangle to choose the recording region; Esc cancels. */
import { useEffect, useState } from "react";
import { useEditor } from "../store";

interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function RegionSelector() {
  const t = useEditor((s) => s.t);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && window.tdr.rec.chooseRegion(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const rect = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <div
      className="region-overlay"
      onMouseDown={(e) => setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })}
      onMouseMove={(e) => drag && e.buttons === 1 && setDrag({ ...drag, x1: e.clientX, y1: e.clientY })}
      onMouseUp={() => rect && window.tdr.rec.chooseRegion(rect)}
    >
      {!rect && <div className="region-hint">{t("record.region")} — Esc</div>}
      {rect && (
        <div className="region-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <span className="region-size" lang="en">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      )}
    </div>
  );
}
