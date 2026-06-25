# Benchmark 001 — Reliability Scorecard

**Campaign:** Knowledge_Service Phase 0 (40 tasks)
**Model:** local-model (Qwen 35B via LM Studio)
**Date:** 2026-06-25
**Duration:** ~17 minutes (13:46–14:03)
**Result:** 39/40 verified (97.5%), 1 repair exhaustion

---

## Scoring Key

| Score | Meaning |
|---|---|
| 10 | Production-grade, no observed issues |
| 8–9 | Reliable, minor improvement opportunity |
| 6–7 | Adequate, known weakness |
| 4–5 | Marginal, requires hardening |
| 1–3 | Unreliable, must address before production |

---

## 1. Planner

**Score: 8/10**

**Evidence:**
- Generated a valid 40-task Campaign Specification v1.0 document from the Knowledge_Service brief
- Correctly identified 19 phases (milestones) matching the spec's deliverable groups
- Correct sequential dependency chain (tasks depend on prior task)
- All tasks have proper FILE: output declarations

**Strengths:**
- Produces deterministic campaign specs
- Task types cycle through CREATE/MODIFY/VERIFY/REFACTOR/FINALIZE appropriately
- Checkpoints inserted at interval intervals

**Weaknesses:**
- All tasks have `Task Type: Unspecified` because the Phase 0 source spec doesn't use task-type headers — the planner generated tasks without explicit Task Type field
- Milestones are not explicitly listed in the spec header — they are embedded as Phase headings in the task body

**Recommendations:**
- Verify planner produces explicit `Task Type:` fields in generated campaigns
- Consider adding milestone metadata to the campaign header section (not just embedded Phase headings)

---

## 2. Campaign Specification

**Score: 9/10**

**Evidence:**
- Phase 0 specification (376 lines) compiled to 40 executable tasks, 19 milestones
- Correctly detected as `campaign-spec-v1` format
- All metadata fields correctly extracted (title, workspace, builder protocol)

**Strengths:**
- Human-readable Markdown format
- Self-documenting (Conventions section included as narrative)
- Supports both structured fields and freeform Markdown body

**Weaknesses:**
- Workspace specification uses `**Workspace root:** \`path\`` which is non-standard; the compiler handled it via flexible field extraction
- No `Builder Protocol:` field in the source spec (compiler inferred from FILE: entries)

**Recommendations:**
- Standardize metadata field format across all generated specs
- Add Builder Protocol explicitly to the template header

---

## 3. Compiler

**Score: 9/10**

**Evidence:**
- 100% task extraction: all 40 tasks parsed into the campaign model
- Pipeline summary: 40→40→40→40→40 (no count drift)
- `duplicateIntroducedAt`: "none"
- Status: PASS
- 19 milestones correctly assigned to tasks
- Compiler diagnostics produced 1 info-level warning (BODY_TASK_REFERENCE_IGNORED)

**Strengths:**
- Deterministic compilation
- Stage-level timing and diagnostics
- Transparent pipeline summary

**Weaknesses:**
- No line-number tracking for MALFORMED_METADATA diagnostics (lineNumber field absent)
- Task type defaults to "Unspecified" when not present (acceptable for legacy specs, but should warn)

**Recommendations:**
- Track metadata field line numbers for more precise diagnostics
- Add warning when task type is missing for campaign-spec-v1 format

---

## 4. Campaign Model

**Score: 9/10**

**Evidence:**
- Campaign model contains all 40 prompts with correct ordering (1–40)
- Task graph built with 39 edges (sequential chain)
- 41 workspace outputs declared (40 individual + 1 with `*` glob)
- Milestones stored in milestone array with taskNumbers

**Strengths:**
- Clean separation of AST artifacts from usable model
- Task graph correctly identifies dependencies
- All checkpoints and final certification preserved

**Weaknesses:**
- Milestone association not preserved in individual prompt objects (moved to milestone.taskNumbers arrays)
- Phase 0 campaign shows `milestone: null` on individual prompts despite belonging to Phase A

**Recommendations:**
- Preserve `milestone` field on individual prompts in the campaign model

---

## 5. Runtime

**Score: 8/10**

**Evidence:**
- 40 consecutive executions without crash
- Autonomous task advancement after each verified execution
- State machine transitions: COMPLETE→RUNNING→RUNNING→WRITING_FILES→COMPLETE (normal flow)
- State machine transitions for repair: WRITING_FILES→REPAIRING→WRITING_FILES→...
- Final transition: WRITING_FILES→FAILED
- Execution state persisted correctly after shutdown (FAILED state at hour 40)

**Strengths:**
- No crashes during 17-minute continuous operation
- State persistence survives between executions
- Lock management prevented concurrent execution
- Correct advancement through all 40 tasks

**Weaknesses:**
- Task 40 consumed 4 repair attempts but `repairAttempt` in execution_state shows 3 (off-by-one: attempt numbering starts at 1, repair counter starts at 0)
- `lastError` message is generic ("Verification failed after repair attempts") — doesn't specify DUPLICATE_FILE
- No upper bound on total campaign runtime (40 tasks × ~30s = 20 min with no progress cap)
- All hours show attempt=1 except Hour 6 (attempt=3) and Hour 40 (attempt=4) — the attempt counter increments correctly but the "attempt" field in the execution record shows the total attempts, not the current attempt number

**Recommendations:**
- Add total campaign timeout / max wall-clock time
- Enrich error messages with specific failure details
- Fix repair attempt counter consistency

---

## 6. Repair Engine

**Score: 6/10**

**Evidence:**
- Hour 6: Successfully recovered after 2 repair attempts (DUPLICATE_FILE)
- Hour 40: Failed after 4 repair attempts (repeated DUPLICATE_FILE)
- Repair cycle: REPAIR_REQUESTED → REPAIRING → REPAIR_COMPLETED → PROTOCOL_REJECTED
- Repair budget: maxRepairAttempts=3 (used: 4 for Hour 40 — initial + 3 repairs)
- Repair prompt does NOT include previous LLM output

**Strengths:**
- Repair loop is bounded (does not loop infinitely)
- State machine transitions correct during repair
- Repair execution is timed and logged

**Weaknesses:**
- **Root cause of Task 40 failure**: Repair prompt doesn't include the previous LLM response. The model repeatedly produces the same DUPLICATE_FILE error because it doesn't see its previous mistake
- Repair success requires the model to independently guess the correct format — no contextual guidance
- Repair prompt is concise but lacks diagnostic details (e.g., "you generated 4 duplicate FILE: paths, expected unique paths")

**Recommendations:**
- **CRITICAL**: Include the previous LLM response in the repair prompt
- Include specific protocol rejection details in the repair prompt (e.g., "your previous attempt included duplicate path X, Y, Z")
- Consider showing the diff between expected and actual output

---

## 7. Protocol Validation

**Score: 9/10**

**Evidence:**
- 95% of tasks (38/40) passed protocol on first attempt
- DUPLICATE_FILE correctly detected for Hours 6 and 40
- Rejected responses archived with full content for forensic analysis
- Normalization correctly applied (workspace/ prefix stripping, backslash handling)

**Strengths:**
- No false positives: all 8 rejected responses were genuine DUPLICATE_FILE violations
- Correct path normalization
- Rejected response archives include timestamps and attempt numbers

**Weaknesses:**
- DUPLICATE_FILE error message is repeated verbatim in multi-file protocol log: `PROTOCOL_REJECTED:` line shows all errors concatenated with ` | ` separators — readable but noisy
- No metadata logged about WHICH file duplication patterns are most common across a campaign

**Recommendations:**
- Aggregate DUPLICATE_FILE statistics per campaign (most duplicated paths, frequency)
- Improve PROTOCOL_REJECTED log format for multi-file responses

---

## 8. Persistence

**Score: 8/10**

**Evidence:**
- history.json persisted after every execution (atomic write with .bak)
- execution_state.json persisted at every state transition
- metrics.json updated after each execution
- Output files generated for all 39 verified tasks
- Workspace files generated for accepted outputs

**Strengths:**
- Atomic history writes (write to temp, rename)
- Backup file (.bak) always present for history recovery
- Campaign summary persisted and updated
- Compiler report persisted at campaign creation

**Weaknesses:**
- **160+ hidden response files** accumulated in workspace/ without rotation (~1MB)
- No retention policy for `.campaign_runner_last_response_*.md` and `.campaign_runner_rejected_response_*.md`
- campaign_summary.json has two variants: `campaign_summary.json` and `campaignSummary.json` (potential confusion)

**Recommendations:**
- Implement workspace audit trail cleanup (keep last N, or archive to logs/)
- Unify campaign summary filename (prefer `campaign_summary.json` as canonical)
- Add retention configuration for hidden metadata files

---

## 9. Telemetry

**Score: 6/10**

**Evidence:**
- Run log: 2031 lines with structured events
- Metrics: 16 fields tracked (execution counts, repair counts, runtime)
- History: 40 execution records with per-task details
- State transitions: fully logged with timestamps

**Strengths:**
- Structured event format with timestamps and event names
- ADVANCEMENT_TRACE provides detailed step advancement diagnostics
- Per-execution timing data preserved

**Weaknesses:**
- **No protocol compliance % metric** (38/40 first-pass = 95%, but not tracked)
- **No repair success rate metric** (1/2 = 50%, not tracked)
- **No DUPLICATE_FILE frequency metric** (8 rejections total, not tracked)
- **No per-task timing breakdown for repair attempts** (only total runtime)
- **verificationPasses shows 0** despite 39 successful executions — the pipeline reported 0 enabled verifiers, but the metric doesn't distinguish "verifier exhausted" from "verifier not configured"
- **campaignCompletionRate shows 1.0** despite only 39/40 tasks completed — this could mislead operators
- **No task type success rate** (CREATE vs MODIFY vs FINALIZE)

**Recommendations:**
- Add: protocolCompliancePercent, repairSuccessRate, duplicateFilePathFrequency
- Add: per-attempt timing breakdown (generation, verification, protocol, repair)
- Fix: campaignCompletionRate should be 39/40 = 0.975, not 1.0
- Fix: verificationPasses should distinguish "0 enabled" from "0 passed"

---

## 10. Dashboard

**Score: 5/10**

**Evidence:**
- API endpoints exist for status, history, settings, policy, recovery
- Dashboard renders campaign state, execution progress, and settings
- No dedicated real-time execution view beyond polling

**Strengths:**
- Basic campaign status display works
- Settings editor functional
- History accessible through API

**Weaknesses:**
- **No live execution view** — operator must poll status endpoint
- **No per-task detail view** — individual task outputs and repair history not surfaced in UI
- **No failure reason displayed** — operator sees "FAILED" but must read run.log to learn it was DUPLICATE_FILE
- **No replay/debug mode** for inspecting historical executions
- **No timeline visualization** of the 40-task execution

**Recommendations:**
- Add per-task execution detail view (output, repair history, timing)
- Surface failure reasons in the dashboard (not just log files)
- Add execution timeline visualization
- Add real-time status streaming (SSE or WebSocket)

---

## 11. Recovery

**Score: 8/10**

**Evidence:**
- Not exercised during Benchmark 001 (no corruption events)
- Recovery API provides 10 actions tested during RC QA
- Runtime recovery module handles execution_state, policy, metrics, and summary recovery
- Corrupt files preserved as `.corrupt-*` for forensic analysis

**Strengths:**
- Recovery API is comprehensive (10 distinct actions)
- Corrupt file preservation is production-grade
- Recovery lifecycle (FAILED→RECOVERING→READY) is well-defined

**Weaknesses:**
- Recovery module was not triggered during Benchmark 001 — its effectiveness in an active multi-hour campaign is untested
- No automated corruption detection during execution (only at load time)

**Recommendations:**
- Add periodic integrity checks during long-running campaigns
- Test recovery during active execution (not just at startup)

---

## 12. Observability

**Score: 6/10**

**Evidence:**
- Structured log events with timestamps available
- Metrics aggregated at campaign level
- Compiler report produced per campaign
- No metrics beyond aggregate campaign-level stats

**Strengths:**
- Log events use consistent format: `[TIMESTAMP] EVENT_NAME: message`
- State transitions are logged with before/after values
- Advancement traces provide detailed step-by-step diagnostics

**Weaknesses:**
- **No real-time metrics stream** — all data is polled from file system
- **No alert mechanisms** — operator must watch logs manually
- **No trend analysis** — metrics are campaign-level only, no time-series across campaigns
- **No model performance tracking** — token usage, generation quality, retry patterns not tracked
- **No structural health metrics** — file counts, disk usage, state integrity not exposed

**Recommendations:**
- Add real-time event stream for operational monitoring
- Track model usage costs (token counts per task)
- Add structural health checks exposed via API
- Implement alert thresholds for failure rates, repair exhaustion, long runtimes

---

## 13. User Recovery Experience

**Score: 5/10**

**Evidence:**
- Task 40 failed with `EXECUTION_STOPPED: Hour 40 failed: Verification failed after repair attempts.`
- State shows FAILED with `lastError: "Verification failed after repair attempts."`
- No actionable recovery instructions for the operator
- Recovery API must be called manually — no guided recovery flow

**Strengths:**
- Failure state is persisted and visible
- "Paused" flag on settings allows manual intervention

**Weaknesses:**
- **No guided recovery** — operator must know to call recovery API endpoints
- **Error message hides root cause** — "Verification failed after repair attempts" doesn't say WHY
- **No "retry from failed task" button** — operator must manually trigger Run which retries
- **No explanation of repair budget exhaustion** — operator doesn't know 4 attempts were made
- **No suggestion to fix the campaign spec or repair prompt** — operator must independently deduce the issue

**Recommendations:**
- Surface root cause in dashboard: "Model repeatedly generated duplicate file paths (README.md × 4). Repair attempts exhausted."
- Add one-click "Skip Task" and "Retry with Modified Prompt" buttons
- Provide repair guidance: "Consider increasing maxRepairAttempts or providing more context in repair prompts"

---

## 14. Developer Diagnostics

**Score: 7/10**

**Evidence:**
- Rejected response archives contain full LLM output for each rejection
- Run log contains 2031 lines of structured events
- History contains per-execution records with timing and status
- Compiler report provides stage-level diagnostics

**Strengths:**
- Rejected response preservation (6 files for Task 40 alone) enables deep forensic analysis
- Run log captures every state transition with timestamps
- ADVANCEMENT_TRACE events make step-advancement bugs debuggable

**Weaknesses:**
- **No structured error aggregation** — must grep 2031 lines manually to find all PROTOCOL_REJECTED events
- **No replay tool** — cannot re-run a specific hour with the same prompt
- **No diff between repair attempts** — cannot see how the LLM response changed between attempts
- **No campaign-level error summary** — need to manually correlate 40 execution records

**Recommendations:**
- Add structured error aggregation endpoint (error categories, frequencies, trends)
- Add per-campaign diagnostic summary dashboard
- Add repair attempt diff viewer
- Add execution replay mode for forensic analysis
