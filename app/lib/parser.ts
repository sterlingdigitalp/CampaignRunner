import type { CampaignCheckpoint, CampaignMetadata, CampaignPrompt, FinalCertification } from "./types";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function cleanTitle(value: string, number: number, fallback = "Task") {
  const cleaned = value
    .replace(/^#+\s*/, "")
    .replace(/^title\s*:\s*/i, "")
    .trim();
  return cleaned || `${fallback} ${String(number).padStart(3, "0")}`;
}

function fieldValue(block: string, label: string) {
  const match = new RegExp(`^${label}:\\s*(.*)$`, "im").exec(block);
  return match?.[1]?.trim() || undefined;
}

function multilineField(block: string, label: string) {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${label}:\\s*`, "i").test(line));
  if (start < 0) return undefined;
  const first = lines[start].replace(new RegExp(`^${label}:\\s*`, "i"), "").trim();
  const collected = [first];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[A-Za-z][A-Za-z ]{1,40}:\s*/.test(lines[i]) || /^(#{1,3}\s*)?(TASK|CHECKPOINT|FINAL CERTIFICATION)\b/i.test(lines[i])) break;
    collected.push(lines[i]);
  }
  return collected.join("\n").trim() || undefined;
}

function fileEntries(block: string) {
  return block
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => /^FILE:\s*/i.test(line))
    .map((line) => line.replace(/^FILE:\s*/i, "").trim())
    .filter(Boolean);
}

function parseDependsOn(value?: string) {
  if (!value || /^none$/i.test(value)) return [];
  return value
    .split(/[, ]+/)
    .map((item) => Number(/\d+/.exec(item)?.[0]))
    .filter((item) => Number.isFinite(item));
}

function parseLegacyCampaign(normalized: string) {
  const firstLine = normalized.split("\n").find((line) => line.trim().length > 0) ?? "CAMPAIGN";
  const title = firstLine.replace(/^#\s*/, "").trim() || "CAMPAIGN";
  const matches = [...normalized.matchAll(/^HOUR\s+(\d{1,3})\b.*$/gim)];
  const prompts = matches.map((match, index) => {
    const number = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? normalized.length : normalized.length;
    const chunk = normalized.slice(start, end).trim();
    const titleLine = chunk.split("\n").find((line) => line.trim().length > 0) ?? "";
    const promptTitle = cleanTitle(titleLine, number, "Hour");
    const body = [`HOUR ${String(number).padStart(2, "0")}`, chunk].filter(Boolean).join("\n\n");
    return {
      number,
      title: promptTitle,
      taskType: "LEGACY",
      dependsOn: [],
      objective: multilineField(chunk, "Objective"),
      constraints: multilineField(chunk, "Constraints"),
      verificationGoal: multilineField(chunk, "Verification Goal"),
      workspaceOutput: fileEntries(chunk),
      body,
      filename: `${String(number).padStart(3, "0")}_${slugify(promptTitle) || "task"}.md`
    };
  });
  const metadata: CampaignMetadata = { title, format: "legacy-hour" };
  return { title, metadata, prompts: prompts.sort((a, b) => a.number - b.number), checkpoints: [], finalCertification: null };
}

function parseMetadata(header: string): CampaignMetadata {
  const title = fieldValue(header, "Title") || "CAMPAIGN";
  const estimated = fieldValue(header, "Estimated Tasks");
  return {
    title,
    campaignId: fieldValue(header, "Campaign ID"),
    version: fieldValue(header, "Version"),
    profile: fieldValue(header, "Profile"),
    executionMode: fieldValue(header, "Execution Mode"),
    workspace: fieldValue(header, "Workspace"),
    builderProtocol: fieldValue(header, "Builder Protocol"),
    estimatedTasks: estimated ? Number(estimated) : undefined,
    checkpointInterval: fieldValue(header, "Checkpoint Interval"),
    successCriteria: multilineField(header, "Success Criteria"),
    format: "campaign-spec-v1"
  };
}

function sectionMatches(normalized: string) {
  return [...normalized.matchAll(/^(?:#{1,3}\s*)?(TASK\s+(\d{1,5})|CHECKPOINT(?:\s+\d{1,5})?|FINAL CERTIFICATION)\s*$/gim)];
}

function parseSpecCampaign(normalized: string) {
  const sections = sectionMatches(normalized);
  const firstSection = sections[0]?.index ?? normalized.length;
  const metadata = parseMetadata(normalized.slice(0, firstSection));
  const prompts: CampaignPrompt[] = [];
  const checkpoints: CampaignCheckpoint[] = [];
  let finalCertification: FinalCertification | null = null;

  sections.forEach((section, index) => {
    const heading = section[1];
    const start = (section.index ?? 0) + section[0].length;
    const end = index + 1 < sections.length ? sections[index + 1].index ?? normalized.length : normalized.length;
    const block = normalized.slice(start, end).trim();

    if (/^TASK\s+/i.test(heading)) {
      const number = Number(section[2]);
      const title = fieldValue(block, "Title") || cleanTitle("", number);
      const taskType = fieldValue(block, "Task Type");
      const body = [`TASK ${String(number).padStart(3, "0")}`, block].filter(Boolean).join("\n\n");
      prompts.push({
        number,
        title,
        taskType,
        dependsOn: parseDependsOn(fieldValue(block, "Depends On")),
        objective: multilineField(block, "Objective"),
        constraints: multilineField(block, "Constraints"),
        verificationGoal: multilineField(block, "Verification Goal"),
        workspaceOutput: fileEntries(block).concat(multilineField(block, "Workspace Output") ? [multilineField(block, "Workspace Output")!] : []),
        body,
        filename: `${String(number).padStart(3, "0")}_${slugify(title) || "task"}.md`
      });
      return;
    }

    if (/^CHECKPOINT/i.test(heading)) {
      checkpoints.push({
        number: checkpoints.length + 1,
        title: fieldValue(block, "Title") || heading.trim(),
        purpose: multilineField(block, "Purpose"),
        reviewGoals: multilineField(block, "Review Goals"),
        body: [`CHECKPOINT`, block].filter(Boolean).join("\n\n")
      });
      return;
    }

    if (/^FINAL CERTIFICATION/i.test(heading)) {
      finalCertification = {
        title: fieldValue(block, "Title") || "Final Certification",
        body: [`FINAL CERTIFICATION`, block].filter(Boolean).join("\n\n")
      };
    }
  });

  return {
    title: metadata.title,
    metadata,
    prompts: prompts.sort((a, b) => a.number - b.number),
    checkpoints,
    finalCertification
  };
}

export function parseCampaign(text: string): {
  title: string;
  metadata: CampaignMetadata;
  prompts: CampaignPrompt[];
  checkpoints: CampaignCheckpoint[];
  finalCertification: FinalCertification | null;
} {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (/^(?:#{1,3}\s*)?TASK\s+\d{1,5}\b/im.test(normalized)) {
    return parseSpecCampaign(normalized);
  }
  return parseLegacyCampaign(normalized);
}
