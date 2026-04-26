# ADR-0002: Cross-Scope Component Placement

Status: Accepted
Date: 2026-05-23

## Context

The project owns a scoped application (`x_1158634_kb_int_0`) but operates on Global-scope tables (`incident`, `rm_story`, `kb_knowledge`, `m2m_kb_task`). ServiceNow's scope isolation rules force a design decision for every component: does it live in the scoped app, or in Global?

## Constraints

- Business Rules attached to a Global-scope table cannot be authored in a scoped app's context; ServiceNow places them in Global.
- Script Includes invoked from Global-scope code must have `Accessible from = All application scopes` to be reachable.
- AJAX Script Includes called from Client Scripts must additionally be marked `Client callable`.
- UI Macros and Formatters rendering on Global-scope forms do not reliably receive `current` in their Jelly evaluation context when authored in a scoped app. See [ADR-003](0003-suggestion-panel-rendering.md) for the workaround.

## Decision

Component placement follows this matrix:

| Component class | Scope | Cross-scope flag |
|---|---|---|
| Custom tables | Scoped (`x_1158634_kb_int_0`) | n/a |
| Script Includes invoked only from scoped code | Scoped, "This application scope only" | n/a |
| Script Includes invoked from Global-scope Business Rules or Client Scripts | Scoped, **All application scopes** | required |
| `SuggestionAjax` (called from Client Script) | Scoped, **All application scopes + Client callable** | required |
| Business Rules on `incident` and `rm_story` | Global | n/a |
| Business Rule on `x_1158634_kb_int_0_dev_capture` | Scoped | n/a |
| UI Action `Capture for KB` (on `incident`) | Global | n/a |
| UI Actions on scoped tables | Scoped | n/a |
| UI Macro `kb_intel_suggestion_panel` | Global | n/a |
| Formatter `KB Intelligence Suggestions` | Global | n/a |
| Client Script on `incident` | Global | n/a |
| Scheduled Job | Scoped | n/a |
| Script Actions for scoped events | Scoped | n/a |
| Event registry entries | Scoped | n/a |
| System properties | Scoped | n/a |

## Rationale

Three principles drove the matrix:

1. **Logic lives in the scope.** All business logic (clustering, draft generation, prompt construction, AJAX endpoint, scheduled job) stays in the scoped app. This is the unit of packaging.
2. **Glue lives in Global.** Anything that has to attach to a Global table (Business Rule, UI Action, UI Macro, Client Script) is in Global. These are unavoidable Global artefacts and must be tracked as such for Update Set capture.
3. **Cross the boundary once.** Global-scope code calls scoped Script Includes; scoped code never calls back into Global-scope code. This eliminates a class of subtle scope-bridging bugs.

## Consequences

Positive:
- Update Set capture is predictable: scoped artefacts in the App Update Set, Global artefacts in a parallel Global Update Set. Documented in [deployment.md § Promotion](../deployment.md#promotion-to-another-instance).
- Easy to disable: deactivating the four Global Business Rules halts all entry points to the scoped pipelines.

Negative:
- Promotion requires two Update Sets. Cannot ship as a single self-contained scoped app. This is a ServiceNow platform constraint, not a project decision.
- Auditing requires looking in two places. Mitigated by naming convention (all Global artefacts are named `KB Intel` or `KB Intelligence ...` so they sort together in list views).

## Implementation notes

`LLMConnector`, `ResolutionSuggester`, `SuggestionAjax` are flagged "All application scopes". `KBDraftBuilder`, `IncidentClusterEngine`, `DevOpsContextFetcher` are "This application scope only" because they are called only from other scoped code (the Scheduled Job and the dev_capture Business Rule).
