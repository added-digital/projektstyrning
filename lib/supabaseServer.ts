import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Cookie-baserad Supabase-klient för route handlers och server components.
 * Använder anon-nyckeln + användarens session — INTE service-role. Den här
 * klienten svarar på "vem är inloggad?"; dataåtkomsten sker sedan via
 * supabaseAdmin() i lib/supabase.ts.
 */
export function supabaseServer(): SupabaseClient {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(all) {
          // Route handlers får skriva cookies; server components inte.
          // Next kastar då — sväljs medvetet, middleware sköter refresh.
          try {
            all.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {}
        },
      },
    },
  );
}

/** Inloggad användare, eller null. */
export async function getSessionUser(): Promise<User | null> {
  const { data } = await supabaseServer().auth.getUser();
  return data.user ?? null;
}
