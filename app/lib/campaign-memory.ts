import { projectPaths, readJson, writeJson } from "./files";
import { estimateTokens } from "./prompt-builder";
import type { CampaignMemoryEntry } from "./types";

const MAX_MEMORY_ENTRIES = 200;
const MAX_RENDERED_ENTRIES = 12;

export async function loadCampaignMemory(projectRoot: string): Promise<CampaignMemoryEntry[]> {
  const entries = await readJson<CampaignMemoryEntry[]>(projectPaths(projectRoot).campaignMemory, []);
  return Array.isArray(entries) ? entries : [];
}

export async function appendCampaignMemory(projectRoot: string, entry: CampaignMemoryEntry) {
  const entries = await loadCampaignMemory(projectRoot);
  entries.push(entry);
  await writeJson(projectPaths(projectRoot).campaignMemory, entries.slice(-MAX_MEMORY_ENTRIES));
  return entry;
}

function renderEntry(entry: CampaignMemoryEntry) {
  const label = entry.kind === "checkpoint" ? `Checkpoint ${entry.task}` : `Task ${String(entry.task).padStart(3, "0")}`;
  const parts = [`- ${label} (${entry.finalStatus}, ${entry.status}): ${entry.notes || "No notes."}`];
  if (entry.blockers.length > 0) parts.push(`  Blockers: ${entry.blockers.join("; ")}`);
  if (entry.followUps.length > 0) parts.push(`  Follow-ups: ${entry.followUps.join("; ")}`);
  return parts.join("\n");
}

/**
 * Renders the most recent memory entries (oldest first) as a prompt section,
 * trimmed to the token budget by dropping oldest entries first. Returns ""
 * when there is nothing worth injecting.
 */
export function renderCampaignMemory(entries: CampaignMemoryEntry[], budgetTokens: number) {
  if (entries.length === 0 || budgetTokens <= 0) return "";
  const header = [
    "CAMPAIGN MEMORY",
    "",
    "Reports from previously executed tasks (oldest first). Honor prior decisions and address open blockers and follow-ups when they fall inside the current task's scope.",
    ""
  ].join("\n");
  let recent = entries.slice(-MAX_RENDERED_ENTRIES);
  for (;;) {
    const body = recent.map(renderEntry).join("\n");
    const rendered = `${header}${body}`;
    if (estimateTokens(rendered) <= budgetTokens || recent.length <= 1) {
      return estimateTokens(rendered) <= budgetTokens ? rendered : "";
    }
    recent = recent.slice(1);
  }
}
