import { compileCampaign } from "./campaign-compiler";
import type { CampaignAst, CampaignCheckpoint, CampaignMetadata, CampaignMilestone, CampaignPrompt, CompilerReport, FinalCertification, TaskGraph } from "./types";

export function parseCampaign(text: string): {
  title: string;
  metadata: CampaignMetadata;
  milestones: CampaignMilestone[];
  prompts: CampaignPrompt[];
  checkpoints: CampaignCheckpoint[];
  finalCertification: FinalCertification | null;
  ast: CampaignAst;
  rendered: {
    taskCards: Array<{ taskNumber: number; title: string; milestone?: string }>;
    milestones: Array<{ id: string; title: string; taskNumbers: number[] }>;
    checkpoints: Array<{ number: number; title: string }>;
  };
  taskGraph: TaskGraph;
  campaignSummary: Record<string, unknown>;
  compilerReport: CompilerReport;
} {
  return compileCampaign(text);
}
