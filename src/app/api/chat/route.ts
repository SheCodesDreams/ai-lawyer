import { NextResponse } from "next/server";
import { newCase, runTurn, type CaseState } from "@/lib/pipeline";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { state?: CaseState; message?: string; action?: string };
    const action = body.action === "practice_start" || body.action === "practice_end" ? body.action : undefined;
    const message = (body.message ?? "").toString().slice(0, 4000).trim();
    if (!message && !action) return NextResponse.json({ error: "Empty message" }, { status: 400 });
    const result = await runTurn(body.state ?? newCase(), message, action);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
