"use client";

import { FormEvent, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

/**
 * Inloggning via magic link. Signups är avstängda i Supabase, så bara
 * inbjudna konton kan logga in — okända adresser får samma neutrala
 * bekräftelse och ingen länk skickas.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      },
    });
    if (error) {
      // "Signups not allowed" betyder okänd adress — visa samma svar som
      // vid lyckat utskick så att sidan inte läcker vilka konton som finns.
      if (/signup/i.test(error.message)) {
        setState("sent");
        return;
      }
      setState("error");
      setMessage(error.message);
      return;
    }
    setState("sent");
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>ADDED · Projektstyrning</h1>
        {state === "sent" ? (
          <p className="login-sent">
            Om adressen har ett konto har en inloggningslänk skickats till{" "}
            <strong>{email.trim()}</strong>. Kolla inkorgen.
          </p>
        ) : (
          <form onSubmit={onSubmit}>
            <label htmlFor="login-email">E-post</label>
            <input
              id="login-email"
              type="email"
              required
              autoFocus
              placeholder="fornamn@added.digital"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={state === "sending"}
            />
            <button type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Skickar…" : "Skicka inloggningslänk"}
            </button>
            {state === "error" && <p className="login-error">{message}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
