import { NextResponse } from "next/server";
import { openPath } from "@/app/lib/open-file";

export async function POST(request: Request) {
  const body = (await request.json()) as { path?: string };

  if (!body.path) {
    return NextResponse.json({ error: "Path is required." }, { status: 400 });
  }

  openPath(body.path);
  return NextResponse.json({ ok: true });
}
