"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS_SV = [
  "Januari",
  "Februari",
  "Mars",
  "April",
  "Maj",
  "Juni",
  "Juli",
  "Augusti",
  "September",
  "Oktober",
  "November",
  "December",
];

const MONTHS_SHORT_SV = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

const DOW_LABELS = ["M", "T", "O", "T", "F", "L", "S"];

function isoWeekNumber(d: Date): number {
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  return 1 + Math.round((firstThursday - target.valueOf()) / 604800000);
}

interface DayCell {
  date: Date;
  inMonth: boolean;
}

interface CalendarRow {
  weekNum: number;
  days: DayCell[];
}

function calendarRows(year: number, month: number): CalendarRow[] {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const firstDow = (first.getUTCDay() + 6) % 7;

  // Monday of the first row (could be in the previous month)
  const rowStart = new Date(first);
  rowStart.setUTCDate(first.getUTCDate() - firstDow);

  const rows: CalendarRow[] = [];
  const cur = new Date(rowStart);
  // Generate at least one row, then stop once we've moved past the last day
  // of the displayed month.
  for (let safety = 0; safety < 7; safety++) {
    const days: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(
        Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + i),
      );
      days.push({ date: d, inMonth: d.getUTCMonth() === month });
    }
    rows.push({ weekNum: isoWeekNumber(new Date(cur)), days });
    cur.setUTCDate(cur.getUTCDate() + 7);
    if (cur.getTime() > last.getTime() && cur.getUTCMonth() !== month) break;
  }
  return rows;
}

function parseISO(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDisplay(iso: string): string {
  const d = parseISO(iso);
  if (!d) return "";
  return `${d.getUTCDate()} ${MONTHS_SHORT_SV[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface DatePickerProps {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  size?: "default" | "compact";
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Välj datum",
  ariaLabel,
  className,
  size = "default",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }, []);
  const initial = parseISO(value) ?? today;
  const [viewYear, setViewYear] = useState(initial.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getUTCMonth());
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [popupPos, setPopupPos] = useState<{
    top: number;
    left: number;
    placement: "below" | "above";
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Sync the displayed month to the value when the picker opens
  useEffect(() => {
    if (!open) return;
    const d = parseISO(value) ?? today;
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  }, [open, value, today]);

  // Position the popup relative to the input button using viewport coords.
  // Flip above when there isn't enough room below.
  useLayoutEffect(() => {
    if (!open) {
      setPopupPos(null);
      return;
    }
    function reposition() {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const popup = popupRef.current;
      const popupH = popup?.offsetHeight ?? 320;
      const popupW = popup?.offsetWidth ?? 296;
      const margin = 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placeAbove =
        spaceBelow < popupH + margin && spaceAbove > spaceBelow;
      const top = placeAbove
        ? Math.max(margin, rect.top - popupH - 6)
        : Math.min(window.innerHeight - popupH - margin, rect.bottom + 6);
      const left = Math.max(
        margin,
        Math.min(window.innerWidth - popupW - margin, rect.left),
      );
      setPopupPos({ top, left, placement: placeAbove ? "above" : "below" });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, viewYear, viewMonth]);

  // Close on outside click — accounts for the portaled popup.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapperRef.current && wrapperRef.current.contains(target)) return;
      if (popupRef.current && popupRef.current.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const rows = useMemo(
    () => calendarRows(viewYear, viewMonth),
    [viewYear, viewMonth],
  );
  const todayISO = toISO(today);

  function navMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  }

  function pick(d: Date) {
    onChange(toISO(d));
    setOpen(false);
  }

  function clear() {
    onChange("");
    setOpen(false);
  }

  function setToday() {
    onChange(todayISO);
    setOpen(false);
  }

  return (
    <div
      ref={wrapperRef}
      className={`date-picker ${size === "compact" ? "compact" : ""} ${
        className ?? ""
      } ${open ? "open" : ""}`}
    >
      <button
        ref={inputRef}
        type="button"
        className="date-picker-input"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          className={`date-picker-value ${!value ? "placeholder" : ""}`}
        >
          {value ? formatDisplay(value) : placeholder}
        </span>
        <span className="date-picker-icon" aria-hidden>
          <ChevronDown size={12} strokeWidth={2.25} />
        </span>
      </button>

      {open && mounted && createPortal(
        <div
          ref={popupRef}
          className={`date-picker-popup ${popupPos?.placement === "above" ? "placement-above" : "placement-below"}`}
          role="dialog"
          aria-label="Välj datum"
          style={{
            position: "fixed",
            top: popupPos?.top ?? -9999,
            left: popupPos?.left ?? -9999,
            visibility: popupPos ? "visible" : "hidden",
          }}
        >
          <header className="date-picker-header">
            <button
              type="button"
              className="icon-btn date-picker-nav"
              onClick={() => navMonth(-1)}
              aria-label="Föregående månad"
            >
              <ChevronLeft size={14} strokeWidth={2.25} aria-hidden />
            </button>
            <span className="date-picker-title">
              {MONTHS_SV[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              className="icon-btn date-picker-nav"
              onClick={() => navMonth(1)}
              aria-label="Nästa månad"
            >
              <ChevronRight size={14} strokeWidth={2.25} aria-hidden />
            </button>
          </header>

          <table className="date-picker-grid">
            <thead>
              <tr>
                <th className="date-picker-week-head">V</th>
                {DOW_LABELS.map((l, i) => (
                  <th key={i} className="date-picker-dow">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="date-picker-week-num">{row.weekNum}</td>
                  {row.days.map((cell, ci) => {
                    const iso = toISO(cell.date);
                    const isToday = iso === todayISO;
                    const isSelected = iso === value;
                    return (
                      <td key={ci} className="date-picker-day-cell">
                        <button
                          type="button"
                          className={`date-picker-day ${
                            cell.inMonth ? "" : "other-month"
                          } ${isToday ? "today" : ""} ${
                            isSelected ? "selected" : ""
                          }`}
                          onClick={() => pick(cell.date)}
                        >
                          {cell.date.getUTCDate()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="date-picker-footer">
            <button
              type="button"
              className="date-picker-quick"
              onClick={setToday}
            >
              Idag
            </button>
            {value && (
              <button
                type="button"
                className="date-picker-quick muted"
                onClick={clear}
              >
                Rensa
              </button>
            )}
          </footer>
        </div>,
        document.body,
      )}
    </div>
  );
}
