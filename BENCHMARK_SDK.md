# Benchmark SDK

## Standard Artifacts

Every benchmark should produce:

- `benchmark.json`
- `benchmarkSummary.json`
- `plannerReport.json`
- `compilerReport.json`
- `campaign.ast.json`
- `taskGraph.json`
- `metrics.json`
- `metricsValidation.json`
- `configValidation.json`
- `history.json`
- `logs/run.log`
- `repairs/taskNNN/**`
- `outputs/hour_NN.md`
- Optional benchmark comparison and postmortem reports

## Required Metadata

- Benchmark ID
- Runtime version
- Planner version
- Compiler version
- Repair Engine version
- Model
- Campaign title, ID, version, and profile when present
- Task count
- Completed task count
- Runtime seconds
- Result
- Repair count
- Failure count
- Git commit when available

## Replay Contract

A benchmark is replay-ready when:

- Original task prompts are persisted.
- Original model responses are persisted.
- Repair prompts are persisted exactly as sent.
- Repair responses are persisted.
- Protocol validation results are persisted.
- Execution history and metrics match benchmark summary.

## Runtime 1.0 Baseline

Benchmark 002 is the Runtime 1.0 certification baseline:

- 40 / 40 completed tasks
- 3 / 3 repair successes
- Metric validation PASS
- Zero final failures
