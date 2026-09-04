import "server-only";

/**
 * Engångs-samtycke för Fortnox service account (Next-sidan).
 *
 * Flödet: en Fortnox-systemadministratör skickas till Fortnox med
 * account_type=service, godkänner scopes, kommer tillbaka med en kod.
 * Koden byts mot ett access token vars JWT bär claimen `tenantId` — det
 * är det enda vi behöver spara. Därefter sköter edge-funktionen alla
 * anrop med client_credentials; inga refresh tokens att rotera här.
 */

const AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";
const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";

export const FORTNOX_SCOPES = ["timereporting"] as const;

function config() {
  const clientId = process.env.FORTNOX_CLIENT_ID;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  const redirectUri = process.env.FORTNOX_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Fortnox saknar konfiguration: FORTNOX_CLIENT_ID, FORTNOX_CLIENT_SECRET " +
        "och FORTNOX_REDIRECT_URI måste finnas i .env.local / Vercel.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildConsentUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: FORTNOX_SCOPES.join(" "),
    state,
    access_type: "offline",
    response_type: "code",
    account_type: "service",
  });
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = config();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Fortnox token exchange ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Plockar tenantId ur access-tokenets JWT-payload. Signaturen verifieras
 * inte — Fortnox publicerar ingen nyckel — men tokenet kom nyss direkt från
 * Fortnox över TLS i utbyte mot vår client secret, så det räcker.
 */
export function tenantIdFromAccessToken(accessToken: string): string {
  const parts = accessToken.split(".");
  if (parts.length < 2) throw new Error("Access token är inte en JWT");
  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  const tenant = payload.tenantId ?? payload.tenantid ?? payload.TenantId;
  if (tenant === undefined || tenant === null || tenant === "") {
    throw new Error(
      `Ingen tenantId-claim i tokenet (claims: ${Object.keys(payload).join(", ")})`,
    );
  }
  return String(tenant);
}
