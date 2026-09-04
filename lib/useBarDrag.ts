"use client";

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Drag/resize av staplar i beläggningsrutnätet.
 *
 * Rutnätet är vardagskolumner med fast bredd, så allt räknas i kolumner:
 * pekarens förflyttning i pixlar → hela kolumner → nya start-/slutkolumner
 * → datum via `days[]`. Helger finns inte som kolumner och kan därför
 * aldrig bli start eller slut — snappningen till vardagar är gratis.
 *
 * Beteende (ärvt från den gamla tidslinjens drag):
 *  - lyssnar på `window` under draget så det överlever att pekaren lämnar
 *    stapeln eller fönstret
 *  - auto-scrollar behållaren när pekaren närmar sig kanten
 *  - rör sig pekaren mindre än DRAG_THRESHOLD räknas det som klick
 *  - Escape avbryter
 */

export type DragMode = "move" | "resize-left" | "resize-right";

export interface ColRange {
  start: number;
  end: number;
}

export const DRAG_THRESHOLD = 4;
const EDGE_ZONE = 56;
const MAX_SCROLL_STEP = 22;

/** Ren kolumnförflyttning, klippt till [0, maxCol] och start ≤ slut. */
export function shiftCols(
  range: ColRange,
  mode: DragMode,
  delta: number,
  maxCol: number,
): ColRange {
  const clamp = (n: number) => Math.max(0, Math.min(maxCol, n));
  if (mode === "move") {
    const len = range.end - range.start;
    const start = clamp(Math.min(range.start + delta, maxCol - len));
    return { start, end: start + len };
  }
  if (mode === "resize-left") {
    return { start: Math.min(clamp(range.start + delta), range.end), end: range.end };
  }
  return { start: range.start, end: Math.max(clamp(range.end + delta), range.start) };
}

export interface UseBarDragOptions {
  cols: ColRange | null;
  dayWidth: number;
  /** Sista kolumnindex i rutnätet. */
  maxCol: number;
  /** Scrollbehållaren — för auto-scroll och för att kompensera dess scroll under draget. */
  scrollEl: HTMLElement | null;
  onCommit: (next: ColRange) => void;
}

export interface BarDragApi {
  /** Kolumnerna stapeln skulle ha just nu, eller null när inget drag pågår. */
  preview: ColRange | null;
  dragging: boolean;
  startDrag: (e: ReactPointerEvent<HTMLElement>, mode: DragMode) => void;
  /** True direkt efter ett drag — så klick-hanteraren kan låta bli att öppna popupen. */
  consumeClick: () => boolean;
}

interface DragState {
  mode: DragMode;
  from: ColRange;
  startX: number;
  startScroll: number;
  lastClientX: number;
  moved: boolean;
}

export function useBarDrag(opts: UseBarDragOptions): BarDragApi {
  const [preview, setPreview] = useState<ColRange | null>(null);
  const [dragging, setDragging] = useState(false);
  const stateRef = useRef<DragState | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const justDraggedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const compute = useCallback((clientX: number): ColRange | null => {
    const s = stateRef.current;
    const o = optsRef.current;
    if (!s) return null;
    const scrollDelta = o.scrollEl ? o.scrollEl.scrollLeft - s.startScroll : 0;
    const dx = clientX - s.startX + scrollDelta;
    const delta = Math.round(dx / o.dayWidth);
    return shiftCols(s.from, s.mode, delta, o.maxCol);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    function stopAutoScroll() {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    function autoScroll() {
      const s = stateRef.current;
      const el = optsRef.current.scrollEl;
      if (!s || !el) return;
      const rect = el.getBoundingClientRect();
      const x = s.lastClientX;
      let step = 0;
      if (x < rect.left + EDGE_ZONE) step = -Math.min(MAX_SCROLL_STEP, (rect.left + EDGE_ZONE - x) / 2);
      else if (x > rect.right - EDGE_ZONE) step = Math.min(MAX_SCROLL_STEP, (x - (rect.right - EDGE_ZONE)) / 2);
      if (step !== 0) {
        el.scrollLeft += step;
        setPreview(compute(x));
      }
      rafRef.current = requestAnimationFrame(autoScroll);
    }

    function onMove(e: PointerEvent) {
      const s = stateRef.current;
      if (!s) return;
      s.lastClientX = e.clientX;
      if (!s.moved && Math.abs(e.clientX - s.startX) < DRAG_THRESHOLD) return;
      s.moved = true;
      setPreview(compute(e.clientX));
    }

    function finish(commit: boolean) {
      const s = stateRef.current;
      stopAutoScroll();
      if (s && s.moved) {
        justDraggedRef.current = true;
        const next = commit ? compute(s.lastClientX) : null;
        if (next && (next.start !== s.from.start || next.end !== s.from.end)) {
          optsRef.current.onCommit(next);
        }
      }
      stateRef.current = null;
      setPreview(null);
      setDragging(false);
    }

    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    rafRef.current = requestAnimationFrame(autoScroll);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      stopAutoScroll();
    };
  }, [dragging, compute]);

  const startDrag = useCallback((e: ReactPointerEvent<HTMLElement>, mode: DragMode) => {
    const o = optsRef.current;
    if (!o.cols || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    stateRef.current = {
      mode,
      from: o.cols,
      startX: e.clientX,
      startScroll: o.scrollEl?.scrollLeft ?? 0,
      lastClientX: e.clientX,
      moved: false,
    };
    setDragging(true);
  }, []);

  const consumeClick = useCallback(() => {
    const was = justDraggedRef.current;
    justDraggedRef.current = false;
    return was;
  }, []);

  return { preview, dragging, startDrag, consumeClick };
}
