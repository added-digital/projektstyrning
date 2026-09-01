"use client";

import { useEffect, useRef, useState } from "react";

type Listener = (msg: string) => void;
let emit: Listener | null = null;

/** Show a transient toast message. No-op if the Toast component isn't mounted. */
export function showToast(msg: string) {
  if (emit) emit(msg);
}

export function Toast() {
  const [msg, setMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    emit = (m: string) => {
      setMsg(m);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setMsg(""), 2400);
    };
    return () => {
      emit = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className={`global-toast ${msg ? "show" : ""}`} role="status" aria-live="polite">
      {msg}
    </div>
  );
}
