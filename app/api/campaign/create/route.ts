import { NextResponse } from "next/server";
import { createCampaign } from "@/app/lib/campaign-manager";
import { DEFAULT_PROJECT_ROOT } from "@/app/lib/defaults";
import { parseCampaign } from "@/app/lib/parser";
import { validateCampaignPrompts } from "@/app/lib/campaign-validation";
import type { PlannerReport } from "@/app/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as { campaignText?: string; projectRoot?: string; plannerReport?: PlannerReport };
  const campaignText = body.campaignText?.trim() ?? "";
  const projectRoot = body.projectRoot?.trim() || DEFAULT_PROJECT_ROOT;
  const parsed = parseCampaign(campaignText);
  const prompts = parsed.prompts;

  if (!campaignText) {
    return NextResponse.json({ error: "Campaign text is required." }, { status: 400 });
  }

  const validation = validateCampaignPrompts(prompts, parsed.metadata, parsed.checkpoints);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.errors.join(" ") }, { status: 400 });
  }

  const project = await createCampaign(projectRoot, campaignText, prompts, parsed.metadata, parsed.checkpoints, parsed.finalCertification, body.plannerReport);
  return NextResponse.json(project);
}
