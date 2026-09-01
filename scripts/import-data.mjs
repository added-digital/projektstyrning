// Engångsimport: data/*.json → customers-tabellen.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-data.mjs
//
// Lagrar dokumentet som det står i filen ({ projects, activeProjectId }).
// Normalisering/legacy-migrering körs vid läsning i lib/storage.ts, precis
// som den gör mot filerna idag — importen ska inte ha en egen kopia av den
// logiken. Idempotent: upsert på slug.
import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Sätt SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const dataDir = path.join(process.cwd(), "data");
const files = (await readdir(dataDir)).filter((f) => f.endsWith(".json"));
let ok = 0, projects = 0, tasks = 0;

for (const file of files.sort()) {
  const slug = file.replace(/\.json$/, "");
  const raw = JSON.parse(await readFile(path.join(dataDir, file), "utf8"));
  if (!Array.isArray(raw.projects)) {
    console.error(`✗ ${slug}: ingen projects-array — oväntad legacy-form, avbryter.`);
    process.exit(1);
  }
  const doc = { projects: raw.projects, activeProjectId: raw.activeProjectId ?? null };
  const { error } = await db.from("customers").upsert(
    { slug, client: raw.client ?? slug, doc },
    { onConflict: "slug" },
  );
  if (error) {
    console.error(`✗ ${slug}: ${error.message}`);
    process.exit(1);
  }
  const t = raw.projects.reduce((n, p) => n + (p.tasks?.length ?? 0), 0);
  projects += raw.projects.length; tasks += t; ok++;
  console.log(`✓ ${slug} — ${raw.projects.length} projekt, ${t} uppgifter`);
}

console.log(`\nKlart: ${ok}/${files.length} kunder, ${projects} projekt, ${tasks} uppgifter.`);
