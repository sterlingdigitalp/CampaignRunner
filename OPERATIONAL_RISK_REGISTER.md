# Operational Risk Register — Campaign Runner

**Assessment for:** 1,000 campaigns → 10,000 campaigns
**Base evidence:** Benchmark 001 (40 tasks, 39 verified, 1 failed)

---

## Risk Scoring

| Likelihood | Score | Definition |
|---|---|---|
| Very High | 5 | Certain or near-certain at scale |
| High | 4 | Likely within 100 campaigns |
| Medium | 3 | Likely within 1,000 campaigns |
| Low | 2 | Possible within 10,000 campaigns |
| Very Low | 1 | Unlikely even at 10,000 |

| Impact | Score | Definition |
|---|---|---|
| Critical | 5 | Campaign data loss, unrecoverable |
| High | 4 | Campaign failure, manual recovery required |
| Medium | 3 | Partial failure, automated recovery possible |
| Low | 2 | Degraded operation, no data loss |
| Cosmetic | 1 | Aesthetic issue, no functional impact |

**Risk Score = Likelihood × Impact** (max 25)

---

## Risk Register

### R-001: DUPLICATE_FILE Protocol Exhaustion

**Description:** The LLM repeatedly generates duplicate FILE: paths across multiple repair attempts, exhausting the repair budget and failing the task. At scale, ~5% of tasks will fail this way.

**Likelihood:** 4 (High) — Observed in 2/40 tasks in Benchmark 001
**Impact:** 3 (Medium) — Single task failure, manual retry recovers
**Risk Score:** 12

**Current Mitigation:** Repair budget (maxRepairAttempts=3), FAILED state
**Recommended Mitigation:** Include previous LLM output in repair prompt; add adaptive repair budget for format-only errors
**Priority:** Critical

---

### R-002: Planner Campaign Specification Degradation

**Description:** The planner generates campaigns with increasingly lower quality as briefs vary — missing metadata, incorrect dependencies, or underspecified outputs.

**Likelihood:** 2 (Low) — Planner output was consistent in Benchmark 001
**Impact:** 4 (High) — Bad campaign spec affects entire multi-hour campaign
**Risk Score:** 8

**Current Mitigation:** Campaign validation rejects invalid specs before compilation
**Recommended Mitigation:** Add planner output diff-based regression tests; track planner quality metrics over time
**Priority:** High

---

### R-003: Protocol Degradation Over Long Campaigns

**Description:** The LLM's protocol compliance degrades over 20+ consecutive responses — early tasks are protocol-compliant, later tasks increasingly produce format errors.

**Likelihood:** 3 (Medium) — Not observed in Benchmark 001 (40 tasks), but possible at 100+
**Impact:** 4 (High) — Increasing failure rate late in campaign
**Risk Score:** 12

**Current Mitigation:** Repair loop recovers format errors
**Recommended Mitigation:** Re-inject protocol instructions periodically; detect degradation trend and auto-restart context
**Priority:** High

---

### R-004: Model Version/Update Drift

**Description:** LM Studio model is updated or swapped, changing output quality, format, or behavior. Previously working campaigns may fail.

**Likelihood:** 3 (Medium) — Model updates are common
**Impact:** 4 (High) — Systematic failure across all campaigns
**Risk Score:** 12

**Current Mitigation:** None specific to model versioning
**Recommended Mitigation:** Pin model version in campaign metadata; add model signature check before execution; run model validation campaign before production use
**Priority:** High

---

### R-005: State File Corruption During Execution

**Description:** Partial write, concurrent access, or disk error corrupts execution_state.json, history.json, or metrics.json during an active campaign.

**Likelihood:** 2 (Low) — Atomic writes mitigate most corruption
**Impact:** 5 (Critical) — Loss of campaign progress
**Risk Score:** 10

**Current Mitigation:** Atomic writes (write temp + rename), recovery module reloads defaults, corrupt files preserved as .corrupt-*
**Recommended Mitigation:** Add periodic state integrity checks; add state checksums; add redundant state copy
**Priority:** High

---

### R-006: Workspace Metadata File Accumulation

**Description:** Hidden metadata files (.campaign_runner_last_response_*.md, .campaign_runner_rejected_response_*.md) accumulate without bound, consuming disk space and confusing operators.

**Likelihood:** 5 (Very High) — Guaranteed: Benchmark 001 produced 160+ files in 40 tasks
**Impact:** 1 (Cosmetic) — ~1MB per 40 tasks; at 10k tasks = 250MB, still manageable
**Risk Score:** 5

**Current Mitigation:** None
**Recommended Mitigation:** Implement retention policy (keep last N or per-task), archive to logs/ directory, add cleanup API action
**Priority:** Low

---

### R-007: Repair Loop Infinite or Runaway

**Description:** A bug in the repair engine causes unbounded repair attempts, consuming model tokens indefinitely.

**Likelihood:** 1 (Very Low) — Current code has hard budget ceiling
**Impact:** 4 (High) — Wasted tokens, delayed execution
**Risk Score:** 4

**Current Mitigation:** `maxRepairAttempts` hard cap (default 3)
**Recommended Mitigation:** Add repair loop timeout; monitor repair budget utilization
**Priority:** Medium

---

### R-008: Runaway Execution (No Upper Bound)

**Description:** Campaign runs indefinitely without progress — generation completes but verification always fails, or task advancement is stuck.

**Likelihood:** 2 (Low) — Not observed in Benchmark 001
**Impact:** 4 (High) — Wastes resources, operator must intervene
**Risk Score:** 8

**Current Mitigation:** Lock timeout (180 min), pause flag
**Recommended Mitigation:** Add total campaign execution timeout; add consecutive failure detection (N failures → auto-pause)
**Priority:** High

---

### R-009: Dashboard Desynchronization

**Description:** Dashboard shows stale state because it reads from disk which may lag behind in-memory execution state.

**Likelihood:** 3 (Medium) — Polling-based dashboards are inherently laggy
**Impact:** 2 (Low) — Operator sees delayed updates, no data loss
**Risk Score:** 6

**Current Mitigation:** None specific
**Recommended Mitigation:** Add last-updated timestamps to all API responses; implement server-sent events
**Priority:** Low

---

### R-010: Recovery API Failure During Incident

**Description:** When a campaign is stuck in FAILED state, the recovery API fails to restore it, leaving no path to recovery.

**Likelihood:** 1 (Very Low) — Recovery API tested successfully during RC QA
**Impact:** 5 (Critical) — Campaign is unrecoverable
**Risk Score:** 5

**Current Mitigation:** 10 recovery actions covering all state files; corrupt file preservation
**Recommended Mitigation:** Add recovery dry-run; add recovery audit log; add recovery-from-backup fallback
**Priority:** Medium

---

### R-011: Telemetry Loss

**Description:** Metrics or history data is lost due to write failure, corruption, or overwrite.

**Likelihood:** 2 (Low) — Atomic writes mitigate write failures
**Impact:** 3 (Medium) — Loss of campaign analytics
**Risk Score:** 6

**Current Mitigation:** history.json.bak backup, atomic writes
**Recommended Mitigation:** Add metrics journaling (append-only log) for recovery; add periodic metrics snapshot
**Priority:** Medium

---

### R-012: Configuration Error — acceptOnlyVerified with No Verifiers

**Description:** Policy has `acceptOnlyVerified: true` but verification pipeline has 0 enabled verifiers, making verification a no-op.

**Likelihood:** 4 (High) — This was the Benchmark 001 configuration
**Impact:** 3 (Medium) — No files fail verification that should; but no safety net either
**Risk Score:** 12

**Current Mitigation:** None
**Recommended Mitigation:** Validate policy consistency at campaign creation; warn or reject inconsistent configurations; enable at least one verifier by default
**Priority:** High

---

### R-013: Unknown Model Behavior

**Description:** A new or different model produces unexpected output patterns — different error types, different failure modes, different format drift.

**Likelihood:** 4 (High) — Each model is unique
**Impact:** 3 (Medium) — Runtime handles protocol violations consistently
**Risk Score:** 12

**Current Mitigation:** Builder Protocol validation is model-agnostic
**Recommended Mitigation:** Add model profiling campaign (run 5-task validation before production); track failure patterns per model
**Priority:** High

---

### R-014: Consecutive Campaign Failures (Multi-Hour Waste)

**Description:** Multiple consecutive campaigns fail early, wasting hours before operator notices.

**Likelihood:** 2 (Low) — Requires sequential failures
**Impact:** 4 (High) — Wasted runtime and tokens
**Risk Score:** 8

**Current Mitigation:** None for unattended operation
**Recommended Mitigation:** Add consecutive failure detection; auto-pause after N consecutive failures; send notification on failure threshold
**Priority:** High

---

### R-015: LM Studio Server Outage

**Description:** LM Studio crashes or becomes unresponsive during execution, causing all generations to fail.

**Likelihood:** 3 (Medium) — Server processes can crash
**Impact:** 4 (High) — All active campaigns stall
**Risk Score:** 12

**Current Mitigation:** Request timeout (120s) + retry (requestRetries=1)
**Recommended Mitigation:** Increase retries to 3 with exponential backoff; add server health-check endpoint; add graceful degradation (pause campaign on server loss)
**Priority:** Critical

---

## Risk Heat Map

| Score | Count | Risks |
|---|---|---|
| 12–15 | 6 | R-001, R-003, R-004, R-012, R-013, R-015 |
| 8–11 | 4 | R-002, R-005, R-008, R-014 |
| 4–7 | 4 | R-006, R-007, R-009, R-010, R-011 |
| <4 | 0 | — |

**Top risks cluster around:** protocol failures, model behavior, and configuration consistency.

---

## Priority Action Items

1. **Fix repair prompt** (R-001) — Include previous LLM output; single change eliminates dominant failure mode
2. **Validate policy consistency** (R-012) — Reject `acceptOnlyVerified=true` with 0 enabled verifiers
3. **Add model health checks** (R-015) — Increase retries, add pre-flight health check
4. **Add campaign wall-clock timeout** (R-008) — Prevent runaway campaigns
5. **Pin model version** (R-004) — Prevent silent model drift
6. **Add protocol degradation detection** (R-003) — Re-inject instructions based on trend
