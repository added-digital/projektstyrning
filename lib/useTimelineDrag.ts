"use client";

import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  DAY_WIDTH,
  DRAG_THRESHOLD,
  WEEK_WIDTH,
  addDaysToISO,
  snapISOToWeekEnd,
  snapISOToWeekStart,
} from "./timeline";

/**
 * Gemensam drag-logik för alla staplar i tidslinjen (faser och
 * allokeringar). Tidigare fanns snarlika kopior av det här på flera ställen
 * med olika beteende — snappning per dag i fas-raderna och per vecka i
 * allokeringsraderna, pointer capture på fel element, och inget som räddade
 * draget när musen lämnade raden. Allt det bor här nu.
 *
 * Beteende:
 *  - Snappar till hela veckor. Håll ⌥ för dagsprecision.
 *  - Lyssnar på `window` under draget, så det överlever att pekaren lämnar
 *    stapeln, raden eller fönstret.
 *  - Auto-scrollar tidslinjen när pekaren närmar sig kanten, så man kan dra
 *    från v.12 till v.40 i ett svep.
 *  - Ett drag som inte rör sig mer än DRAG_THRESHOLD räknas som klick.
 */

export type DragMode = "move" | "resize-left" | "resize-right";

export interface DragRange {
  startDate: string;
  endDate: string;
}

export interface UseTimelineDragOptions {
  startDate: string;
  endDate: string;
  /** Anropas när draget släpps med en faktisk förändring. */
  onCommit: (range: DragRange) => void;
  /** Anropas när pekaren släpps utan att ha rört sig (= klick). */
  onClick?: () => void;
  /** Anropas när ett drag faktiskt startar (efter tröskeln). */
  onDragStart?: () => void;
}

export interface TimelineDragApi {
  /** Perioden som draget skulle ge just nu, eller null när inget drag pågår. */
  preview: DragRange | null;
  dragging: boolean;
  /** True när ⌥ hålls nere — dvs. dagsprecision istället för veckosnapp. */
  precise: boolean;
  /** Fäst på stapeln respektive dess resize-handtag. */
  startDrag: (e: ReactPointerEvent<HTMLElement>, mode: DragMode) => void;
}

/** Kantzon i pixlar där auto-scroll aktiveras. */
const EDGE_ZONE = 56;
/** Max scrollhastighet i pixlar per frame. */
const MAX_SCROLL_STEP = 22;

/**
 * Flyttar/ändrar en period. Med `snap` landar start alltid på en måndag och
 * slut på en söndag — vilket är precis vad rastret redan visar, eftersom
 * staplarna renderas som hela veckokolumner.
 */
export function shiftRange(
  startISO: string,
  endISO: string,
  mode: DragMode,
  dayDelta: number,
  snap: boolean,
): DragRange {
  let s = startISO;
  let e = endISO;
  if (mode === "move") {
    s = addDaysToISO(s, dayDelta);
    e = addDaysToISO(e, dayDelta);
  } else if (mode === "resize-left") {
    s = addDaysToISO(s, dayDelta);
  } else {
    e = addDaysToISO(e, dayDelta);
  }
  if (snap) {
    s = snapISOToWeekStart(s);
    e = snapISOToWeekEnd(e);
  }
  if (s > e) {
    // Kollapsa till en vecka/dag istället för att låta kanterna passera varandra.
    if (mode === "resize-left") s = snap ? snapISOToWeekStart(e) : e;
    else e = snap ? snapISOToWeekEnd(s) : s;
  }
  return { startDate: s, endDate: e };
}

interface DragSession {
  mode: DragMode;
  startX: number;
  startScrollLeft: number;
  scroller: HTMLElement | null;
  fromStart: string;
  fromEnd: string;
  moved: boolean;
  lastClientX: number;
  precise: boolean;
  raf: number | null;
  notifiedStart: boolean;
}

export function useTimelineDrag(
  opts: UseTimelineDragOptions,
): TimelineDragApi {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const sessionRef = useRef<DragSession | null>(null);
  const previewRef = useRef<DragRange | null>(null);
  const [preview, setPreviewState] = useState<DragRange | null>(null);
  const [dragging, setDragging] = useState(false);
  const [precise, setPrecise] = useState(false);

  const setPreview = useCallback((next: DragRange | null) => {
    previewRef.current = next;
    setPreviewState(next);
  }, []);

  /** Räknar om preview utifrån senast kända pekarposition + scrollposition. */
  const recompute = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const scrollDelta = s.scroller
      ? s.scroller.scrollLeft - s.startScrollLeft
      : 0;
    const dx = s.lastClientX - s.startX + scrollDelta;
    if (!s.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      s.moved = true;
      if (!s.notifiedStart) {
        s.notifiedStart = true;
        optsRef.current.onDragStart?.();
      }
    }
    if (!s.moved) return;
    const dayDelta = s.precise
      ? Math.round(dx / DAY_WIDTH)
      : Math.round(dx / WEEK_WIDTH) * 7;
    setPreview(shiftRange(s.fromStart, s.fromEnd, s.mode, dayDelta, !s.precise));
  }, [setPreview]);

  /** Auto-scroll när pekaren är nära kanten av tidslinjen. */
  const tickAutoScroll = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const el = s.scroller;
    if (el) {
      const rect = el.getBoundingClientRect();
      let step = 0;
      const leftGap = s.lastClientX - rect.left;
      const rightGap = rect.right - s.lastClientX;
      if (leftGap < EDGE_ZONE) {
        step = -Math.ceil(((EDGE_ZONE - Math.max(0, leftGap)) / EDGE_ZONE) * MAX_SCROLL_STEP);
      } else if (rightGap < EDGE_ZONE) {
        step = Math.ceil(((EDGE_ZONE - Math.max(0, rightGap)) / EDGE_ZONE) * MAX_SCROLL_STEP);
      }
      if (step !== 0) {
        const before = el.scrollLeft;
        el.scrollLeft = before + step;
        if (el.scrollLeft !== before) recompute();
      }
    }
    s.raf = window.requestAnimationFrame(tickAutoScroll);
  }, [recompute]);

  const endSession = useCallback(
    (commit: boolean) => {
      const s = sessionRef.current;
      if (!s) return;
      if (s.raf !== null) window.cancelAnimationFrame(s.raf);
      sessionRef.current = null;
      document.body.classList.remove("is-dragging-timeline");
      setDragging(false);
      setPrecise(false);

      const next = previewRef.current;
      setPreview(null);
      if (!commit) return;
      if (s.moved && next) {
        if (next.startDate !== s.fromStart || next.endDate !== s.fromEnd) {
          optsRef.current.onCommit(next);
        }
      } else if (!s.moved) {
        optsRef.current.onClick?.();
      }
    },
    [setPreview],
  );

  // Fönster-lyssnare monteras en gång och är no-ops utan aktiv session. Det
  // gör att draget överlever att pekaren lämnar stapeln eller fönstret.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const s = sessionRef.current;
      if (!s) return;
      s.lastClientX = e.clientX;
      if (s.precise !== e.altKey) {
        s.precise = e.altKey;
        setPrecise(e.altKey);
      }
      recompute();
    }
    function onUp() {
      if (sessionRef.current) endSession(true);
    }
    function onCancel() {
      if (sessionRef.current) endSession(false);
    }
    function onKey(e: KeyboardEvent) {
      const s = sessionRef.current;
      if (!s) return;
      if (e.key === "Escape") {
        endSession(false);
        return;
      }
      if (e.key === "Alt" && s.precise !== e.altKey) {
        s.precise = e.altKey;
        setPrecise(e.altKey);
        recompute();
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      if (sessionRef.current?.raf != null) {
        window.cancelAnimationFrame(sessionRef.current.raf);
      }
      document.body.classList.remove("is-dragging-timeline");
    };
  }, [recompute, endSession]);

  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, dragMode: DragMode) => {
      if (e.button !== 0) return;
      const { startDate, endDate } = optsRef.current;
      if (!startDate || !endDate) return;
      e.preventDefault();
      e.stopPropagation();
      const scroller = (e.currentTarget as HTMLElement).closest(
        ".planering-scroll",
      ) as HTMLElement | null;
      sessionRef.current = {
        mode: dragMode,
        startX: e.clientX,
        startScrollLeft: scroller ? scroller.scrollLeft : 0,
        scroller,
        fromStart: startDate,
        fromEnd: endDate,
        moved: false,
        lastClientX: e.clientX,
        precise: e.altKey,
        raf: null,
        notifiedStart: false,
      };
      document.body.classList.add("is-dragging-timeline");
      setDragging(true);
      setPrecise(e.altKey);
      sessionRef.current.raf = window.requestAnimationFrame(tickAutoScroll);
    },
    [tickAutoScroll],
  );

  return { preview, dragging, precise, startDrag };
}
