# KB Intelligence

Scoped ServiceNow application that drives knowledge capture for Tier 2 / Tier 3 support engineers. Three closed-loop workflows:

1. Cluster recurring resolved incidents, draft canonical KB articles from cluster resolution corpora (weekly batch).
2. Surface top-N similar past resolutions on incident assignment (form-level decision support).
3. Capture post-resolution detail from resolvers and developers, expand structured input into reviewed KB articles (event-driven).

All AI-generated articles pass through a Knowledge Manager review gate. No auto-publish.

## Scope

Application: `KB Intelligence`
Scope identifier: `x_1158634_kb_int_0`

## Stack

| Layer | Technology |
|---|---|
| Platform | ServiceNow (Yokohama+ verified; Vancouver / Washington compatible) |
| Clustering / similarity | Predictive Intelligence (`com.glide.platform_ml`), with deterministic fallback |
| Text generation | Google Gemini `generateContent` (default), Now Assist `OneExtendUtil` (alternate) |
| Workflow | Flow Designer + Business Rules + Script Actions |
| UI | UI Macro placeholder + onLoad Client Script + AJAX (`AbstractAjaxProcessor`) |
| Telemetry | Custom suggestion log + PA indicators |

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System decomposition, sequence flows, component responsibilities |
| [docs/data-model.md](docs/data-model.md) | Custom table schemas, ACLs, properties |
| [docs/component-design.md](docs/component-design.md) | Pseudocode for each Script Include and the contracts they implement |
| [docs/prompts.md](docs/prompts.md) | System and user prompt templates, output schema, tuning guidance |
| [docs/deployment.md](docs/deployment.md) | Prerequisites, scope creation, deployment order, smoke tests |
| [docs/operations.md](docs/operations.md) | Rate-limit handling, cost envelope, observability, runbook |
| [docs/adr/](docs/adr) | Architecture Decision Records |

## Source layout

```
src/
  script_includes/    server-side classes (5 core + 1 AJAX endpoint + 1 alternate connector)
  business_rules/     async triggers on incident, rm_story, and the capture table
  client_scripts/     onLoad renderer for the suggestion panel
  ui_actions/         form buttons (capture, submit, approve, reject)
  ui_macros/          static placeholder div
  scheduled_jobs/     weekly cluster batch
  script_actions/     event-driven notifications
tests/
  smoke/              copy-paste background scripts for post-deploy verification
```

## Status

Functional on a Personal Developer Instance with demo data (~200 closed incidents). Production readiness gated on the items listed in [docs/operations.md § Production checklist](docs/operations.md#production-checklist).
