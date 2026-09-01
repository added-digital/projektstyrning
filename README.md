# ADDED · Discovery

Internt verktyg för uppstartsmöten — Next.js (App Router) med JSON-lagring per kund på disk.

## Snabbstart

```bash
npm install
npm run dev
```

Sedan: <http://localhost:3000>

## Bygg + produktionsstart

```bash
npm run build
npm start
```

## Datalagring

Varje kund sparas som en JSON-fil i `./data/`, namngiven efter en slug av kundens namn (t.ex. `acme-ab.json`). Filen skrivs atomiskt (tmp + rename) vid varje autosave (~600 ms efter senaste ändring).

Om du byter namn på kunden i formuläret döps filen om till den nya sluggen vid nästa save.

### Format

```json
{
  "client": "Acme AB",
  "date": "2026-05-13",
  "activeSection": 1,
  "answers": { "1-0": "...", "1-3": ["Anna — VD"] },
  "updatedAt": "2026-05-13T12:34:56.789Z"
}
```

## Notiser — uppgifter per person

`/notiser` visar alla kortsiktiga uppgifter grupperade per teammedlem. Sidan
pollar filerna varannan sekund, så uppgifter som skrivs direkt i JSON (t.ex.
av Codex efter ett möte) dyker upp utan omladdning. I webbläsaren bockar man
bara av dem.

Uppgifter ligger på projektet, i `tasks`-arrayen:

```json
{
  "projects": [
    {
      "name": "Annonsering",
      "tasks": [
        {
          "text": "Skicka annonsutkast till kund för godkännande",
          "assignee": "Gustav Lindwall",
          "dueDate": "2026-08-22"
        }
      ]
    }
  ]
}
```

Bara `text` krävs. `id`, `createdAt` och `done: false` fylls i automatiskt
vid nästa läsning, så det räcker att lägga till objektet ovan.

| Fält        | Krävs | Beskrivning                                                                 |
| ----------- | ----- | --------------------------------------------------------------------------- |
| `text`      | Ja    | Uppgiften. Tomma poster kastas.                                             |
| `assignee`  | Nej   | Exakt namn ur teamlistan i `lib/sections.ts`. Okänt namn → "Ej tilldelat".  |
| `dueDate`   | Nej   | `YYYY-MM-DD`. Visas som Försenad / Idag / I morgon / datum.                  |
| `done`      | Nej   | `true`/`false`. Default `false`.                                            |
| `id`        | Nej   | Genereras om den saknas.                                                    |
| `createdAt` | Nej   | ISO-datetime. Sätts till nu om den saknas.                                  |

Uppgifter på **arkiverade** projekt visas inte, men räknas i en notis längst
ned på sidan så de inte försvinner tyst.

## API

| Metod  | Endpoint                  | Beskrivning                             |
| ------ | ------------------------- | --------------------------------------- |
| GET    | `/api/customers`          | Lista alla kunder (sorterat på senast). |
| POST   | `/api/customers`          | Skapa ny kund från `{ client, ... }`.   |
| GET    | `/api/customers/:slug`    | Hämta en kund.                          |
| PUT    | `/api/customers/:slug`    | Uppdatera (kan döpa om vid namnbyte).   |
| DELETE | `/api/customers/:slug`    | Ta bort kund.                           |

## Filstruktur

```
app/
  api/customers/route.ts          # list + create
  api/customers/[slug]/route.ts   # read / update / delete
  globals.css                     # samma tema som tidigare
  layout.tsx
  page.tsx                        # tidslinjen (hela klientvyn)
  notiser/page.tsx                # notissidan — uppgifter per person
lib/
  customersClient.ts              # hämta/spara kunder från klienten
  sections.ts                     # frågor + typer
  storage.ts                      # JSON-IO + slug-säkerhet
  tasks.ts                        # samla + gruppera uppgifter
  timeline.ts                     # veckoraster, datumhjälpare, mått
  useTimelineDrag.ts              # drag/resize av staplar (delad av alla rader)
  workload.ts                     # beläggning per person + tim-formatering
data/                             # kunder lagras här
legacy/
  ADDED · Discovery.html          # gamla single-file-versionen
```

## Anteckningar

- Autosave är debouncad till 600 ms. Indikatorn i headern visar `Sparar` → `Sparat`.
- Att skapa en helt ny kund kräver att fältet `Kund` har ett namn — annars sparas inget.
- Säkerhetskontroll på slug-nivå förhindrar path traversal (endast `[a-z0-9-]+`).
