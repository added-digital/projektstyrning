"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Webbläsarens Supabase-klient (anon-nyckeln). Används för två saker:
 *  - inloggning (magic link) och sessionshantering
 *  - Realtime-prenumerationen på customers-tabellen
 *
 * Datan läses/skrivs fortfarande via /api-routes; RLS ger authenticated
 * enbart SELECT (M7), vilket är precis vad Realtime behöver.
 */

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}
