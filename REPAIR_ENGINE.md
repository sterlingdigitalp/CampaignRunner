# Repair Engine

## Purpose

The Repair Engine keeps autonomous campaigns moving when model output violates the Builder Protocol or verification fails. Runtime 1.0 focuses on precise protocol repair rather than broad regeneration.

## Protocol Taxonomy

| Category |Meaning |Strategy |
| --- |--- |--- |
| PROTOCOL_DUPLICATE_FILE |Same normalized FILE path appears more than once |Return exactly one block for the offending path |
| PROTOCOL_DUPLICATE_PATH |Different emitted paths normalize to one target |Choose one normalized relative path |
| PROTOCOL_MALFORMED_HEADER |A FILE-like line does not match FILE: relative/path |Rewrite only the header |
| PROTOCOL_MISSING_FILE |No FILE block was emitted |Return required workspace output block |
| PROTOCOL_INVALID_PATH |Path is empty or invalid |Use non-empty relative path |
| PROTOCOL_EMPTY_OUTPUT |FILE block has no contents |Return complete non-empty contents |
| PROTOCOL_UNSAFE_PATH |Absolute path or traversal |Use safe workspace-relative path |

## Repair Flow

1. Build runtime prompt.
2. Receive model response.
3. Validate Builder Protocol.
4. If invalid, persist original prompt, response, and validation.
5. Build targeted repair prompt.
6. Persist repair prompt exactly as sent.
7. Receive repair response and validate again.
8. Accept only when protocol and verification policy pass.
9. Persist repair summary and execution metrics.

## Deterministic Repairs

Runtime 1.0 can accept a clean final Builder Protocol section after a model reasoning block when duplicate FILE failures are caused by protocol-looking examples in reasoning text. Original failures remain recorded for telemetry.

## Repair Budget

Repair attempts are bounded by execution policy. Exhaustion stops the campaign and records final failure.

## Persistence and Replay

Repair sessions are written to Project/repairs/taskNNN. Each attempt stores original prompt, original response, repair prompt, repair response, validation result, category, timestamp, and final outcome.

## Benchmark 002 Improvements

Benchmark 002 completed 40 / 40 tasks with 3 repair invocations and 3 repair successes across missing FILE, malformed header, and duplicate FILE categories.

## Future Extension Points

- Adaptive repair prompts by model family.
- Cross-task protocol learning.
- Partial acceptance for independent multi-file tasks.
- Repair category dashboards over multiple benchmarks.
