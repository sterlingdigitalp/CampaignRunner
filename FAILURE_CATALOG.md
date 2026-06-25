# Failure Catalog — Campaign Runner Operational Taxonomy

Every observed or potential failure mode, classified as an operational event.

---

## Classification Guide

| Field | Meaning |
|---|---|
| **Severity** | Critical / Major / Minor / Cosmetic |
| **Frequency** | Rare / Occasional / Common / Systematic |
| **Auto-Recovery** | Yes / Partial / No |
| **Detection** | Immediate / Eventual / Manual |

---

## 1. Duplicate FILE

**ID:** F-PROTOCOL-001
**Severity:** Major
**Frequency:** Common
**Auto-Recovery:** Partial

**Description:** The LLM generates two or more `FILE:` blocks with the same relative path in a single response. The protocol validator correctly rejects the entire response with `DUPLICATE_FILE` error.

**Observed During Benchmark 001:** Yes — 8 rejections across Hours 6 and 40.

**Root Cause:** The LLM does not track which FILE: paths it has already emitted within a single response. When asked to update `README.md` (add a new section), it often outputs `FILE: README.md` multiple times with overlapping content.

**Current Recovery Strategy:** Repair loop retries with a condensed repair prompt. The prompt does NOT include the LLM's previous output, so the model repeats the same error.

**Recommended Improvement:**
- Include the rejected LLM response in the repair prompt
- Show the specific duplicate paths to the model
- Consider splitting into per-file acceptance (accept unique paths, reject duplicates only)

---

## 2. Duplicate Path

**ID:** F-PROTOCOL-002
**Severity:** Minor
**Frequency:** Occasional

**Description:** Same as Duplicate FILE — duplicated for cross-reference.

**Current Recovery Strategy:** See Duplicate FILE.

---

## 3. Malformed FILE Header

**ID:** F-PROTOCOL-003
**Severity:** Major
**Frequency:** Rare

**Description:** The LLM generates a FILE: block with a malformed header (e.g., `File:`, `file:`, `FILE:` with wrong spacing). The protocol validator correctly rejects with `MALFORMED_HEADER`.

**Observed During Benchmark 001:** No — only DUPLICATE_FILE errors occurred.

**Root Cause:** LLM format drift — the model occasionally deviates from the strict `FILE: relative/path` format.

**Current Recovery Strategy:** Repair loop retries.

**Recommended Improvement:**
- Normalize common malformations (`File:` → `FILE:`, `file:` → `FILE:`) in the validator before rejecting
- Preserve the accepted files while rejecting the malformed ones

---

## 4. Protocol Drift

**ID:** F-PROTOCOL-004
**Severity:** Major
**Frequency:** Rare

**Description:** The LLM's output format gradually drifts from the Builder Protocol over multiple messages. Early responses are protocol-compliant; later responses degrade.

**Observed During Benchmark 001:** No — protocol compliance was consistent throughout.

**Root Cause:** Model context window degradation or fine-tuning drift.

**Current Recovery Strategy:** Repair loop.

**Recommended Improvement:**
- Re-inject protocol instructions periodically (every N tasks or when rejection frequency increases)
- Track protocol compliance trend per task and alert on degradation

---

## 5. Repair Exhausted

**ID:** F-REPAIR-001
**Severity:** Major
**Frequency:** Occasional

**Description:** The repair loop exhausts `maxRepairAttempts` without producing an acceptable LLM response. The runtime transitions to FAILED.

**Observed During Benchmark 001:** Yes — Task 40 exhausted 4 attempts.

**Root Cause:** The repair prompt lacks the LLM's previous output, so the model repeats the same error pattern on every repair attempt. The runtime correctly stops after budget exhaustion.

**Current Recovery Strategy:** FAILED state with `EXECUTION_STOPPED` event. Operator must manually retry.

**Recommended Improvement:**
- Include previous LLM response in repair prompt (primary fix)
- Add diagnostic detail: "All 4 attempts produced DUPLICATE_FILE: README.md appeared 2–4 times per attempt"
- Consider adaptive repair budget (increase for DUPLICATE_FILE which is format-only)

---

## 6. Verification Failure

**ID:** F-VERIFY-001
**Severity:** Major
**Frequency:** Rare

**Description:** The verification pipeline fails (typecheck, build, etc.) after an LLM response is protocol-compliant. The runtime flags the response as unverified.

**Observed During Benchmark 001:** No — all 39 verified tasks passed verification (0 enabled verifiers). The policy had `acceptOnlyVerified: true` but 0 verifiers were enabled.

**Root Cause:** Policy configuration mismatch — `acceptOnlyVerified: true` with empty verification pipeline effectively means "accept everything".

**Current Recovery Strategy:** Not exercised during Benchmark 001.

**Recommended Improvement:**
- Warn when `acceptOnlyVerified: true` but no verifiers are enabled
- Enable at least one meaningful verifier by default

---

## 7. Dashboard Drift

**ID:** F-DASHBOARD-001
**Severity:** Minor
**Frequency:** Occasional

**Description:** The dashboard displays stale or incorrect campaign state due to polling-based refresh.

**Observed During Benchmark 001:** Not directly observed (dashboard was not actively monitored).

**Root Cause:** Dashboard polls API endpoints that read from disk. If filesystem operations are racing with execution, stale data may be served.

**Current Recovery Strategy:** Manual refresh.

**Recommended Improvement:**
- Add last-updated timestamps to all API responses
- Implement server-sent events for real-time dashboard updates

---

## 8. State Drift

**ID:** F-STATE-001
**Severity:** Critical
**Frequency:** Rare

**Description:** The persisted execution_state diverges from the actual runtime state. This could happen from concurrent access, partial writes, or stale lock detection.

**Observed During Benchmark 001:** No — state transitions were consistent throughout.

**Root Cause:** Race condition in state persistence or concurrent API calls.

**Current Recovery Strategy:** Recovery API (resetExecution, recoverState). Automatic RECOVERING→READY transition.

**Recommended Improvement:**
- Add state integrity checksum to detect silent corruption
- Lock state file during writes

---

## 9. Workspace Corruption

**ID:** F-WORKSPACE-001
**Severity:** Minor
**Frequency:** Occasional

**Description:** Workspace files accumulate hidden metadata files (.campaign_runner_last_response_*.md, .campaign_runner_rejected_response_*.md) without retention.

**Observed During Benchmark 001:** Yes — 160+ hidden files accumulated (~1MB).

**Root Cause:** No cleanup policy for audit trail files.

**Current Recovery Strategy:** None — files accumulate indefinitely.

**Recommended Improvement:**
- Implement retention policy: keep last N or archive to logs/ after task completes
- Add workspace cleanup as a recovery API action

---

## 10. Repair Loop

**ID:** F-REPAIR-002
**Severity:** Minor
**Frequency:** Rare

**Description:** Repair loop is correctly bounded (maxRepairAttempts) but wastes generation time on repeated failures.

**Observed During Benchmark 001:** Yes — Task 40 consumed 43 seconds across 4 repair attempts, all producing the same DUPLICATE_FILE error.

**Root Cause:** Repair prompt doesn't provide enough diagnostic information to break the failure cycle.

**Current Recovery Strategy:** Budget exhaustion → FAILED.

**Recommended Improvement:**
- Include previous output in repair prompt (primary fix)
- Implement early termination: if 2 consecutive repair attempts produce identical errors, fail immediately instead of exhausting budget

---

## 11. Runaway Execution

**ID:** F-RUNTIME-001
**Severity:** Critical
**Frequency:** Rare

**Description:** Runtime continues executing beyond safe bounds (infinite loop, hung generation, stuck state).

**Observed During Benchmark 001:** No — each generation completed within timeout (120s).

**Root Cause:** Model hangs, network issues, or state machine bug.

**Current Recovery Strategy:** Request timeout (120s), lock timeout (180 min), pause flag.

**Recommended Improvement:**
- Add total campaign wall-clock timeout
- Add per-task execution timeout
- Add heartbeat monitoring during generation

---

## 12. Planner Failure

**ID:** F-PLANNER-001
**Severity:** Major
**Frequency:** Rare

**Description:** Planner generates an invalid, incomplete, or contradictory campaign specification (e.g., missing outputs, circular dependencies, wrong task count).

**Observed During Benchmark 001:** No — planner output was valid.

**Root Cause:** Planner logic bug or edge case in brief parsing.

**Current Recovery Strategy:** Campaign validation catches errors before compilation.

**Recommended Improvement:**
- Add planner output diff-based validation
- Compile planner output immediately and reject if compiler produces warnings

---

## 13. Compiler Failure

**ID:** F-COMPILER-001
**Severity:** Critical
**Frequency:** Rare

**Description:** Compiler fails to parse a valid campaign specification, producing 0 tasks or incorrect task counts.

**Observed During Benchmark 001:** No — compiler parsed all 40 tasks correctly.

**Root Cause:** Grammar mismatch, regex bug, or encoding issue.

**Current Recovery Strategy:** Compiler report with diagnostic messages.

**Recommended Improvement:**
- Add fixture-based regression tests for all known campaign formats

---

## 14. Runtime Failure

**ID:** F-RUNTIME-002
**Severity:** Critical
**Frequency:** Rare

**Description:** Runtime crashes or produces incorrect behavior during execution (e.g., wrong task executed, skipped tasks, duplicate writes).

**Observed During Benchmark 001:** No — runtime executed tasks 1–40 in order without crashes.

**Root Cause:** State machine bug, lock contention, or filesystem error.

**Current Recovery Strategy:** Lock management, state persistence.

**Recommended Improvement:**
- Add crash-only design: runtime should tolerate process restart by reading persisted state

---

## 15. Model Failure

**ID:** F-MODEL-001
**Severity:** Major
**Frequency:** Occasional

**Description:** LM Studio model returns empty response, times out, or produces unusable output (invalid JSON, garbage text).

**Observed During Benchmark 001:** No — all generations produced valid responses within timeout.

**Root Cause:** Model instability, server overload, context window exhaustion.

**Current Recovery Strategy:** Request timeout + retry (requestRetries=1). Fail if both attempts fail.

**Recommended Improvement:**
- Increase default requestRetries to 3 for unattended operation
- Add model health check endpoint
- Log token counts per generation for capacity planning

---

## 16. Telemetry Failure

**ID:** F-TELEMETRY-001
**Severity:** Minor
**Frequency:** Systematic

**Description:** Telemetry metrics are missing, incorrect, or misleading.

**Observed During Benchmark 001:** Yes — two specific issues:
1. `campaignCompletionRate` shows 1.0 but only 39/40 tasks completed (should be 0.975)
2. `verificationPasses` shows 0 because no verifiers were enabled

**Root Cause:** Metrics calculation bugs.

**Current Recovery Strategy:** None — metrics are write-only.

**Recommended Improvement:**
- Fix campaignCompletionRate to use completedTasks / totalTasks
- Distinguish "no verifiers configured" from "verifiers failed" in telemetry
- Add metric validation assertion on every metrics write

---

## 17. Model Retry Failure

**ID:** F-MODEL-002
**Severity:** Major
**Frequency:** Rare

**Description:** A single generation failure exhausts both initial attempt + retry, causing task failure.

**Observed During Benchmark 001:** No — only 1 failure (repair exhaustion, not model retry).

**Root Cause:** LM Studio unavailable, model overloaded, network issue.

**Current Recovery Strategy:** Retry once (requestRetries=1).

**Recommended Improvement:**
- Increase retries to 3 for unattended operation
- Add exponential backoff between retries

---

## 18. Configuration Error

**ID:** F-CONFIG-001
**Severity:** Major
**Frequency:** Occasional

**Description:** Runtime settings or policy configured incorrectly, causing unexpected behavior.

**Observed During Benchmark 001:** Yes — `acceptOnlyVerified: true` with 0 enabled verifiers meant verification was a no-op. Effective policy was "accept everything".

**Root Cause:** Default configuration is inconsistent (acceptOnlyVerified=true but verification pipeline has 0 enabled steps).

**Current Recovery Strategy:** None — configuration is applied as-is.

**Recommended Improvement:**
- Validate configuration consistency at campaign creation
- Warn when acceptOnlyVerified=true but no verifiers are enabled
- Default to at least one useful verifier (e.g., file existence check)

---

## 19. Lock Contention

**ID:** F-RUNTIME-003
**Severity:** Minor
**Frequency:** Rare

**Description:** Multiple concurrent requests attempt to execute the same campaign.

**Observed During Benchmark 001:** No — all executions were sequential.

**Root Cause:** Rapid API calls, stale lock detection failure.

**Current Recovery Strategy:** PID-based lock file with staleness check (180 min timeout).

**Recommended Improvement:**
- Add clear error message for locked campaigns
- Add force-unlock recovery action

---

## 20. Recovery Failure

**ID:** F-RECOVERY-001
**Severity:** Critical
**Frequency:** Rare

**Description:** Recovery API fails to restore campaign to a working state.

**Observed During Benchmark 001:** No — recovery not exercised during execution.

**Root Cause:** Corrupt state files, disk full, permission error.

**Current Recovery Strategy:** Recovery preserves corrupt files as .corrupt-* and regenerates defaults.

**Recommended Improvement:**
- Add recovery dry-run mode (simulate recovery without writing)
- Add recovery audit log with success/failure per action
