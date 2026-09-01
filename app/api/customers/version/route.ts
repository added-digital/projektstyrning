import { NextResponse } from "next/server";
import { getDataVersion } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const version = await getDataVersion();
  return NextResponse.json(version);
}
