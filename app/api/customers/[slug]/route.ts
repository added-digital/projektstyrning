import { NextResponse } from "next/server";
import {
  customerExists,
  deleteCustomer,
  readCustomer,
  slugify,
  writeCustomer,
} from "@/lib/storage";
import type { CustomerData } from "@/lib/sections";

export const dynamic = "force-dynamic";

interface Ctx {
  params: { slug: string };
}

function badSlug(): NextResponse {
  return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const exists = await customerExists(params.slug);
    if (!exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = await readCustomer(params.slug);
    return NextResponse.json({ slug: params.slug, data });
  } catch {
    return badSlug();
  }
}

/**
 * Save customer data. If the client name in the body slugifies to a different
 * slug than the URL slug, the file is written under the new slug and the old
 * one is removed (a rename). Returns the canonical slug + saved data.
 */
export async function PUT(req: Request, { params }: Ctx) {
  let body: Partial<CustomerData>;
  try {
    body = (await req.json()) as Partial<CustomerData>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const client = (body.client ?? "").trim();
  if (!client) {
    return NextResponse.json({ error: "client name is required" }, { status: 400 });
  }

  try {
    const newSlug = slugify(client);
    const data: CustomerData = {
      client,
      projects: body.projects ?? [],
      activeProjectId: body.activeProjectId ?? null,
    };

    const saved = await writeCustomer(newSlug, data);
    if (newSlug !== params.slug) {
      await deleteCustomer(params.slug).catch(() => undefined);
    }
    return NextResponse.json({ slug: newSlug, data: saved });
  } catch {
    return badSlug();
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const removed = await deleteCustomer(params.slug);
    if (!removed) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return badSlug();
  }
}
