import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase-klient med service-role-nyckeln. Passerar förbi RLS,
 * så den får bara importeras från route handlers och lib/storage.ts — aldrig
 * från "use client"-filer. `import "server-only"` gör det till ett byggfel
 * om någon råkar dra in den i klient-bundeln.
 *
 * En modul-global instans räcker: supabase-js pratar PostgREST över HTTP,
 * så det finns ingen connection pool att svälta i serverless.
 */

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase saknar konfiguration: sätt NEXT_PUBLIC_SUPABASE_URL och " +
        "SUPABASE_SERVICE_ROLE_KEY i .env.local (lokalt) eller i Vercels " +
        "environment variables (deploy).",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Nexts fetch-patch kan annars lägga PostgREST-svar i Data Cache på
      // Vercel — som dessutom överlever deployer. Sågs skarpt: /api/belaggning
      // serverade en kundlista från 13:31 medan databasen var på 14:00.
      // Databasen är sanningen; ingen Supabase-läsning får cacheas.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return client;
}
