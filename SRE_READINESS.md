# SRE Readiness Review — Campaign Runner

**Assessment for:** Unattended production operation
**Base evidence:** Benchmark 001 (40 tasks, 39 verified, 1 failed)
**Evaluated by:** Reliability Engineer

---

## Can this safely run overnight?

**Assessment: YES, WITH CAVEATS**

**Evidence:**
- Benchmark 001 ran 40 consecutive tasks in ~17 minutes (13:46–14:03) without supervision
- 39/40 tasks succeeded autonomously
- Task 40 correctly halted on repair exhaustion — did not loop infinitely
- Lock timeout (180 min) prevents concurrent execution
- Request timeout (120s) prevents hung generations
- State persists through the execution lifecycle

**Risks:**
- Task 40 was the 40th task — task would have been stuck for hours until operator checked
- No notification mechanism for failures
- No wall-clock timeout for total campaign duration
- Pause/resume requires manual operator action

**Recommendations:**
- Add email/notification on task failure
- Add webhook for failure events
- Add total campaign timeout (e.g., max 2× estimated duration)
- Add auto-retry for FAILED tasks with exponential backoff

---

## Can this safely execute unattended?

**Assessment: CONDITIONAL YES**

**Conditions:**
1. `requestRetries` increased from 1 to 3 (for LM Studio flakiness)
2. Repair prompt fix applied (previous LLM output included)
3. Consecutive failure detection added (auto-pause after N failures)
4. At least one meaningful verifier enabled (or `acceptOnlyVerified: false`)

**Evidence:**
- 38/40 tasks (95%) passed on first attempt — the model is reliable
- Both failures were DUPLICATE_FILE protocol violations, not crashes
- Runtime correctly bounded all operations (timeouts, repair budget)
- State machine had zero illegal transitions in 200+ events

**Risks:**
- Without repair prompt fix, ~5% of tasks risk stuck failure (Task 40 scenario)
- If LM Studio goes down during unattended hours, campaign stalls until someone restarts it
- No self-healing for transient errors beyond current retry config

**Recommendations:**
- Implement health check before each execution cycle
- Add auto-pause on consecutive failures
- Increase retry count for model unavailability
- Add retry on startup for FAILED campaigns (retry failed task, don't stay FAILED forever)

---

## Can failures be recovered remotely?

**Assessment: PARTIALLY**

**Evidence:**
- Recovery API provides 10 actions that can be invoked remotely via HTTP
- Reset execution, recover state, recover policy, recover metrics all tested
- Recovery does NOT require file system access or SSH

**Limitations:**
- No guided recovery flow — operator must know which API endpoint to call and what it does
- No "Retry failed task" single-action endpoint (requires calling run + understanding state)
- Recovery actions require knowledge of API routes and payloads
- Recovery API is not discoverable (no /api/recovery/index or schema endpoint)

**Recommendations:**
- Add `/api/recovery/auto` — intelligent recovery that diagnoses state and applies best recovery
- Add OpenAPI/Swagger documentation for recovery API
- Add one-click "Retry" and "Skip" for failed tasks
- Add recovery status endpoint that shows available actions

---

## Can benchmarks be replayed?

**Assessment: NO**

**Evidence:**
- No replay mechanism exists
- Benchmark 001 execution history is stored as data, not as a replayable script
- Cannot "re-run Hour 6 with the original prompt and different LLM" without manual reconstruction

**Recommendation:**
- Add execution recording: capture prompt, response, and outcome for each task as a replayable test fixture
- Add replay mode: given a campaign and execution record, re-run with different model or settings
- Store each task's prompt and response in a structured format (not just archived files)

---

## Can incidents be reconstructed?

**Assessment: PARTIALLY**

**Evidence:**
- Task 40 incident is reconstructable from:
  - Execution records (history.json) — shows 4 attempts, all failed
  - Run log (2031 lines) — shows every state transition, protocol rejection, repair event
  - Rejected response archives (6 files) — shows exactly what the LLM generated
  - Workspace files — shows what was accepted before the failure

**Limitations:**
- 2031 lines of log must be manually analyzed — no query interface
- No structured error summary — must grep for PROTOCOL_REJECTED to count occurrences
- No correlation between rejection events and repair attempts without manual parsing
- Execution records don't include the specific failure reason per attempt (only final status)

**Recommendations:**
- Add structured error aggregation (counts per error type per campaign)
- Add per-task diagnostic summary (attempts, rejections, outcomes, timings)
- Add execution timeline visualization (Gantt chart of 40 tasks)

---

## Can operators trust telemetry?

**Assessment: PARTIALLY**

**Evidence of reliability:**
- `totalExecutions` (40) matches history.json execution count ✓
- Per-execution timestamps are consistent and sequential ✓
- State transitions are logged and verifiable ✓

**Evidence of untrustworthiness:**
- `campaignCompletionRate` reports 1.0 but only 39/40 tasks completed ❌
- `verificationPasses` reports 0 but all 39 tasks passed verification (no verifiers enabled) ❌
- `firstPassSuccesses` reports 38, but this counts protocol acceptance not generation quality — conflates two distinct concepts ⚠️

**Recommendation:**
- Fix campaignCompletionRate to completedTasks / totalTasks
- Add metric validation assertions on write
- Distinguish "no verifier configured" from "verifier failed" in telemetry
- Add telemetry tests that verify metrics against history

---

## Can failures be reproduced?

**Assessment: PARTIALLY**

**Evidence:**
- DUPLICATE_FILE failures are reproducible by prompting the model to modify the same file twice in one response — this is a predictable model behavior
- Task 40 can be partially reconstructed: the same prompt can be sent to the model and will likely reproduce the same DUPLICATE_FILE error

**Limitations:**
- Model responses are non-deterministic — exact failure may not reproduce
- No automated test harness for failure reproduction
- No snapshot-based testing (capture prompt, response, and expected outcome)

**Recommendations:**
- Add snapshot testing for protocol validation (unit tests with known good/bad inputs)
- Add model response caching for deterministic regression tests
- Add deterministic mode: use stored responses instead of real model for pipeline testing

---

## SRE Scorecard

| Question | Score | Evidence |
|---|---|---|
| Safe overnight? | 7/10 | Yes, but 5% task failure risk; no notification |
| Safe unattended? | 6/10 | Conditional on repair fix + retry increase |
| Remote recovery? | 6/10 | Recovery API works but not discoverable or guided |
| Benchmarks replayable? | 2/10 | No mechanism exists |
| Incidents reconstructable? | 7/10 | Logs+archives enable reconstruction but require manual work |
| Telemetry trustworthy? | 6/10 | Metrics mostly correct but 2 known issues |
| Failures reproducible? | 5/10 | Partial — depends on model non-determinism |

**Overall SRE Readiness: 6/10**

---

## Required Improvements Before Unattended Operation

### Must Fix (SRE Gate)
1. Fix repair prompt to include previous LLM output
2. Add notification on task failure (webhook or email)
3. Increase requestRetries default to 3
4. Add campaign wall-clock timeout
5. Fix campaignCompletionRate metric
6. Validate acceptOnlyVerified consistency

### Should Fix (Before 100th Campaign)
7. Add consecutive failure auto-pause
8. Add health check before execution
9. Add execution recording for replay
10. Add structured error aggregation endpoint

### Nice to Have (Phase 2)
11. Guided recovery flow
12. Execution timeline visualization
13. Snapshot-based testing
14. Model version pinning
