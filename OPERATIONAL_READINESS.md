# Operational Readiness

## Clone And Run

A developer should be able to clone the repository, install dependencies, start the app, load the canonical campaign, and run Benchmark 002 with the local model endpoint configured in project settings.

## Current Friction

- Local LM Studio availability is still an external prerequisite.
- Benchmark execution depends on the local model producing Builder Protocol output.
- Documentation campaigns intentionally skip package/build verifiers when the workspace has no package metadata.
- Benchmark comparison reports are generated as repository documents, not yet by a one-command benchmark runner.

## Ready State

Runtime 1.0 is operationally ready when:

- `npm run typecheck` passes.
- `npm run build` passes.
- `node scripts/repair-regression.mjs` passes.
- Benchmark artifacts include `benchmark.json`, `metrics.json`, `metricsValidation.json`, `history.json`, and repair sessions where repairs occurred.

## Recommended Follow-Ups

- Add a single benchmark command that runs a named campaign and writes comparison/postmortem reports.
- Add a lightweight environment doctor for LM Studio endpoint, model name, and workspace permissions.
- Add profile-specific verification presets for documentation campaigns.
