import type { ExecutionContract, FileProtocolValidationResult, VerificationResult, VerificationStep } from "./types";

export class DecisionEngine {
  shouldAdvance(results: VerificationResult[], protocol: FileProtocolValidationResult, contract: ExecutionContract) {
    return this.shouldAccept(results, protocol, contract);
  }

  shouldRetry(attempt: number, maxAttempts: number, errorCode?: string) {
    return errorCode === "TIMEOUT" && attempt < maxAttempts;
  }

  shouldRepair(repairAttempt: number, contract: ExecutionContract, protocol: FileProtocolValidationResult, results: VerificationResult[]) {
    if (repairAttempt >= contract.repairPolicy.maxRepairAttempts) return false;
    return !protocol.valid || results.some((result) => result.status === "FAIL");
  }

  shouldFail(repairAttempt: number, contract: ExecutionContract, protocol: FileProtocolValidationResult, results: VerificationResult[]) {
    return !this.shouldAccept(results, protocol, contract) && !this.shouldRepair(repairAttempt, contract, protocol, results);
  }

  shouldCheckpoint() {
    return false;
  }

  shouldAccept(results: VerificationResult[], protocol: FileProtocolValidationResult, contract: ExecutionContract) {
    if (!protocol.valid) return false;
    if (!contract.acceptancePolicy.acceptOnlyVerified) return true;
    return results.filter((result) => result.status !== "SKIP").every((result) => result.status === "PASS");
  }

  shouldRunVerifier(step: VerificationStep, workspaceFiles: Set<string>, contract: ExecutionContract) {
    if (!step.enabled) return false;
    if (contract.workspacePolicy.maturity === "EMPTY") {
      return step.name.toLowerCase().includes("files exist") || step.command.includes("test -");
    }
    const command = step.command.toLowerCase();
    if ((command.includes("npm ") || command.includes("pnpm ") || command.includes("yarn ")) && !workspaceFiles.has("package.json")) {
      return false;
    }
    if (command.includes("typecheck") && !workspaceFiles.has("tsconfig.json")) return false;
    if (command.includes("build") && !workspaceFiles.has("package.json")) return false;
    if (contract.workspacePolicy.maturity === "EARLY_STAGE" && command.includes("build") && !workspaceFiles.has("package.json")) return false;
    return true;
  }
}

export const decisionEngine = new DecisionEngine();
