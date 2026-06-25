# Regression Recommendations — Derived from Benchmark 001

Every item below is a direct lesson from Benchmark 001 that should be encoded as a permanent regression test.

---

## Test Categories

### 1. Duplicate FILE Repair

**Scenario:** Submit a response with 2+ identical FILE: paths. Verify the runtime rejects with DUPLICATE_FILE, enters repair loop, and archives the rejected response.

**Expected Result:**
- PROTOCOL_REJECTED event logged
- REPAIR_REQUESTED event logged
- STATE_TRANSITION: WRITING_FILES → REPAIRING
- Rejected response archived as `.campaign_runner_rejected_response_*.md`

**Priority:** Critical

---

### 2. Malformed Header Repair

**Scenario:** Submit a response with `file:` (lowercase) or `File:` (mixed case) instead of `FILE:`. Verify rejection and repair.

**Expected Result:** Same as Duplicate FILE repair but with MALFORMED_HEADER error code.

**Priority:** Critical

---

### 3. Repair Budget Exhaustion

**Scenario:** Submit 4 consecutive responses with the same protocol violation. Verify the runtime exhausts `maxRepairAttempts` (3) and transitions to FAILED.

**Expected Result:**
- Attempts 1–3: REPAIR_REQUESTED → REPAIR_COMPLETED → PROTOCOL_REJECTED
- Attempt 4: REPAIR_REQUESTED → REPAIR_COMPLETED → PROTOCOL_REJECTED
- After attempt 4: STATE_TRANSITION: WRITING_FILES → FAILED
- EXECUTION_STOPPED event with message containing "repair attempts"
- Execution state: FAILED with `lastError` containing "repair"

**Priority:** Critical

---

### 4. Continuous Execution

**Scenario:** Execute all tasks of a campaign sequentially without operator intervention. Verify autonomous task advancement.

**Expected Result:**
- Each VERIFIED task advances `currentStep` by 1
- CAMPAIGN_ADVANCED event logged with step number
- RUN_LOOP_TRACE shows correct iteration from fresh state
- History persisted after each execution

**Priority:** Critical

---

### 5. Task Advancement Verification

**Scenario:** After each verified execution, verify that:
- `history.currentStep` equals the next unexecuted task number
- `history.completedSteps` includes the just-completed step
- The next task prompt is built from the correct prompt file
- No tasks are skipped

**Expected Result:** Sequential advancement through all N tasks.

**Priority:** Critical

---

### 6. Campaign Persistence

**Scenario:** Execute 3 tasks, then reload the project from disk. Verify that history, metrics, execution state, and outputs are all correctly persisted.

**Expected Result:**
- `history.json` has 3 execution records
- `metrics.json` reflects 3 executions
- `execution_state.json` shows correct state
- Output files exist for each executed task

**Priority:** Critical

---

### 7. Dashboard Synchronization

**Scenario:** After executing a task, poll the status API `/api/status` (or equivalent). Verify reflected state matches the persisted execution state.

**Expected Result:** Dashboard API returns `currentStep`, `completedSteps`, and state that match `history.json` and `execution_state.json`.

**Priority:** High

---

### 8. Protocol Validation — Unsafe Path

**Scenario:** Submit a response with `FILE: /absolute/path/file.ts` or `FILE: ../../etc/passwd`. Verify the runtime rejects with UNSAFE_PATH.

**Expected Result:** PROTOCOL_REJECTED with UNSAFE_PATH error code.

**Priority:** High

---

### 9. Protocol Validation — No FILE Blocks

**Scenario:** Submit a response containing no `FILE:` blocks. Verify the runtime rejects with NO_FILE_BLOCKS.

**Expected Result:** PROTOCOL_REJECTED with NO_FILE_BLOCKS error code.

**Priority:** High

---

### 10. Graceful Shutdown

**Scenario:** During active execution (RUNNING state), send a pause request. Verify the runtime completes the current operation and pauses before starting the next task.

**Expected Result:**
- Current generation or write completes without interruption
- Next task is NOT started
- State shows PAUSED
- Resuming continues from the correct step

**Priority:** Critical

---

### 11. State Recovery — Corrupt Execution State

**Scenario:** Corrupt `execution_state.json` with invalid JSON. Reload the project. Verify automatic recovery.

**Expected Result:**
- RECOVERY_PERFORMED event logged
- Corrupt file preserved as `.corrupt-*`
- New execution_state.json with defaults
- State transitions through RECOVERING → READY

**Priority:** High

---

### 12. State Recovery — Corrupt History

**Scenario:** Corrupt `history.json` with invalid JSON. Reload the project. Verify automatic recovery from backup or defaults.

**Expected Result:**
- If `.bak` exists: restored from backup
- If no `.bak`: new empty history with `recovery.mode = true`
- History corruption does not crash the server

**Priority:** High

---

### 13. Metrics Accuracy

**Scenario:** Execute 10 tasks with known outcomes (8 verified, 2 failed, 4 repair attempts). Verify metrics.json matches expected values.

**Expected Result:**
- `totalExecutions`: 10
- `verifiedExecutions`: 8
- `failedExecutions`: 2
- `firstPassSuccesses`: 8 (if failures both required repair)
- `totalRepairAttempts`: 4
- `campaignCompletionRate`: 0.8 (8/10)

**Priority:** High

---

### 14. Tool Calling / No FILE Blocks

**Scenario:** The LLM returns plain text or a description of changes instead of FILE: blocks.

**Expected Result:** Runtime detects NO_FILE_BLOCKS protocol violation and enters repair loop.

**Priority:** High

---

### 15. Workspace Normalization

**Scenario:** LLM returns `FILE: workspace/src/file.ts` (with workspace/ prefix). Verify the runtime normalizes to `src/file.ts`.

**Expected Result:** PROTOCOL_PATH_NORMALIZED event logged. File written to `src/file.ts`, not `workspace/workspace/src/file.ts`.

**Priority:** High

---

### 16. Sequential Dependency Ordering

**Scenario:** Run a campaign where tasks have `Depends On: Task N-1`. Verify tasks execute in order and no task starts before its dependency completes.

**Expected Result:** Execution records show sequential `hour` values matching dependency order.

**Priority:** High

---

### 17. Repair Prompt Content

**Scenario:** Inspect the repair prompt sent to the LLM after a DUPLICATE_FILE rejection. Verify it includes the specific duplicate paths from the previous attempt.

**Expected Result:** Repair prompt contains "Duplicate FILE: path/to/file.md was generated N times" or similar specificity.

**Priority:** Medium

---

### 18. Multi-File Response Handling

**Scenario:** Submit a response with 3 unique FILE: blocks. Verify all 3 files are written to workspace.

**Expected Result:** FILES_WRITTEN event with "Wrote 3 protocol-compliant files." Each file exists in workspace.

**Priority:** High

---

### 19. No-Output Task Handling

**Scenario:** Submit a response with no FILE: blocks but valid verification. Verify behavior (should be rejection — Builder Protocol requires FILE: blocks).

**Expected Result:** NO_FILE_BLOCKS protocol rejection.

**Priority:** High

---

### 20. Lock Prevention

**Scenario:** Submit two simultaneous execution requests for the same campaign. Verify the second request is rejected.

**Expected Result:** Second request returns an error or status indicating the campaign is locked.

**Priority:** High

---

### 21. Empty Campaign Specification

**Scenario:** Compile an empty campaign text. Verify the compiler rejects with appropriate error.

**Expected Result:** "Campaign text is required." or similar meaningful error message.

**Priority:** Medium

---

### 22. Campaign with Only Metadata

**Scenario:** Compile a campaign specification with metadata but no tasks. Verify the runtime rejects with appropriate error.

**Expected Result:** "No executable tasks were parsed." or similar meaningful error message.

**Priority:** Medium

---

### 23. Legacy HOUR Format (No Markdown Prefix)

**Scenario:** Compile a legacy campaign using bare `HOUR NN` format. Verify correct parsing.

**Expected Result:** 24 tasks detected, format=legacy-hour, status=PASS.

**Priority:** High

---

### 24. Legacy HOUR Format (With Markdown ## Prefix)

**Scenario:** Compile a legacy campaign using `## HOUR NN` format. Verify correct parsing.

**Expected Result:** Same as bare HOUR format. (Current behavior: FAIL — see Bug 1 from Compiler QA.)

**Priority:** Medium (until bug is fixed)

---

## Regression Test Priority Summary

| Priority | Count | Criteria |
|---|---|---|
| Critical | 10 | Blocking for production reliability |
| High | 9 | Required before Benchmark 002 |
| Medium | 5 | Should fix, not blocking |

**Total regression tests recommended: 24**
