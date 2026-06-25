import { defaultExecutionPolicy } from "./defaults";
import type { CampaignProfile, CampaignProfileName } from "./types";

export function getCampaignProfile(name: CampaignProfileName = "Generic"): CampaignProfile {
  const base = defaultExecutionPolicy().verificationPipeline;
  const profiles: Record<CampaignProfileName, CampaignProfile> = {
    Generic: {
      name: "Generic",
      builderProtocol: "FILE_BLOCKS",
      verificationPipeline: [{ name: "Files Exist", enabled: true, command: "test -n \"$(find . -type f -not -name '.*' | head -1)\"", timeoutSeconds: 20, continueOnFailure: false }],
      workspaceExpectations: ["Generated artifacts are written under workspace/ using FILE: blocks."]
    },
    TypeScript: {
      name: "TypeScript",
      builderProtocol: "FILE_BLOCKS",
      verificationPipeline: base,
      workspaceExpectations: ["package.json and tsconfig.json are required before typecheck/build verifiers run."]
    },
    Python: {
      name: "Python",
      builderProtocol: "FILE_BLOCKS",
      verificationPipeline: [{ name: "Python Compile", enabled: true, command: "python -m compileall .", timeoutSeconds: 120, continueOnFailure: false }],
      workspaceExpectations: ["Python files live under workspace/."]
    },
    Markdown: {
      name: "Markdown",
      builderProtocol: "FILE_BLOCKS",
      verificationPipeline: [{ name: "Files Exist", enabled: true, command: "test -n \"$(find . -type f -not -name '.*' | head -1)\"", timeoutSeconds: 20, continueOnFailure: false }],
      workspaceExpectations: ["Markdown deliverables are written as files, not prose-only responses."]
    },
    Research: {
      name: "Research",
      builderProtocol: "FILE_BLOCKS",
      verificationPipeline: [{ name: "Files Exist", enabled: true, command: "test -n \"$(find . -type f -not -name '.*' | head -1)\"", timeoutSeconds: 20, continueOnFailure: false }],
      workspaceExpectations: ["Research campaigns should not invoke build verification by default."]
    },
    Documentation: {
      name: "Documentation",
      builderProtocol: "FILE_BLOCKS",
      verificationPipeline: [{ name: "Files Exist", enabled: true, command: "test -n \"$(find . -type f -not -name '.*' | head -1)\"", timeoutSeconds: 20, continueOnFailure: false }],
      workspaceExpectations: ["Documentation campaigns produce file-backed written deliverables."]
    }
  };
  return profiles[name];
}
