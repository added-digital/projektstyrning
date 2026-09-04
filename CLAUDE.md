# CLAUDE.md

## Project overview
Internal project-management tool for ADDED (digital agency, Stockholm). Connects:
- **Customers** (clients) and **workers** (ADDED employees) to shared **projects**
- **Fortnox** for time reporting (sync, not duplicate — Fortnox is source of truth for finalized time)
- **Slack** for notifications (deadlines, budget thresholds, status changes)
- Dashboards: time spent per project/person/client, estimated vs. actual timelines

Assumed stack (correct if wrong): Next.js (App Router) on Vercel, TypeScript, Supabase (Postgres + Auth + Storage + **Edge Functions** for integration glue and scheduled jobs — not Vercel Edge Functions), shadcn/ui as the component library standard, bklit-ui (built on shadcn) for charts and data viz.

### Skills to install in this project
- `npx skills add bklit/bklit-ui` — chart components (area, bar, line, funnel, gauge, etc.), built on shadcn. Use this for all graphs (time-spent, budget burn-down, timeline projections) instead of hand-rolling chart code or pulling in a second charting lib.
- `npx skills add supabase/agent-skills` — Supabase-aware project context (schema, RLS, functions) for the agent.

## Tech stack & conventions
- TypeScript strict mode. No `any` without a comment explaining why.
- Supabase: schema lives in `supabase/migrations/`. Never hand-edit the remote schema — always via a new migration file.
- Generate types after every schema change: `npm run gen:types` (= `supabase gen types typescript --linked > lib/database.types.ts`). There is deliberately no local Supabase stack — dev and Vercel share the one cloud project. Never hand-edit `database.types.ts`.
- Row Level Security is mandatory on every table containing customer or worker data. A migration that adds a table without RLS policies is incomplete — flag it, don't ship it.
- Folder convention: `app/` (routes), `components/ui/` (shadcn primitives, generated — don't hand-edit, re-run the CLI), `components/charts/` (bklit chart internals, generated — same rule), `components/` (our composed/reusable components), `lib/` (shared logic), `lib/integrations/fortnox/` (Next-side: consent flow, types), `supabase/functions/_shared/` (Deno-side Fortnox client + the pure row mapper, shared with tests), `supabase/functions/` (edge functions, Deno runtime), `supabase/migrations/`.
- Tailwind runs with **preflight disabled** (`tailwind.config.js`): the original screens are hand-rolled CSS in `app/globals.css`; shadcn/Tailwind is for new views only. shadcn tokens in `app/tailwind.css` are mapped onto the existing dark palette — the app is dark-only, there is no `.dark` toggle.
- Chart series colors (`--chart-1…5`) are validated for CVD separation and contrast against `#0A0B0E`. Re-run the dataviz palette validator before changing them; color follows the person (workers.sort order), unmapped Fortnox users are always neutral grey.

## UI & UX conventions

### Component reuse
- Before building a new component, check `components/` for something that already does this or close to it. If the same visual pattern (card, table row, status badge, empty state, etc.) shows up in more than one place, it must be a shared component — not copy-pasted markup with small variations.
- shadcn/ui is the base layer for everything — buttons, dialogs, forms, tables. Install via the shadcn CLI (`npx shadcn@latest add <component>`), don't hand-roll a component shadcn already provides.
- Charts always go through bklit-ui (`@bklit` registry) — compose with the root chart + children pattern (e.g. `LineChart` → `Grid` → `Line` → `XAxis` → `ChartTooltip`), use `chartCssVars` and the `--chart-1`…`--chart-5` tokens for theming rather than hardcoded colors.

### Accessibility (non-negotiable, not a nice-to-have)
- Every interactive element (buttons, links, clickable rows/cards) gets `cursor-pointer` on hover — no dead-looking cursor on clickable things.
- All interactive elements are keyboard-navigable and have visible focus states — don't strip default focus rings without replacing them.
- Icon-only buttons need an `aria-label`. Form inputs need an associated `<label>`, not just a placeholder.
- Color is never the only signal for status (e.g. over-budget/on-track) — pair it with an icon or text.
- Respect `prefers-reduced-motion` for chart animations and transitions.

### General UX heuristics (Nielsen-style — apply, don't just recite)
- **Visibility of system status**: loading, syncing-from-Fortnox, and error states are always visible, never silent. If a Fortnox sync is running, show it.
- **Match real-world language**: use ADDED's actual terms (kund, medarbetare, projekt) consistently — don't mix English/Swedish labels within the same screen.
- **User control & error prevention**: destructive or hard-to-reverse actions (deleting a project, editing a Fortnox-synced entry) get a confirmation step, not an instant action.
- **Consistency**: same action = same pattern everywhere (e.g. "Create X" buttons always top-right, same icon set throughout).
- **Recognition over recall**: surface relevant context (customer name, project status) inline rather than making the user remember or look it up elsewhere.
- **Flexibility for different users**: workers, project leads, and admins likely need different views of the same data — design the component so it can be scoped by role rather than building three separate screens.

## Integrations — treat these as the risky part

### Fortnox
- OAuth2 with refresh tokens. Refresh-token rotation logic lives in one place (`lib/integrations/fortnox/auth.ts`) — never duplicate token refresh handling elsewhere.
- Fortnox is the source of truth for **approved/finalized** time entries. Our DB should mirror, not override, unless explicitly building a "draft before submit" flow — ask before assuming which direction sync goes.
- All writes to Fortnox must be idempotent (check for existing record before creating) — Fortnox has no native dedupe.
- Respect Fortnox API rate limits; batch/backoff on sync jobs, don't fire one request per row in a loop without throttling.

### Slack
- Verify the Slack signing secret on every incoming webhook before processing (`X-Slack-Signature` + timestamp check). No exceptions, even in a "quick" handler.
- Outgoing notifications go through a single `lib/integrations/slack/notify.ts` — no ad-hoc `fetch` calls to Slack scattered around the codebase.
- Never post customer-identifiable financial data (rates, invoiced amounts) to a channel without checking which channel/audience first.

### Edge Functions specifically (Supabase, Deno runtime)
- Supabase Edge Functions run on Deno, not Node — npm packages that assume Node APIs (`fs`, some Fortnox client libs) may not work as-is. Check for Deno/npm compatibility before assuming a package "just works"; use the `npm:` specifier where Supabase supports it, or flag if a package genuinely needs a Node environment instead.
- Long-running sync jobs (e.g. nightly Fortnox pull) go in a scheduled Edge Function (`pg_cron` trigger or Supabase's scheduled functions), not inline in a user-facing request path.
- Slack webhook receivers and Fortnox sync jobs are separate functions — don't combine unrelated integrations into one function.
- Secrets for edge functions go through `supabase secrets set`, never hardcoded or committed.

## Commands
- `npm run dev` — local dev (against the cloud Supabase project via `.env.local`)
- `npm test` — vitest (pure logic: Fortnox mapper, period pivot). Run before considering any task done.
- `npm run lint` / `npm run typecheck`
- `npm run gen:types` — regenerate `lib/database.types.ts` from the linked project
- `echo Y | supabase db push` — apply new migrations to the cloud project (the prompt hangs non-interactive shells)
- `supabase functions deploy <name>` — deploy an edge function (`fortnox-sync`)
- `supabase secrets set KEY=value` — edge-function secrets (Fortnox client id/secret)
- `npx shadcn@latest add <component>` — add a shadcn primitive
- `CI=1 npx shadcn@latest add @bklit/<chart-name> -y` — add a bklit chart (lands in `components/charts/`, not `components/ui/`)

## Off-limits without explicit confirmation
- Modifying or squashing existing migration files
- Changing RLS policies on customer/worker tables
- Anything that writes to Fortnox in production (test against sandbox first)
- Rotating or regenerating Slack/Fortnox API credentials
- `.env*` files and Supabase secrets — read structure, never print values

## Workflow expectations
- For schema changes or new integrations: propose a plan (tables/columns, RLS policies, sync direction) before writing migrations.
- After any change touching time-entry or estimate logic: run tests, and if the change affects the graphs, sanity-check the aggregation query against a couple of known rows.
- Time estimates vs. actuals is core to this tool's value — any change to that calculation needs a one-line rationale in the commit/PR description.

## Data model (adjust as it firms up)
- `customers`, `workers`, `projects`, `time_entries` (mirrored from Fortnox), `estimates` (per project, editable in-app), `notifications_log` (what was sent to Slack, when, to avoid duplicate pings)
