/**
 * Fortnox-klient för edge-funktioner (Deno).
 *
 * Service account via client_credentials: inga refresh tokens. Varje körning
 * hämtar ett färskt access token (1 h) med client id/secret + TenantId.
 * Detta är den enda platsen där token-hämtning sker på serversidan.
 */

const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se";

export interface FortnoxCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export async function getServiceAccessToken(
  creds: FortnoxCredentials,
  scope = "timereporting",
): Promise<string> {
  const basic = btoa(`${creds.clientId}:${creds.clientSecret}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
      TenantId: creds.tenantId,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fortnox token (client_credentials) ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/**
 * GET mot Fortnox med backoff på 429. Gränsen är 25 anrop / 5 s; synken
 * gör ett anrop per års-spann, så detta är hängslen snarare än livrem.
 */
export async function fortnoxGet<T>(
  accessToken: string,
  path: string,
  attempt = 0,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (res.status === 429 && attempt < 4) {
    const wait = 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
    return fortnoxGet<T>(accessToken, path, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fortnox GET ${path} → ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}
