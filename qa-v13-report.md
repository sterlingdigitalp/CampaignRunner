# QA Round 3: Campaign Runner V1.3 Release Audit

**Date:** 2026-06-25
**Auditor:** Automated QA
**Build Label:** V1.3
**Status:** **DO NOT RELEASE**

---

## 0. Executive Summary

**V1.3 is identical to V1.1. Zero code changes were made.** Every file sha256sum matches the V1.1 audit. Builder C's claims of a "decision engine," "control loop," and "verification pipeline as a completely restructured V1.3 feature" are false. V1.3 should not be released; V1.1 was already insufficiently tested to ship.

---

## 1. Builder C Claims vs. Reality

| Claim | Actual | Verdict |
|---|---|---|
| "New decision engine guides the LLM" | No `decision-engine.ts` exists. No file with "decision" in the name. The LLM runs unrestricted. | **FALSE** |
| "Full control loop" for execution | No `control-loop.ts` exists. Execution is a linear `executeNextHour` function. | **FALSE** |
| "Verification pipeline v2" | Identical `verification-engine.ts` from V1.1 (exists at V1.1 hash `347b38c18b78ba44656dd3cb5a857c95978506a2659c535fea7b70880ac13563`) | **FALSE** |
| "Enhanced repair engine" | Identical `repair-engine.ts` - 16 lines, unchanged from V1.1 | **FALSE** |
| "Execution policy v1.3" | Identical `execution-policy.ts` from V1.1 | **FALSE** |
| "V1.3 architecture rewrite" | All 26 `.ts` files are byte-for-byte identical to V1.1 | **FALSE** |

## 2. What Actually Works (inherited from V1.1)

### State Machine (PASS)
- Correct transitions: READY → RUNNING → WRITING_FILES → VERIFYING → REPAIRING → COMPLETE/FAILED
- All states logged with timestamps and transition data
- State persists to `execution_state.json`
- Verified in real execution with live LM Studio

### Execution Policy (PASS)
- Load/save from `execution_policy.json`
- `verificationPipeline` with `enabled`, `timeoutSeconds`, `continueOnFailure` flags
- `acceptOnlyVerified` gates advancement correctly
- `maxRepairAttempts` limits repair loop iterations

### Verification Pipeline (PASS - functional but has issues)
- Shell commands executed with timeouts
- stdout/stderr captured (up to 12KB each)
- Pipeline breaks on `continueOnFailure: false` verifier failure
- `allVerifiersPassed()` correctly handles SKIP/FAIL/PASS

### Lock Mechanism (PASS)
- PID-based lock prevents concurrent execution
- Stale lock detection via PID alive check + age timeout
- Auto-recovery on stale locks

### Metrics (PASS)
- Tracks executions, verified, failed, first-pass, repairs
- Average runtime calculation
- Campaign completion rate

### History (PASS - with minor issues)
- Atomic writes via `writeHistoryAtomic` (writes to `.bak` then renames)
- Execution records accumulated
- Recovery endpoint with `restoreBackup`, `rebuildProgress`, `startNew`

### Concurrent Execution Prevention (PASS)
- Second request correctly rejected with "A campaign step is already running."

## 3. What Works But Has Issues

### 3a. Workspace Writer - File Extraction Broken (FAIL)
The `writeCandidateFiles` function extracts ZERO files from LLM responses. Two regex patterns look for `path=` or `File:` prefixes on fenced code blocks, but the LLM outputs plain markdown code blocks with language tags (` ```json `), without the required path prefix.

**Evidence:** In both hours tested, every log entry reads: `"No file blocks found; archived raw response only."`

**Impact:** The workspace is never populated with generated files. Verification runs against an empty workspace. The entire generation-to-file pipeline is a no-op.

### 3b. Repair Loop Ineffective (FAIL)
The `buildRepairPrompt()` is only 16 lines - the entire repair strategy is "tell the LLM to fix the issues." It doesn't:
- Target specific errors
- Provide file content context
- Restrict scope
- Validate repair response format

Each repair attempt regenerates a new LLM response but the same file extraction failure occurs. The repair loop burns LLM tokens and time to produce identical results.

**Evidence:** All 3 repair attempts produced "No file blocks found" and the same Typecheck verification failure.

### 3c. No LLM Timeout (WARN)
The `completeWithLmStudio` function calls `fetch(settings.endpoint, ...)` with **no timeout**. If LM Studio is unreachable, the fetch hangs for the OS default timeout (75s+ on macOS). If the model is loaded but produces no response, the campaign runner blocks indefinitely.

### 3d. Execution State Never Reset After Failure (FAIL)
When execution reaches FAILED state, there is no mechanism to reset it to READY. The recovery endpoint only restores `history.json`, not `execution_state.json`. The campaign is stuck in FAILED forever with no automated recovery path.

### 3e. FAILED State Does Not Gate Re-execution (WARN)
`executeNextHour()` does not check the current execution state. It allows running from FAILED state, which silently transitions FAILED → RUNNING. This means infinite re-execution of the same failed hour is possible without any circuit-breaker.

**Evidence:** After FAILED, `/api/run` was called and the system re-ran hour 3 again (and failed again) with no guard.

### 3f. Prompt Builder Regex Is Too Loose (BUG)
The campaign parser regex `/^HOUR\s+\d{1,2}\b.*$/gim` uses the `i` flag, matching "Hour", "hour", "HOUR". A line like "Hour 1 Task" in the LLM output or task description is parsed as a second hour section, causing `"Expected 24 prompts, found 48. Duplicate hours: 1, 2, 3..."` errors.

**Impact:** Campaign text with natural language containing "Hour N" must be carefully crafted to avoid parse errors.

## 4. Decision Ownership Analysis (FAIL)

The defining requirement was: **"The application must make decisions; the LLM should only generate candidate solutions."**

**Reality:** The LLM makes ALL decisions:
- What technology stack to use (Node.js/TypeScript, Python, etc.)
- What files to create
- What structure the project should have
- When the output is complete
- Whether to modify or create files

The application provides zero decision-making:
- No project structure schema
- No template enforcement
- No output validation against requirements
- No decision engine code exists
- No guard rails for LLM choices

**Verdict:** Decision ownership is entirely delegated to the LLM. The key architectural requirement is not just unimplemented - the concept doesn't exist in the codebase.

## 5. Comparison to V1.1

| File | V1.1 sha256 | V1.3 sha256 | Match? |
|---|---|---|---|
| `defaults.ts` | `df47f3b7c5bb98552aaa3695998221def86fc06c7bef6124a6b7e98051ad888d` | Same | **IDENTICAL** |
| `types.ts` | `05021a52531512c679d17d12cefe7eaa6b2cf6e3a5c1eb6416666db29f3135df` | Same | **IDENTICAL** |
| `execution-engine.ts` | `ac83ab1fce47d3922e36842baf105f5bd75c373f4c260f9d3ed8e65af9706ec6` | Same | **IDENTICAL** |
| `execution-policy.ts` | `7890dcf887003f552c36631c2ca12d7928b0ebdcf8d2b0bef840c194129d4406` | Same | **IDENTICAL** |
| `execution-state.ts` | `4890e621f96a858d5432a95f5f81e8062b1088b7d75d34c669b984085f828d5e` | Same | **IDENTICAL** |
| `verification-engine.ts` | `347b38c18b78ba44656dd3cb5a857c95978506a2659c535fea7b70880ac13563` | Same | **IDENTICAL** |
| `repair-engine.ts` | `59955d2eb3fc93eb7c333282c19d674b00af8e695f9ac94e127c4dcf847b6c27` | Same | **IDENTICAL** |
| `metrics.ts` | `e32d7f045d0388299c5a52f2793b84709e0b31fd8955c82b70a829b1d2affdd9` | Same | **IDENTICAL** |
| `page.tsx` | `9c5542daee7cde6ef9f9a60de2cd9b90641f8afc784ab6b7001db05662a6d090` | Same | **IDENTICAL** |
| All other `.ts` files | V1.1 | Same | **IDENTICAL** |

All files dated 2026-06-25. No new files exist.

## 6. Recommendations

### Critical (blocking release)
1. **Do not release V1.3.** It offers nothing over V1.1 and V1.1 was already blocked from release during QA Round 2.
2. **Fix workspace file extraction.** The regex patterns in `writeCandidateFiles` must match the LLM's actual output format, or the LLM prompt must instruct the model to use the `path=` syntax.
3. **Build an actual decision engine.** The application needs to own: project structure definition, file creation decisions, technology stack requirements, and acceptance criteria.
4. **Add LM Studio timeout.** `completeWithLmStudio` needs a configurable timeout with graceful error handling.
5. **Reset execution state on failure recovery.** The recovery endpoint must also reset `execution_state.json` to READY.

### High Priority
6. **Gate execution on state.** `executeNextHour` should reject runs from FAILED state unless explicitly overridden.
7. **Improve repair prompt.** The repair engine needs to include the LLM's previous output, verification stdout/stderr, and specific file-level guidance.
8. **Enforce acceptOnlyVerified default.** Currently defaults to `true` with Typecheck and Build verifiers, which will block ALL first-time users who don't have a pre-existing TypeScript project.

### Medium Priority
9. **Fix campaign parser regex.** Remove the `i` flag from `/^HOUR\s+\d{1,2}\b.*$/gim` to prevent "Hour N Task" lines from being parsed as section headers.
10. **Add execution state reset API.** Provide explicit API endpoint to reset execution state to READY.
11. **Add circuit breaker.** Prevent infinite re-execution of the same failed hour.

---

## Appendix: Test Results Summary

| Test | Result | Notes |
|---|---|---|
| TypeScript compilation | PASS | `npx tsc --noEmit` - clean compile |
| Campaign creation | PASS | 24 prompts created |
| State machine: READY→RUNNING→WRITING_FILES→COMPLETE | PASS | Verified in live execution |
| State machine: VERIFYING→REPAIRING→FAILED | PASS | Verified with Typecheck verifier |
| Execution policy load/save | PASS | Persisted to disk |
| Verification pipeline execution | PASS | Shell commands run with timeouts |
| Repair loop: 2 iterations | PASS | 2 repairs attempted |
| Concurrent execution prevention | PASS | Lock mechanism prevented duplicate run |
| History atomic write | PASS | `.bak` file created correctly |
| Metrics accumulation | PASS | All counters correct |
| Recovery: restoreBackup | PASS | History restored from backup |
| Prompt preview API | PASS | Returns runtime and repair previews |
| **Workspace file extraction** | **FAIL** | Zero files extracted from LLM responses |
| **Decision engine existence** | **FAIL** | No decision engine code exists |
| **Control loop existence** | **FAIL** | No control loop code exists |
| **Code changes from V1.1** | **FAIL** | Zero changes, exact byte match |
