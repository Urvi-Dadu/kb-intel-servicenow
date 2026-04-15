# Architecture

## Workflows

Three independent workflows share a common downstream review-and-publish path.

### W1. Batch cluster generation

```
incident (state IN 6,7, close_notes not null, sys_updated_on >= now - 365d)
   |
   v
PI Cluster Solution (incident_cluster_l2l3)        [or keyword fallback]
   |
   v
x_1158634_kb_int_0_cluster                          one row per detected group
   |
   v   (clusters with member_count >= 5 AND no non-rejected draft)
   |
KBDraftBuilder.buildFromCluster
   |
   v
LLMConnector.callGemini   ----> Google Gemini generateContent (JSON mode)
   |
   v
x_1158634_kb_int_0_kb_draft (review_state = draft)
   |
   v
Script Action: x_1158634_kb_int_0.draft.created
   |
   v
Email to Knowledge Manager group
```

Trigger: `SJ_weekly_cluster_run` (Sundays 02:00). Per-call 5s spacing to stay under Gemini free-tier 15 RPM.

### W2. Resolution suggestion (form-level)

```
incident.assignment_group changes
   |
   v   (BR async, order 1000)
   |
ResolutionSuggester.suggestForIncident
   |
   v   (PI Similarity Solution, or keyword fallback)
   |
x_1158634_kb_int_0_suggestion_log row (JSON payload)
   |
   .....   form reload   .....
   |
incident form onLoad (Client Script)
   |
   v
GlideAjax -> SuggestionAjax.getSuggestions
   |
   v
DOM injection into #kbi_panel (UI Macro placeholder)
```

The PI/keyword decision and suggestion ranking are entirely server-side. The client is a thin renderer. See [ADR-003](adr/0003-suggestion-panel-rendering.md) for the rationale behind the client-side render approach over a Jelly-driven formatter.

### W3. Capture-driven generation (incidents and stories)

```
A) incident resolved      B) rm_story state IN (closed_complete)
       |                          |
       v                          v
   "Capture for KB"        BR async (story closure)
   UI Action click                 |
       |                           v
       |                   x_1158634_kb_int_0_dev_capture (draft)
       |                           |
       |                           v
       |                   email developer (Script Action)
       |                           |
       \----------> resolver/developer fills structured fields
                                   |
                                   v
                       "Submit for KB Generation" UI Action
                                   |
                                   v
                          BR async (capture submitted)
                                   |
                                   v
                       KBDraftBuilder.buildFromDevCapture
                                   |
                       +-----------+-----------+
                       |                       |
                       v                       v
              DevOpsContextFetcher    LLMConnector.callGemini
              (optional; commits)     (gemini-2.5-pro for stories)
                       |                       |
                       +-----------+-----------+
                                   |
                                   v
                          x_1158634_kb_int_0_kb_draft
                                   |
                            (downstream as W1)
```

## Common downstream

All drafts converge on `x_1158634_kb_int_0_kb_draft`, get reviewed by the Knowledge Manager group, and on approval produce a `kb_knowledge` record with `workflow_state = published`. Cluster source is back-linked; incident source generates an `m2m_kb_task` entry.

## Component inventory

| Component | Type | Scope | Notes |
|---|---|---|---|
| `LLMConnector` | Script Include | `x_1158634_kb_int_0` (cross-scope) | Wraps Gemini REST; 429 backoff |
| `LLMConnector` (alternate) | Script Include | `x_1158634_kb_int_0` | Routes to OneExtendUtil under `llm_provider=now_assist` |
| `IncidentClusterEngine` | Script Include | `x_1158634_kb_int_0` | PI primary, keyword fallback |
| `ResolutionSuggester` | Script Include | `x_1158634_kb_int_0` (cross-scope) | Same fallback pattern |
| `KBDraftBuilder` | Script Include | `x_1158634_kb_int_0` | Two entry points (cluster, capture) |
| `DevOpsContextFetcher` | Script Include | `x_1158634_kb_int_0` | Defensive; no-op if DevOps plugin absent |
| `SuggestionAjax` | Script Include | `x_1158634_kb_int_0` (cross-scope, client callable) | AJAX endpoint for the suggestion panel |
| `BR_incident_assignment_suggest` | Business Rule | Global | Async after-write |
| `BR_suggestion_log_close` | Business Rule | Global | Closes the loop on MTTR measurement |
| `BR_story_closure_capture` | Business Rule | Global | Async after-write |
| `BR_devcapture_submitted` | Business Rule | `x_1158634_kb_int_0` | Async; invokes KBDraftBuilder |
| `kb_intel_suggestion_panel` | UI Macro | Global | Static `<div id="kbi_panel">` |
| `KB Intelligence Suggestions` | Formatter | Global | Maps macro to incident form |
| `CS_incident_suggestions_load` | Client Script (onLoad) | Global | Calls SuggestionAjax, renders into placeholder |
| `Capture for KB` | UI Action | Global | On incident, opens dev_capture |
| `Submit for KB Generation` | UI Action | `x_1158634_kb_int_0` | Validates + transitions capture |
| `Approve & Publish` / `Reject Draft` | UI Action | `x_1158634_kb_int_0` | KM-gated |
| `SJ_weekly_cluster_run` | Scheduled Job | `x_1158634_kb_int_0` | Sundays 02:00 |
| `SA_draft_created_notify` | Script Action | `x_1158634_kb_int_0` | KM group email |
| `SA_story_capture_request` | Script Action | `x_1158634_kb_int_0` | Developer email |

Cross-scope flag set on every component invoked from Global. See [ADR-002](adr/0002-cross-scope-component-placement.md) for the placement matrix.

## Data flow guarantees

- **No auto-publish.** Every LLM output lands in `kb_draft.review_state = draft`. Promotion to `kb_knowledge` requires a UI Action invocation by a user with `knowledge_manager` or `admin`.
- **Idempotent batch.** `SJ_weekly_cluster_run` skips clusters with any draft in `(draft, in_review, approved, published)`. Rejected drafts dismiss their cluster.
- **Bounded LLM volume.** Per-run cap of 50 clusters; per-call 5s sleep. Story-closure path uses `gemini-2.5-pro` (5 RPM, 100/day on free tier) which gates by user behavior not batch volume.
- **PI optional, not required.** Clustering and similarity both have keyword fallbacks; the system runs without `com.glide.platform_ml`.

## External dependencies

- `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` (POST; outbound HTTPS required)
- ServiceNow DevOps tables (optional): `sn_devops_commit`, `sn_devops_change_artifact`
- ServiceNow Now Assist (optional, alternate): `sn_one_extend_util.OneExtendUtil`

## Non-goals

- Replacement for Now Assist for ITSM (intentionally compatible-with, not equivalent-to).
- Generative content for incident classification or routing. Predictive Intelligence already handles those use cases.
- Multilingual KB generation. English only at present; prompt structure permits language switch via a single system property if required later.
