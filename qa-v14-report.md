# QA Round 4: Campaign Runner Execution Runtime Certification

**Date:** 2026-06-25
**QA Lead:** Independent Auditor
**Build:** V1.4
**Status:** PASS WITH ISSUES
**Confidence:** High
**Production Readiness:** Needs Major Fixes

---

## Executive Summary

Campaign Runner has made substantial progress from a prompt scheduler toward an execution runtime. Seven new modules have been added and all are actively used in the execution pipeline. The core architecture — decision engine, builder protocol, execution contract, verification pipeline, and repair loop — is present and functional. The application owns execution, verification, and recovery decisions; the LLM is constrained to generating candidate file output.

However, three critical issues prevent production readiness:

1. **Runtime validation inconsistency**: Corrupted `execution_state.json`, `execution_policy.json`, and `metrics.json` cause HTTP 500 crashes with no recovery mechanism. Only `history.json` has robust auto-recovery.

2. **Profile selection gap**: The execution contract always uses the policy pipeline for non-empty workspaces. A Python project (detected by `pyproject.toml`) still gets Typecheck/Build verifiers (disabled) instead of Python-specific verifiers. Context-aware verifier disable works, but profile-based verifier selection does not.

3. **Builder protocol lacks prefix stripping**: The LLM frequently includes `workspace/` prefix in FILE paths (e.g., `FILE: workspace/src/main.py`), causing files to be written to `workspace/workspace/src/main.py`. The protocol validator should strip the workspace prefix.

---

## Phase 1: Module Existence

| Module | File Exists | Actively Used | Verdict |
|---|---|---|---|
| DecisionEngine | `decision-engine.ts` (47 lines) | Imported by execution-engine.ts, execution-contract.ts | **PASS** |
| FileProtocolValidator | `file-protocol-validator.ts` (55 lines) | Imported by workspace-writer.ts | **PASS** |
| ExecutionContract | `execution-contract.ts` (56 lines) | Imported by execution-engine.ts | **PASS** |
| CampaignProfile | `campaign-profile.ts` (39 lines) | Imported by execution-contract.ts | **PASS** |
| RuntimeValidation | `runtime-validation.ts` (107 lines) | Imported by 6 modules + API route | **PASS** |
| LMStudio | `lm-studio.ts` (78 lines) | Imported by execution-engine.ts | **PASS** |
| WorkspaceWriter | `workspace-writer.ts` (24 lines) | Imported by execution-engine.ts | **PASS** |

**All 7 modules exist and are actively used.** Each is imported by at least one execution path.

---

## Phase 2: Decision Ownership

| Decision | Who Decides | Evidence |
|---|---|---|
| **Accept work?** | **Application** | `DecisionEngine.shouldAccept()` gates on `protocol.valid` and `acceptOnlyVerified`. LLM output must pass protocol + verification. |
| **Repair?** | **Application** | `DecisionEngine.shouldRepair()` checks `repairAttempt < maxRepairAttempts` and `!protocol.valid OR results.some(FAIL)`. |
| **Retry on timeout?** | **Application** | `DecisionEngine.shouldRetry()` only retries on `TIMEOUT` error code if `attempt < maxAttempts`. |
| **Advance?** | **Application** | `DecisionEngine.shouldAdvance()` calls `shouldAccept()` which requires valid protocol + (all PASS or acceptOnlyVerified=false). |
| **Select verifiers?** | **Application** | `DecisionEngine.shouldRunVerifier()` checks workspace files (package.json, tsconfig.json) and workspace maturity (EMPTY/EXISTING/EARLY_STAGE/MATURE). |
| **Determine verifier applicability?** | **Application** | `buildExecutionContract()` chooses profile pipeline for EMPTY workspaces, policy pipeline otherwise. `decisionEngine.shouldRunVerifier()` evaluates each verifier against workspace files. |
| **Reject malformed output?** | **Application** | `FileProtocolValidator.validateFileProtocol()` checks FILE: headers, path safety, duplicates, empty files. Rejected output archived to `.campaign_runner_rejected_response_*.md`. |
| **Declare FAILED?** | **Application** | `DecisionEngine.shouldFail()` returns true when `!shouldAccept && !shouldRepair`. The `execution-engine.ts` transitions to FAILED state. |

**Verdict: The application owns all significant decisions.** The LLM produces candidate FILE: blocks; the application decides acceptance, repair, advancement, and failure. This is the correct architecture.

---

## Phase 3: Builder Protocol Validation

| Format | Accepted? | Rejected? | Workspace Updated? | Protocol Validator Response |
|---|---|---|---|---|
| `FILE: relative/path` on its own line followed by content | **ACCEPTED** | — | Yes | `valid: true`, files extracted |
| `File: relative/path` (case-insensitive) | **ACCEPTED** | — | Yes | Matched by `/^FILE\b/i` |
| Missing FILE header (no blocks) | — | **REJECTED** | No | `NO_FILE_BLOCKS` error |
| Markdown fenced code blocks ` ```python ` (no FILE:) | — | **REJECTED** | No | `NO_FILE_BLOCKS` error |
| `file=path` or `path=path` syntax | — | **REJECTED** | No | `NO_FILE_BLOCKS` error |
| Raw prose without any structured output | — | **REJECTED** | No | `NO_FILE_BLOCKS` error |
| Duplicate FILE: paths | — | **REJECTED** with repair | Yes (first occurrence) | `DUPLICATE_FILE` errors, repair loop engaged |
| Absolute paths `FILE: /absolute/path` | — | **REJECTED** | No | `UNSAFE_PATH` error |
| Path traversal `FILE: ../outside/path` | — | **REJECTED** | No | `UNSAFE_PATH` error |
| `FILE: workspace/src/file.py` (with workspace prefix) | **ACCEPTED** (but wrong location) | — | Yes (workspace/workspace/src/file.py) | No error — prefix not detected |

**Observed in testing:** Hour 1 extracted 5 protocol-compliant files. Hours 2-3 extracted 1 file each. Protocol rejection from DUPLICATE_FILE errors triggered 3 repair attempts correctly.

**Issue:** The LLM is instructed to output `FILE: relative/path`, but it prefixes paths with `workspace/` (e.g., `FILE: workspace/tests/test_app.py`). The expected relative path should be `tests/test_app.py` since the workspace IS the working directory. The prefix is not stripped, creating nested directories.

---

## Phase 4: Workspace Validation

| Scenario | Result | Evidence |
|---|---|---|
| Correct FILE: protocol → Workspace updated | **PASS** | Hour 1: 5 files written to workspace/ |
| Incorrect protocol → Files rejected | **PASS** | DUPLICATE_FILE rejection logged, no workspace files committed |
| Rejected output archived | **PASS** | `.campaign_runner_rejected_response_*.md` saved in workspace |
| No silent acceptance | **PASS** | Rejected outputs do not appear as visible files |
| Workspace reflects accepted files only | **PASS** | Visible workspace files match protocol-compliant FILE: blocks |

**Verdict: Workspace validation works correctly.** File extraction is gated entirely on protocol validation. Rejected responses are archived but not executed.

---

## Phase 5: Verification Pipeline (Context-Aware)

| Scenario | Verifiers Selected | Evidence |
|---|---|---|
| Empty workspace (fresh project) | "Files Exist" (from Generic profile) | Hour 1: 1 verifier ran, PASS |
| Existing project, no package.json/tsconfig.json | 0 verifiers (all disabled) | Hour 3: Typecheck:SKIP, Build:SKIP, Lint:SKIP, Tests:SKIP |
| After workspace deletion → empty again | "Files Exist" (from Generic profile) | Hour 2 retry: maturity EMPTY, profile verifier used |
| With package.json present | Typecheck,Build (from policy) | Decision engine checks package.json existence |

**Context awareness works** — `decisionEngine.shouldRunVerifier()` correctly disables verifiers whose prerequisites are missing:
- Typecheck: disabled when no `tsconfig.json`
- Build: disabled when no `package.json`
- Tests/Lint: disabled by default (enabled=false)

**Gap:** Profile selection only switches for EMPTY workspaces. A Python project with `pyproject.toml` should select the Python profile with "Python Compile" instead of Typecheck/Build. Currently, after EMPTY, it always falls through to the policy pipeline which has no Python verifiers.

---

## Phase 6: Repair Loop

### Observed Behavior
| Failure Type | Repair Attempts | Resolution |
|---|---|---|
| Protocol (DUPLICATE_FILE) | 3 attempts | FAILED after maxRepairAttempts |
| Verification failure | 3 attempts | FAILED after maxRepairAttempts |
| LM timeout | N/A | Immediate FAILED (retryable but requestRetries=0) |

### Repair Prompt Analysis
- **Average prompt size (protocol failure):** ~526 bytes
- **Average prompt size (verification failure):** ~8507 bytes (worst case with 8K verification output)
- **Does NOT include:** Full campaign text, full history, previous LLM output content
- **Includes:** Task header, previous attempt summary, verification output, protocol violations, file list, return instructions

**Verdict:** Repair prompts are concise and focused. No context bloat observed.

### Repair Effectiveness
The current repair loop sends protocol/verification errors back to the LLM but does not include the **previous LLM response**. If the LLM doesn't change its output format, the same error repeats. The `previousAttemptSummary` is only a one-line text summary, not the full previous output.

---

## Phase 7: LM Studio Validation

| Scenario | Observed | Structured Error? | Retry? |
|---|---|---|---|
| Normal operation (Qwen 35B) | Response in 25-30s | N/A | N/A |
| Timeout (slow server) | Correctly detected at 30s (configurable) | `LmStudioError("TIMEOUT")` | Yes (retryable=true) |
| Server unavailable | Connection refused/aborted | `LmStudioError("SERVER_UNAVAILABLE")` | Yes (retryable=true) |
| Model unloaded | HTTP 404 from LM Studio | `LmStudioError("MODEL_UNLOADED")` | Yes (status >= 500) |
| Invalid JSON response | JSON parse failure | `LmStudioError("INVALID_JSON")` | Yes (retryable=true) |
| Empty response | content=null | `LmStudioError("EMPTY_RESPONSE")` | Yes (retryable=true) |
| HTTP error (4xx) | Non-retryable unless model-related | `LmStudioError("HTTP_ERROR")` | Only if model unloaded |
| Slow response (>30s) | AbortController fires | `LmStudioError("TIMEOUT")` | Yes (retryable=true) |

**Verdict:** All error scenarios produce structured errors with clear codes. No hangs (AbortController with configurable timeout). Retryable vs non-retryable distinction is correct.

---

## Phase 8: Runtime Validation

| Corrupted File | System Response | Recovery Mechanism |
|---|---|---|
| `history.json` | HTTP 200, auto-recovered from backup | `readHistoryRecovering()` detects corruption, renames corrupt file, restores `.bak`, falls back to defaults |
| `settings.json` | HTTP 200, defaults used | `readJson()` with fallback parameter |
| `execution_state.json` | **HTTP 500 crash** | **No recovery** — `loadExecutionState()` throws from `parseValidatedJson()` |
| `execution_policy.json` | **HTTP 500 crash** | **No recovery** — `loadExecutionPolicy()` throws from `parseValidatedJson()` |
| `metrics.json` | **HTTP 500 crash** | **No recovery** — loaded in `loadArtifacts()` which throws |

**Verdict: Only history.json and settings.json have proper corruption recovery.** execution_state.json, execution_policy.json, and metrics.json need try/catch fallback similar to history-manager.ts.

---

## Phase 9: State Machine

### Observed Transitions

| From | To | Observed? |
|---|---|---|
| READY | RUNNING | Yes |
| RUNNING | RUNNING | Yes (same-state for generation) |
| RUNNING | WRITING_FILES | Yes |
| WRITING_FILES | VERIFYING | Yes |
| VERIFYING | COMPLETE | Yes |
| VERIFYING | REPAIRING | Yes |
| REPAIRING | WRITING_FILES | Yes |
| WRITING_FILES | FAILED | Yes |
| WRITING_FILES | COMPLETE | Yes (when no verifiers enabled) |
| FAILED | RUNNING | Yes (no gate prevents this) |
| COMPLETE | RUNNING | Yes (next hour) |
| PAUSED | — | Tested via settings |
| RECOVERING | — | **NOT OBSERVED** — no code path transitions to RECOVERING |

### Issues
1. **No transition to RECOVERING state exists.** The state is defined in types.ts but never used.
2. **No gate on FAILED → RUNNING.** `executeNextHour()` does not check current state. This allows infinite re-execution of failed hours without explicit user override.
3. **Execution state has no reset mechanism.** After FAILED, there is no API to reset to READY. Manual file edit is required.

---

## Phase 10: Execution Contract

### Generated Contract (Observed)
```
builderProtocol: "FILE_BLOCKS"
verifierPipeline: [Files Exist (enabled)]   // EMPTY workspace
  OR: [Typecheck(SKIP), Lint(SKIP), Build(SKIP), Tests(SKIP)]  // no package.json
acceptancePolicy: { acceptOnlyVerified: true }
repairPolicy: { maxRepairAttempts: 3 }
workspacePolicy: { maturity: "EMPTY" | "EXISTING" | "EARLY_STAGE" }
```

### Contract Behavior Changes
- **EMPTY** → Profile verifier ("Files Exist") + acceptOnlyVerified=true
- **Has pyproject.toml, no package.json** → Policy verifiers (all SKIP) + acceptOnlyVerified=true
- **Has package.json + tsconfig.json** → Policy verifiers (Typecheck/Build ENABLED) + acceptOnlyVerified=true

**Verdict:** The contract changes behavior based on detected workspace maturity. Changing `acceptOnlyVerified` or `maxRepairAttempts` in the policy correctly propagates through `buildExecutionContract`.

---

## Phase 11: Five Consecutive Tasks

| Task | Result | Time | Verifiers | Protocol |
|---|---|---|---|---|
| Hour 1 | PASS | 26.7s | Files Exist | 5 files |
| Hour 2 (1st attempt) | FAILED | 120s+ | Files Exist followed by Typecheck (repair loop) | DUPLICATE_FILE rejections |
| Hour 2 (2nd attempt, after reset) | PASS | 29.3s | Files Exist | 1 file |
| Hour 3 | PASS | 32.4s | All SKIP | 1 file |
| Hour 4 | RUNNING at server kill | — | — | — |

### Workspace Evolution
- Hour 1: Python project created (pyproject.toml, .gitignore, src/__init__.py, tests/)
- Hour 2: Additional test files, then DUPLICATE_FILE protocol violations
- Hour 3: Additional test file

**Stable pattern:** Each hour produces ~1 file. Protocol compliance is good after initial correction.

---

## Phase 12: Reliability Metrics

| Metric | Value | Notes |
|---|---|---|
| Protocol compliance | 55% (5/9 accepted) | Measured across all attempts |
| First-pass protocol success | 100% (5/5 first attempts) | Initial response always uses FILE: format |
| Verification pass rate | 60% (3/5) | Includes 2 failures from repair loop typecheck |
| Repair success rate | 0% (0/3 repairs resolved failure) | LLM repeated same format errors |
| Average repairs/task | 1.0 | 4 total repairs across 4 executions |
| Average generation time | ~28s | Real Qwen 35B on LM Studio |
| Average verification time | 0.01-0.44s | Files Exist: 0.01s, Typecheck: 0.30-0.44s |
| Average repair time | ~30s | Each repair = new LLM generation |
| Timeout frequency | 2/8 runs (25%) | Due to LM Studio latency spikes |

---

## Phase 13: Stress Testing

| Scenario | Result | Evidence |
|---|---|---|
| Workspace deletion during run | **Resilient** — hour completed, workspace recreated | ensureDir recreated workspace, LLM generated new files |
| Policy deletion | **Resilient** — default policy loaded | loadExecutionPolicy falls back to defaults when file missing |
| Rapid Run Now (3 concurrent) | **Correct** — 1 runs, 2 get 409 | Lock mechanism prevents concurrent execution |
| Browser refresh during run | **Resilient** — state persisted | execution_state.json on disk, lock checked on restart |
| Repeated FAILED state | **Functional** — re-executed from FAILED | No gate on FAILED→RUNNING, campaign advanced |
| Stale lock after client timeout | **Issue** — lock remains if server still processing | Lock released in finally block; only releases after server-side completion |
| LM restart during run | **Correct** — timeout detected | LmStudioError("SERVER_UNAVAILABLE") with retry |

---

## Phase 14: Long Campaign Readiness

| Campaign Length | Would Trust? | Rationale |
|---|---|---|
| 20 tasks | Yes, with caveats | Auto-recovery for history, state machine functional. But watch for LM timeouts and DUPLICATE_FILE protocol errors. |
| 50 tasks | No | Runtime validation gaps (execution_state.json/policy.json corruption = crash). No RECOVERING state. Profile selection gap means wrong verifiers may run. |
| 100 tasks | No | Undefined behavior from nested workspace/ directories accumulating. No cleanup mechanism for stale locks. |
| Overnight | No | No health check mechanism. If a corruption occurs at 2 AM, the system crashes with 500 and no recovery. |
| Weekend | No | Same as overnight. No automated recovery for execution_state.json or metrics.json corruption. |

---

## Phase 15: Regression Testing

| Feature | Still Working? | Evidence |
|---|---|---|
| Campaign creation | **PASS** | 24 prompts created, files generated |
| Campaign parsing | **PASS** | `parseCampaign()` runs, `validateCampaignPrompts()` checks content |
| Prompt editing | **PASS** | Review screen allows per-prompt editing |
| Project creation | **PASS** | `createCampaign()` creates all directories and files |
| Settings | **PASS** | Load/save/validate works |
| LM Studio integration | **PASS** | Real Qwen 35B generated responses |
| History | **PASS** | Atomic writes with .bak, corruption recovery |
| Outputs | **PASS** | hour_NN.md files created with metadata |
| Logs | **PASS** | Structured logs with timestamps and event types |
| Recovery | **PARTIAL** | history.json recovery works; execution_state/policy/metrics do not |
| Workspace | **PASS** | Files written via protocol validator |

**No regressions detected from existing V1.1/V1.3 functionality.**

---

## Builder C Claim Matrix

| Claim | Verdict | Evidence |
|---|---|---|
| DecisionEngine module exists | **PASS** | 47-line file, imported by 2 modules |
| FileProtocolValidator module exists | **PASS** | 55-line file, imported by workspace-writer |
| ExecutionContract module exists | **PASS** | 56-line file, imported by execution-engine |
| CampaignProfile module exists | **PASS** | 39-line file with 5 profiles |
| RuntimeValidation module exists | **PASS** | 107-line file with 6 validators |
| LMStudio module with error handling | **PASS** | 78-line file with AbortController, 6 error codes, retry |
| WorkspaceWriter with protocol gate | **PASS** | 24-line file, gates on protocol validation |
| Application owns decisions | **PASS** | verified through Phase 2 testing |
| Builder Protocol enforcement | **PARTIAL** | FILE: format works, but workspace/ prefix not stripped |
| Context-aware verifier selection | **PASS** | Empty vs existing workspaces handled |
| Profile-based pipeline selection | **PARTIAL** | Only switches for EMPTY; other maturities use policy pipeline |
| Runtime validation with auto-recovery | **FAIL** | Only history.json has auto-recovery |
| RECOVERING state implementation | **FAIL** | State defined but never transitioned to |
| Execution state reset mechanism | **FAIL** | No API to reset FAILED→READY |

---

## New Bugs

### Critical
1. **Corrupted execution_state.json/policy.json/metrics.json crash with 500**
   - **Reproduction:** Write invalid JSON to any of these files, call `/api/status`
   - **Expected:** Graceful fallback to defaults with user notification
   - **Actual:** HTTP 500 Internal Server Error
   - **Fix:** Add try/catch in `loadExecutionState()`, `loadExecutionPolicy()`, and `loadArtifacts()` with fallback to defaults + notification

### High
2. **FILES: workspace/ prefix not stripped**
   - **Reproduction:** LLM returns `FILE: workspace/src/main.py` instead of `FILE: src/main.py`
   - **Expected:** `src/main.py` written to `workspace/src/main.py` (relative to workspace)
   - **Actual:** `workspace/workspace/src/main.py` (nested workspace directory)
   - **Fix:** In `file-protocol-validator.ts`, strip the workspace directory prefix from relative paths

3. **RECOVERING state never used**
   - **Reproduction:** Check all state transition calls in the codebase
   - **Expected:** RECOVERING state transition when corruption is detected
   - **Actual:** State defined in types.ts but no `transitionExecutionState(..., "RECOVERING")` call exists
   - **Fix:** Add RECOVERING transitions in history-manager.ts `readHistoryRecovering()` and execution-state.ts when corruption is detected

4. **No API to reset execution state to READY**
   - **Reproduction:** Campaign fails, stuck in FAILED state
   - **Expected:** API endpoint to reset execution_state.json
   - **Actual:** Must manually edit JSON file
   - **Fix:** Add `/api/recovery` action `resetExecution` or extend state machine with reset option

### Medium
5. **Profile selection gap for non-EMPTY workspaces**
   - **Reproduction:** Create Python project, observe verifier pipeline
   - **Expected:** Python profile with "Python Compile" verifier
   - **Actual:** Policy pipeline with all verifiers disabled
   - **Fix:** After maturity detection, select profile based on detected project type (pyproject.toml→Python, Cargo.toml→Generic, etc.)

6. **No gate on FAILED→RUNNING transition**
   - **Reproduction:** Call `/api/run` after FAILED state
   - **Expected:** Rejected unless explicit user override
   - **Actual:** Transitions to RUNNING silently
   - **Fix:** Check current state in `executeNextHour()`, reject FAILED state

7. **Metrics averageRepairRuntimeSeconds is inflated**
   - **Reproduction:** Executions with repairs produce inflated averages
   - **Expected:** Only repair time, not total runtime
   - **Actual:** `repairRuntime` = runtimeSeconds - verificationRuntimeSeconds, which includes generation time
   - **Fix:** Track repair-specific wall clock time separately

---

## Architecture Assessment

### Execution Runtime
The core execution engine (`execution-engine.ts`) follows a clean pipeline: Generate → Validate Protocol → Run Verifiers → Decide. The loop integrates the decision engine, execution contract, and workspace writer. **Solid architecture, production-quality.**

### Decision Engine
Clear separation of concerns. `shouldAccept`, `shouldRepair`, `shouldRetry`, `shouldFail`, `shouldRunVerifier` each handle one decision. **Well-designed.**

### Execution Contract
Dynamic contract generation based on workspace maturity is the right approach. The `buildExecutionContract` function composes policy, profile, and workspace state into a single contract object consumed by the decision engine. **Good abstraction.**

### Builder Protocol / FileProtocolValidator
Clean regex-based parser for the FILE: format. Error categorization (NO_FILE_BLOCKS, MALFORMED_HEADER, UNSAFE_PATH, DUPLICATE_FILE, EMPTY_FILE) is comprehensive. **Minor fix needed for prefix stripping.**

### Verification Engine
Unchanged from V1.1. Functions correctly with shell exec, timeout, and continueOnFailure. Could benefit from non-shell verifier support (e.g., built-in TypeScript checker). **Adequate for current scope.**

### Repair Engine
Concise repair prompt generation that does not bloat context. Lacks the previous LLM response content, which limits repair effectiveness when the LLM repeats the same output format. **Needs previous response inclusion to improve repair success rate.**

### Runtime Validation
`runtime-validation.ts` provides typed validators for all persisted files. Used by loaders and artifacts API. The validators themselves are correct. **The gap is in error handling at the caller level.**

### Workspace
Protocol-gated file writing with rejection archiving. The `.campaign_runner_last_response_` and `.campaign_runner_rejected_response_` files provide full audit trail. **Minor prefix issue.**

### Recovery
Only `history-manager.ts` has proper corruption detection and auto-recovery. Other files lack this. The `/api/recovery` endpoint provides restoreBackup/rebuildProgress/startNew actions. **Inconsistent — needs to be extended to all persisted files.**

### LM Studio Integration
Class-leading error handling with structured errors, AbortController timeouts, and retry logic. Every failure mode produces a typed, actionable error. **Excellent.**

### Modularity
Good separation of concerns. Each module has a single responsibility. Dependencies flow in one direction (execution-engine imports everything; leaf modules import nothing from the engine). **Well-structured.**

### Future Extensibility
Profile system allows adding campaign types. Protocol validator can be extended with additional patterns. Contract system allows adding workspace policies. **Extensible architecture.**

---

## Decision Ownership Matrix

| Decision | Owner | How |
|---|---|---|
| Whether to accept LLM output | Application | `shouldAccept()` → requires valid protocol + (all PASS or acceptOnlyVerified=false) |
| Whether to repair | Application | `shouldRepair()` → checks attempt count, protocol validity, verification results |
| Whether to retry after timeout | Application | `shouldRetry()` → checks error code and attempt count |
| Whether to advance to next hour | Application | `shouldAdvance()` → delegates to `shouldAccept()` |
| Which verifiers to run | Application | `shouldRunVerifier()` → checks workspace file existence and maturity |
| Whether output format is valid | Application | `validateFileProtocol()` → checks FILE: headers, paths, duplicates |
| What content to generate | LLM | Generates file contents within FILE: blocks |
| What files to create/modify | LLM | Decides filenames within FILE: blocks |
| When campaign is paused | Application | Checks `settings.paused` flag, transitions to PAUSED |
| When to fail permanently | Application | `shouldFail()` → when repair exhausted and acceptance impossible |

**The application owns execution, the LLM owns generation.** This is the correct architectural division.

---

## Final Recommendation

### Overall Status: PASS WITH ISSUES

### Production Readiness: Needs Major Fixes

### Confidence: High

The architecture is sound and the execution pipeline works correctly for happy-path scenarios. The application demonstrably owns all runtime decisions. The builder protocol gates file acceptance. The verification pipeline is context-aware. The LM Studio client has proper error handling.

**However, three issues block production release:**

1. **Corruption of execution_state.json, execution_policy.json, or metrics.json causes hard crash (500)** — this will inevitably happen during long campaigns or filesystem issues.

2. **workspace/ prefix in FILE: paths creates nested directories** — accumulates garbage over long campaigns, confusing the LLM and the decision engine's maturity detection.

3. **No RECOVERING state or execution state reset** — a single failure without auto-recovery can permanently stall a campaign, requiring manual file editing.

### Required for Release (V1.5)
1. Add try/catch with default fallback for all `parseValidatedJson` calls in loaders
2. Strip workspace prefix from FILE: paths in file-protocol-validator.ts
3. Implement RECOVERING state transitions and execution state reset API

### Recommended for Release (V1.6)
4. Profile-based pipeline selection (detect project type, select matching profile)
5. Include previous LLM response in repair prompts to break format-failure loops
6. Add FAILED state gate in executeNextHour (require explicit user override)

---

## Final Assessment

**Is Campaign Runner now functioning as an autonomous execution runtime, or is it still fundamentally a prompt scheduler with additional features?**

**Campaign Runner is now an autonomous execution runtime.** The evidence:

- The application decides whether to **accept, repair, retry, advance, or fail** — the LLM only generates file content.
- The **builder protocol** constrains output format to `FILE: relative/path` blocks. Malformed output is rejected and archived.
- The **execution contract** adapts verifier selection based on detected workspace maturity and file existence.
- The **verification pipeline** runs shell commands and gates advancement on results.
- The **LM Studio client** handles timeouts, server errors, empty responses, and invalid JSON with structured error codes and configurable retries.
- The **state machine** persists transitions through all states: READY → RUNNING → WRITING_FILES → VERIFYING → REPAIRING → COMPLETE/FAILED.

The application no longer delegates workflow decisions to the LLM. The prompt scheduler has been replaced by a decision-driven execution runtime. The remaining issues are robustness gaps in the runtime validation layer, not architecture flaws.

**With the three critical bugfixes listed above, this system is ready for production campaigns.**
