# Data Model

Four custom tables in scope `x_1158634_kb_int_0`. Schemas below; ACLs at the end.

## `x_1158634_kb_int_0_cluster`

Label: Incident Cluster. Holds the output of `IncidentClusterEngine`.

| Column | Type | Notes |
|---|---|---|
| `name` | string(100) | Unique; PI cluster label or `<category>::<token1>_<token2>` keyword key |
| `summary` | string(500) | First three member short descriptions, pipe-joined |
| `representative_incident` | reference -> `incident` | First seen; used by `KBDraftBuilder._fetchTopIncidents` |
| `member_count` | integer | Population size at last clustering pass |
| `last_seen` | datetime | Last clustering pass that included this cluster |
| `linked_kb` | reference -> `kb_knowledge` | Populated when any member has an `m2m_kb_task` link, or on draft publish |
| `status` | choice | `open` \| `has_kb` \| `dismissed` \| `draft_pending` |
| `avg_resolution_minutes` | integer | (resolved_at - opened_at) averaged over members |
| `top_assignment_group` | reference -> `sys_user_group` | Modal assignment group across members |

State machine:
```
open --[member_count >= 5, no draft]--> draft_pending  (set by KBDraftBuilder)
open --[any member has linked KB]----> has_kb         (set by IncidentClusterEngine)
draft_pending --[draft approved]------> has_kb
draft_pending --[draft rejected]------> dismissed
```

## `x_1158634_kb_int_0_dev_capture`

Label: Developer Capture. Structured input collected from resolver or story owner.

| Column | Type | Notes |
|---|---|---|
| `source_type` | choice | `story` \| `incident` \| `problem` |
| `source_story` | reference -> `rm_story` | When `source_type=story` |
| `source_incident` | reference -> `incident` | When `source_type=incident` |
| `source_problem` | reference -> `problem` | Reserved |
| `developer` | reference -> `sys_user` | Attribution |
| `problem_brief` | string(1000) | Pre-filled from source `short_description` |
| `resolution_brief` | string(2000) | Author input; primary LLM signal |
| `root_cause` | string(1000) | Optional but recommended |
| `workflow_changed` | true/false | Toggle; gates `workflow_details` in UI Policy |
| `workflow_details` | string(2000) | Workflow name, activity, change |
| `scripts_changed` | true/false | Toggle |
| `script_details` | string(4000) | Script name, function, before/after where available |
| `configs_changed` | true/false | Toggle |
| `config_details` | string(2000) | sys_property / ACL / table / field |
| `validation_steps` | string(2000) | How the fix was verified |
| `related_items` | string(2000) | Tickets, commits, design refs |
| `generated_draft` | reference -> `x_1158634_kb_int_0_kb_draft` | Populated on successful generation |
| `state` | choice | `draft` \| `submitted` \| `processed` \| `cancelled` |

Boolean toggles drive a UI Policy hiding their detail strings when false. Reduces noise in the user prompt assembled by `KBDraftBuilder`.

## `x_1158634_kb_int_0_kb_draft`

Label: KB Draft. The staging area between LLM output and `kb_knowledge`.

| Column | Type | Notes |
|---|---|---|
| `title` | string(200) | From LLM |
| `summary` | string(1000) | From LLM, used as KB search summary |
| `body` | HTML (large) | KB body; constrained to a tag whitelist by system prompt |
| `source_type` | choice | `incident_cluster` \| `story` \| `dev_capture` |
| `source_cluster` | reference -> `x_1158634_kb_int_0_cluster` | When sourced from W1 |
| `source_story` | reference -> `rm_story` | When sourced via story closure |
| `source_incident` | reference -> `incident` | When sourced via incident capture |
| `source_dev_capture` | reference -> `x_1158634_kb_int_0_dev_capture` | Back-link to the capture |
| `resolver` | reference -> `sys_user` | Captured for KB attribution |
| `review_state` | choice | `draft` \| `in_review` \| `approved` \| `rejected` \| `published` |
| `published_kb` | reference -> `kb_knowledge` | Set by `Approve & Publish` UI Action |
| `reviewer` | reference -> `sys_user` | KM who actioned the draft |
| `review_notes` | string(2000) | Reviewer rationale |
| `llm_model_used` | string(60) | e.g. `gemini-2.5-flash`, `now_assist:<capability_sys_id>` |
| `llm_tokens_in` | integer | Cost basis |
| `llm_tokens_out` | integer | Cost basis |
| `generated_at` | datetime | Set by KBDraftBuilder |

State machine:
```
draft --> in_review --> approved --> published
                    \-> rejected
```

`in_review` and `approved` are transient. Production usage flows `draft -> published` or `draft -> rejected` in practice; the intermediate states exist for future workflow extensions (multi-stage review, automated style check).

## `x_1158634_kb_int_0_suggestion_log`

Label: Suggestion Log. Audit row written on every `ResolutionSuggester` invocation.

| Column | Type | Notes |
|---|---|---|
| `incident` | reference -> `incident` | Subject |
| `suggested_kbs` | string(8000) | JSON array; one element per ranked suggestion |
| `suggested_at` | datetime | Suggester invocation time |
| `accepted_kb` | reference -> `kb_knowledge` | Set if resolver clicks through (optional client-side instrumentation) |
| `resolution_minutes` | integer | Filled by `BR_suggestion_log_close` |
| `resolver` | reference -> `sys_user` | Filled by `BR_suggestion_log_close` |

`suggested_kbs` JSON element shape:

```json
{
  "incident_sys_id": "32-char hex",
  "incident_number": "INC0010234",
  "short_description": "...",
  "close_notes": "first 600 chars",
  "score": 0.87,
  "kb_sys_id": "32-char hex or empty"
}
```

## System properties

All in scope `x_1158634_kb_int_0`.

| Property | Type | Default |
|---|---|---|
| `gemini_api_key` | password 2 | (set on deploy) |
| `default_model` | string | `gemini-2.5-flash` |
| `story_model` | string | `gemini-2.5-pro` |
| `cluster_solution_name` | string | `incident_cluster_l2l3` |
| `similarity_solution_name` | string | `incident_similarity_l2l3` |
| `min_cluster_size` | integer | `5` |
| `lookback_days` | integer | `365` |
| `suggestion_top_n` | integer | `3` |
| `target_kb_base` | string | (sys_id of `kb_knowledge_base`) |
| `knowledge_manager_group` | string | (sys_id of `sys_user_group`) |
| `llm_provider` | string | `gemini` (alternate: `now_assist`) |
| `now_assist_capability_id` | string | (set if `llm_provider=now_assist`) |

## ACL summary

| Table | Operation | Roles |
|---|---|---|
| `cluster` | read | `itil`, `knowledge_manager` |
| `cluster` | write | `knowledge_manager`, `admin` |
| `dev_capture` | read | `itil` |
| `dev_capture` | write | `itil` (own records via `developer = gs.getUserID()`) |
| `kb_draft` | read | `knowledge_manager`, `admin` |
| `kb_draft` | write | `knowledge_manager`, `admin` |
| `suggestion_log` | read | `itil` |
| `suggestion_log` | write | `admin` (script-only writes via ResolutionSuggester) |

Field-level ACLs not enforced; table-level sufficient given internal-facing scope.
