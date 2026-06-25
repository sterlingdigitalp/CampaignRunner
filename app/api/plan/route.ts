import { NextResponse } from "next/server";
import { planCampaign } from "@/app/lib/campaign-planner";
import type { CampaignBrief } from "@/app/lib/types";

export async function POST(request: Request) {
  const brief = (await request.json()) as CampaignBrief;
  if (!brief.brief?.trim()) {
    return NextResponse.json({ error: "Project brief is required." }, { status: 400 });
  }
  const plan = planCampaign(brief);
  return NextResponse.json(plan);
}
