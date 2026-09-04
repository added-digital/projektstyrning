# ADDED · Projektstyrning

Internt verktyg för att planera och följa teamets tid. Next.js (App Router)
på Vercel, Supabase (Postgres + Auth + Realtime + Edge Functions), Fortnox
som källa för rapporterad tid.

Användarvyn är **Beläggning per person** (`/belaggning-personer`, `/` skickar
dit). `/tid` visar rapporterad Fortnox-tid per medarbetare och hanterar
Fortnox-kopplingen.

## Funktioner

- Skapa kunder och projekt direkt i verktygsfältet.
- Planera timmar per person, kund, projekt och datumintervall (per vardag
  eller totalt).
- Estimera projekt av typen Högt och lågt med lågt, troligt och högt utfall;
  beläggningen använder en PERT-viktad prognos och visar högsta utfallet som
  ett separat risklager.
- Historisk beläggning per vardag kommer från Fortnox (arbetad tid, kod TID);
  framtiden från planerade timmar.
- Kapacitetsreserver (SLA/löpande behov) med min/max och sannolikhet utan att
  timmarna räknas som bokade.
- Växla mellan tre månader och hela året.
- Ändringar syns live hos alla via Supabase Realtime.

## Utveckling

```bash
npm install
npm run dev        # mot moln-projektet via .env.local — ingen lokal Supabase
npm test           # vitest: beläggningsberäkning, Fortnox-mapper, periodpivot
npm run typecheck
```

Se `CLAUDE.md` för konventioner, migrationer och Fortnox-/edge-function-kommandon.

## Datalagring

Varje kund är en rad i `customers` (Supabase) med hela kunddokumentet i
`doc` (`projects`, `activeProjectId`). Normalisering och legacy-migrering
sker vid läsning i `lib/storage.ts`. Rapporterad tid speglas från Fortnox till
`time_entries` av edge-funktionen `fortnox-sync` (nattligt + manuellt från
`/tid`).

## API

| Metod | Endpoint                     | Beskrivning                                   |
| ----- | ---------------------------- | --------------------------------------------- |
| GET   | `/api/customers`             | Lista kunder                                  |
| POST  | `/api/customers`             | Skapa kund                                    |
| GET   | `/api/customers/:slug`       | Hämta kund                                    |
| PUT   | `/api/customers/:slug`       | Spara kund (kan döpa om vid namnbyte)         |
| DELETE| `/api/customers/:slug`       | Ta bort kund                                  |
| GET   | `/api/belaggning`            | Sammanslagen serie per person: Fortnox + plan |
| GET   | `/api/tid`                   | Timmar per medarbetare och vecka/månad/år     |
| GET/PATCH | `/api/workers`           | Medarbetare och Fortnox-mappning              |
| POST  | `/api/fortnox/sync`          | Kör synk (manuellt/backfill)                  |

Alla endpoints kräver inloggning (magic link, inbjudna konton).
