# Benchmark Comparison 001 vs 002

## Summary

Benchmark 001 proved the architecture could run long autonomous campaigns and fail safely. Benchmark 002 proved the hardened repair engine and telemetry layer could complete the same 40-task campaign without human intervention.

## Side-by-Side Results

| Dimension |Benchmark 001 |Benchmark 002 |Improvement |
| --- |--- |--- |--- |
| Planner |PASS |PASS |Stable |
| Compiler |PASS |PASS |Stable |
| Runtime |PASS through 39 tasks |PASS through 40 tasks |Completed campaign |
| Continuous Execution |PASS |PASS |Stable |
| Dashboard |Partial operational visibility |PASS |Clear runtime state |
| State Persistence |PASS |PASS |Stable |
| Repair Engine |Stopped at Task 40 after repair budget |3 repairs, 3 successes |Recovered autonomously |
| Deterministic Repair |Not sufficient for Task 40 |PASS |Duplicate FILE recovery |
| Telemetry |Limited protocol detail |Metric validation PASS |Auditable |
| Campaign Completion |39 / 40 |40 / 40 |+1 task, full completion |
| Completion Rate |97.5% |100% |+2.5 points |
| Failure Count |1 final failure |0 final failures |Eliminated blocker |

## Metrics

| Metric |Benchmark 001 |Benchmark 002 |
| --- |--- |--- |
| Runtime seconds |Not fully normalized |${b2.runtimeSeconds} |
| Average task time |Not fully normalized |${m2.averageRuntimeSeconds.toFixed(2)}s |
| Repair invocations |${b1.repairCount} |${m2.repairInvocations} |
| Repair successes |${b1.repairs.successes} |${m2.repairSuccesses} |
| Repair failures |${b1.repairs.failures} |${m2.repairFailures} |
| Verification pipeline runs |Unclear before hardening |${m2.verificationPipelineRuns} |
| Verification no-op runs |Not tracked |${m2.verificationPipelineNoopRuns} |
| Verifier passes |0 |${m2.verificationPasses} |
| Verifier failures |0 |${m2.verificationFailures} |
| Metric validation |Not available |${m2.metricValidation.status} |

## Protocol Categories

| Category |Benchmark 001 |Benchmark 002 |
| --- |--- |--- |
| PROTOCOL_DUPLICATE_FILE |Task 40 terminal blocker |${m2.duplicateFileFrequency} occurrences, recovered |
| PROTOCOL_MALFORMED_HEADER |Observed earlier, not fully categorized |${m2.malformedHeaderFrequency} occurrences, recovered |
| PROTOCOL_MISSING_FILE |Not central |1 occurrence, recovered |

## Lessons Learned

- Benchmark 001 showed that duplicate FILE failures are recoverable only when the repair prompt is narrow and concrete.
- Benchmark 002 showed targeted repair and deterministic final-section acceptance can complete the canonical 40-task campaign.
- No-op verification must be explicit; it is operationally different from verifier success.
- Repair prompts, responses, and validation artifacts must be persisted exactly for replay.

## Conclusion

Benchmark 002 demonstrates measurable improvement over Benchmark 001: full completion, zero final failures, repair success across three protocol categories, and metric validation PASS.
