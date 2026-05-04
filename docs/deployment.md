# Deployment

Target: ServiceNow PDI (Yokohama+). Production deployment via Update Set or App Repo packaging; assumes the same prerequisites and properties.

## Prerequisites

| Requirement | Verified by |
|---|---|
| Admin role on target instance | `gs.hasRole('admin')` |
| Outbound HTTPS to `generativelanguage.googleapis.com` | Test REST Message GET on `/v1beta/models`; expect HTTP 200 or 401 |
| Knowledge Management Advanced (`com.snc.knowledge_advanced`) | Plugin list |
| Agile Development 2.0 (`com.snc.sdlc.agile.2.0`) | Required only for W3 story path |
| Predictive Intelligence (`com.glide.platform_ml`) | Optional; deterministic fallback ships in the engines |
| ServiceNow DevOps (`sn_devops`) | Optional; W3 enrichment only |
| Now Assist Skill Kit (`sn_now_assist_skillkit`) | Optional; required only for alternate LLM connector |
| Gemini API key from Google AI Studio | `https://aistudio.google.com/apikey`; key prefix `AIza` |
| Knowledge Manager group + members | `sys_user_group` with `email` populated on members |
| `kb_knowledge_base` to publish into | sys_id required for `target_kb_base` property |

If demo data is needed, the seed script at [tests/smoke/seed_incidents.js](../tests/smoke/seed_incidents.js) generates 200 closed incidents with realistic resolution notes.

## Deployment order

Strict order; later steps depend on prior artifacts.

1. **Scope.** Create scoped app `KB Intelligence` (identifier `x_1158634_kb_int_0`).
2. **Tables.** Create the four custom tables per [data-model.md](data-model.md). Add choice lists.
3. **ACLs.** Apply the table-level ACL grid in [data-model.md § ACL summary](data-model.md#acl-summary).
4. **Properties.** Create all twelve system properties. Set `gemini_api_key` last (after verifying connectivity).
5. **Script Includes** (in scope, in this order to satisfy dependencies):
   1. `LLMConnector` (cross-scope, active)
   2. `DevOpsContextFetcher` (private)
   3. `IncidentClusterEngine` (private)
   4. `ResolutionSuggester` (cross-scope)
   5. `KBDraftBuilder` (private; depends on 1, 2)
   6. `SuggestionAjax` (cross-scope, **client callable**)
6. **PI Solutions** (skip if PI not active):
   1. Train Cluster Solution `incident_cluster_l2l3` over `incident.{short_description, description, category}` filtered to closed + resolution-noted + last 365 days. Activate the trained version.
   2. Train Similarity Solution `incident_similarity_l2l3` with same inputs and filter. Activate.
7. **Scheduled Job.** `Weekly Incident Cluster Run`, Sunday 02:00. Execute once manually post-deploy to seed.
8. **Business Rules:**
   - `incident` Global async: assignment suggest (order 1000), suggestion log close (order 2000).
   - `rm_story` Global async: story closure capture (order 1000).
   - `x_1158634_kb_int_0_dev_capture` scoped async: submission triggers `KBDraftBuilder`.
9. **UI Macro + Formatter** (Global): `kb_intel_suggestion_panel` and `KB Intelligence Suggestions` on `incident`.
10. **Client Script** (Global, onLoad on `incident`): `KB Intel: Load Suggestions`.
11. **UI Actions:** `Capture for KB` on `incident` (Global), `Submit for KB Generation` on dev_capture (scoped), `Approve & Publish` and `Reject Draft` on kb_draft (scoped, KM-only).
12. **Script Actions** for the two events: `x_1158634_kb_int_0.draft.created` and `x_1158634_kb_int_0.story.capture_request`. Both with corresponding Event Registry entries.
13. **Form Layout.** Add `KB Intelligence Suggestions` formatter near the top of the incident form.

## Property values

| Property | Value source |
|---|---|
| `gemini_api_key` | Google AI Studio |
| `default_model` | `gemini-2.5-flash` |
| `story_model` | `gemini-2.5-pro` |
| `cluster_solution_name` | `incident_cluster_l2l3` (matches step 6.1) |
| `similarity_solution_name` | `incident_similarity_l2l3` (matches step 6.2) |
| `min_cluster_size` | `5` |
| `lookback_days` | `365` |
| `suggestion_top_n` | `3` |
| `target_kb_base` | sys_id of chosen `kb_knowledge_base` |
| `knowledge_manager_group` | sys_id of KM `sys_user_group` |
| `llm_provider` | `gemini` (default) |
| `now_assist_capability_id` | empty unless `llm_provider=now_assist` |

## Post-deploy smoke tests

All under **System Definition > Scripts - Background**. Real scripts in [tests/smoke/](../tests/smoke/).

| Test | Pass criterion |
|---|---|
| `llm_connector_smoke.js` | Returns JSON with non-empty `text`, `tokensIn > 0`, `tokensOut > 0` |
| `cluster_to_draft_smoke.js` | Creates a cluster row, inserts a draft with all 7 `<h2>` sections |
| Suggestion BR fires | Update an incident's `assignment_group`; within 10s a row appears in `suggestion_log` |
| Form panel renders | Reload incident form; `#kbi_panel` populates with cards (or "no suggestions") |
| KM email sent | Approve any draft; KM group members receive notification |

## Promotion to another instance

Two options.

**Option A: Update Set.** Capture inside the scoped app context. Update Set will include scope artefacts but not Global-scope artefacts (the four BRs on `incident`/`rm_story`, the Client Script, the UI Macro, the Formatter, and the `Capture for KB` UI Action). Apply Global artefacts via a parallel Update Set captured in the Global scope.

**Option B: App Repo.** Publish from Studio. Global artefacts must still be hand-promoted; this is a ServiceNow platform constraint not specific to this project.

## Rollback

Per-component rollback paths:

| Failure mode | Rollback |
|---|---|
| LLM produces low-quality drafts | Set `min_cluster_size` higher (10+); KMs reject any low-quality drafts which dismisses the cluster |
| Daily Gemini cap hit | Property `llm_provider = now_assist` (if licensed), or pause `SJ_weekly_cluster_run` |
| Suggestion panel breaking on form load | Deactivate `CS_incident_suggestions_load`; placeholder still renders inert "Loading..." text |
| Cluster engine producing noise | Property `cluster_solution_name = nonexistent`; engine falls back to keyword grouping at lower volume |
| Full disable | Pause `SJ_weekly_cluster_run`, deactivate the four async Business Rules. All inputs to the system stop; in-flight drafts remain reviewable |
