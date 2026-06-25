import type { CampaignCheckpoint, CampaignMetadata, CampaignPrompt, CampaignValidation } from "./types";

const KNOWN_TASK_TYPES = new Set(["CREATE", "MODIFY", "REVIEW", "VERIFY", "REFACTOR", "FINALIZE", "LEGACY"]);

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function validateCampaignPrompts(
  prompts: CampaignPrompt[],
  metadata?: CampaignMetadata,
  checkpoints: CampaignCheckpoint[] = []
): CampaignValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const numbers = prompts.map((prompt) => prompt.number);
  const duplicateTasks = Array.from(new Set(numbers.filter((number, index) => numbers.indexOf(number) !== index)));
  const maxTask = numbers.length > 0 ? Math.max(...numbers) : 0;
  const missingTasks = Array.from({ length: maxTask }, (_, index) => index + 1).filter((number) => !numbers.includes(number));
  const wordCounts = prompts.map((prompt) => ({ number: prompt.number, words: wordCount(prompt.body) }));
  const longest = wordCounts.reduce((max, item) => (item.words > max.words ? item : max), { number: null as number | null, words: 0 });

  if (prompts.length === 0) errors.push("No executable tasks were parsed.");
  if (duplicateTasks.length > 0) errors.push(`Duplicate tasks: ${duplicateTasks.join(", ")}.`);
  if (missingTasks.length > 0) warnings.push(`Missing task numbers: ${missingTasks.join(", ")}.`);

  prompts.forEach((prompt) => {
    const label = `Task ${String(prompt.number).padStart(3, "0")}`;
    if (!prompt.title.trim()) errors.push(`${label} is missing a title.`);
    if (!prompt.objective && metadata?.format === "campaign-spec-v1") warnings.push(`${label} is missing Objective.`);
    if (!prompt.verificationGoal && metadata?.format === "campaign-spec-v1") warnings.push(`${label} is missing Verification Goal.`);
    if (prompt.taskType && !KNOWN_TASK_TYPES.has(prompt.taskType.toUpperCase())) warnings.push(`${label} has unknown task type: ${prompt.taskType}.`);
    (prompt.dependsOn ?? []).forEach((dependency) => {
      if (!numbers.includes(dependency)) warnings.push(`${label} depends on missing Task ${String(dependency).padStart(3, "0")}.`);
      if (dependency >= prompt.number) warnings.push(`${label} depends on a non-prior task: ${String(dependency).padStart(3, "0")}.`);
    });
    const words = wordCount(prompt.body);
    if (words > 150) warnings.push(`${label} is ${words} words. Qwen3.6 35B A3B MTP campaigns are easier to run under about 150 words per task.`);
  });

  const averageWords = prompts.length > 0 ? Math.round(wordCounts.reduce((sum, item) => sum + item.words, 0) / prompts.length) : 0;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      promptCount: prompts.length,
      taskCount: prompts.length,
      taskNumbers: numbers.sort((a, b) => a - b),
      missingTasks,
      duplicateTasks,
      checkpointCount: checkpoints.length,
      profile: metadata?.profile,
      workspace: metadata?.workspace,
      builderProtocol: metadata?.builderProtocol,
      averageWords,
      longestPromptNumber: longest.number,
      longestPromptWords: longest.words
    }
  };
}
