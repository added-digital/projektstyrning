import { NextResponse } from "next/server";
import { listCustomers, slugify, writeCustomer } from "@/lib/storage";
import type { CustomerData } from "@/lib/sections";

export const dynamic = "force-dynamic";

export async function GET() {
  const customers = await listCustomers();
  return NextResponse.json({ customers });
}

/**
 * Create a new customer file. Body: { client: string, projects?: Project[] }
 * Returns { slug, data }.
 */
export async function POST(req: Request) {
  let body: Partial<CustomerData> = {};
  try {
    body = (await req.json()) as Partial<CustomerData>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const client = (body.client ?? "").trim();
  if (!client) {
    return NextResponse.json({ error: "client name is required" }, { status: 400 });
  }

  const slug = slugify(client);
  const data: CustomerData = {
    client,
    projects: body.projects ?? [],
    activeProjectId: body.activeProjectId ?? null,
  };

  const saved = await writeCustomer(slug, data);
  return NextResponse.json({ slug, data: saved }, { status: 201 });
}
