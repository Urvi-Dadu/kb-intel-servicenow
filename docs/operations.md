# Operations

## Observability

| Signal | Source | Purpose |
|---|---|---|
| `llm_tokens_in` + `llm_tokens_out` per draft | `x_1158634_kb_int_0_kb_draft` | Cost tracking |
| `llm_model_used` per draft | same | Track which model was actually used (Flash vs Pro vs Now Assist) |
| `suggested_at` and `resolution_minutes` | `x_1158634_kb_int_0_suggestion_log` | MTTR-delta analysis |
| `accepted_kb` | same (filled by optional client instrumentation) | Suggestion uptake rate |
| `status` distribution on clusters | `x_1158634_kb_int_0_cluster` | Coverage of recurring issues |
| `review_state` distribution on drafts | `x_1158634_kb_int_0_kb_draft` | Review backlog |
| `x_1158634_kb_int_0.daily_cap_hit` event | Event Registry | Rate-limit exhaustion alert |

## PA Indicators

Recommended definitions when Performance Analytics is licensed. All daily collection frequency.

| Indicator | Aggregate | Filter | Purpose |
|---|---|---|---|
| KB drafts generated | count | `x_1158634_kb_int_0_kb_draft` | Top-of-funnel volume |
| KB drafts published | count | `review_state = published` | Output volume |
| Average review latency | avg(now - generated_at) | `review_state = draft` | Backlog freshness |
| Tokens consumed / week | sum(llm_tokens_in + llm_tokens_out) | per `llm_model_used` | Cost |
| Suggestions surfaced | count | `x_1158634_kb_int_0_suggestion_log` per day | Coverage |
| MTTR with vs without suggestion | avg(resolution_minutes) grouped by `accepted_kb` empty/not | Effect size |

Without PA, basic Reports against the same tables produce the same data at lower fidelity.

## Rate limits and back-pressure

Gemini free-tier ceilings as of Q2 2026 (verify against `https://ai.google.dev/pricing`):

| Model | RPM | TPM | RPD |
|---|---|---|---|
| `gemini-2.5-flash` | 15 | 1,000,000 | 1,500 |
| `gemini-2.5-pro` | 5 | 250,000 | 100 |
| `gemini-2.0-flash` | 15 | 1,000,000 | 1,500 |

`LLMConnector` retries on HTTP 429 with exponential backoff (4s, 8s, 16s) then surfaces `x_1158634_kb_int_0.daily_cap_hit` and returns null. `SJ_weekly_cluster_run` inserts a 5s sleep between LLM calls; this caps batch throughput at 12 calls per minute and stays inside the 15 RPM ceiling.

The story-closure path uses `gemini-2.5-pro`. Worst-case daily volume: one capture per closed story. If sustained closure rate exceeds 100/day, set `story_model = gemini-2.5-flash` to escape the lower per-day cap. Quality drop on code-heavy captures is observable but tolerable.

## Cost envelope

Free-tier sufficient for the workloads below. Paid tier pricing (`gemini-2.5-flash` at $0.30/1M input + $2.50/1M output as of Q2 2026) shown for capacity planning:

| Workload | Calls/month | Avg tokens in | Avg tokens out | Cost (paid) |
|---|---|---|---|---|
| Weekly cluster batch (20 drafts) | ~80 | 2,500 | 1,500 | $0.36 |
| Story captures (30/month) | 30 | 3,000 | 2,500 | $0.21 |
| Incident captures (50/month) | 50 | 2,500 | 2,500 | $0.35 |
| Total | ~160 | | | < $1 / month |

## Runbook

| Symptom | First check | Likely cause | Mitigation |
|---|---|---|---|
| Drafts stop appearing | `SJ_weekly_cluster_run` last run status | Job paused or all clusters already drafted | Resume; confirm via cluster table |
| Drafts have empty `body` | LLM finishReason in logs | `SAFETY` block on credential-mentioning incidents | Already lowered to `BLOCK_ONLY_HIGH`; consider `BLOCK_NONE` on internal-only instances |
| Suggestion panel never populates | Browser console (F12) | Client Script inactive or SuggestionAjax not client-callable | Toggle `Client callable` on Script Include; confirm Script Include `Accessible from = All application scopes` |
| KM never receives email | Group member emails | Empty email field, or no Email Outbound configuration on instance | Populate emails; check `glide.email.outbound.enabled` |
| Suggestion log row never written | BR async queue (sysauto_script) | Async queue backed up, or BR condition not matched | Verify `assignment_group changes` evaluates true; check `glide.scheduler` health |
| Gemini cap hit during backfill | `x_1158634_kb_int_0.daily_cap_hit` event count | Daily request quota exceeded | Stagger backfill across multiple days; reduce `min_cluster_size` to limit volume |
| LLM tokens spiking | `llm_tokens_in` percentile per model | Source incidents have unusually long `description` or `close_notes` | Tighten truncation in `_incidentToObj` (currently 800 / 1500 chars) |

## Production checklist

Items intentionally deferred during initial development. Address before production rollout.

- [ ] Move from Gemini free tier to paid (no training on prompts). Free tier may use prompts to improve Google's models.
- [ ] Stand up a non-prod Knowledge Manager group for review during initial weeks; promote to a single prod group only after sign-off.
- [ ] Add Now Assist (or equivalent SaaS guard) if processing data subject to data-residency constraints. See [ADR-001](adr/0001-llm-provider.md).
- [ ] Enable PA indicators above; build dashboard for KM and L2/L3 leads.
- [ ] Document the `Capture for KB` UX expectation in your team handbook (target: < 5 min per capture).
- [ ] Decide on a content-quality SLA for drafts ("approve or reject within N business days"); enforce via PA alert on `review_state = draft AND generated_at > N days ago`.
- [ ] Add monitoring on `x_1158634_kb_int_0.daily_cap_hit` event (e.g., Slack webhook via REST Message).
- [ ] Smoke-test in non-prod after each ServiceNow platform upgrade (PI APIs and OneExtendUtil response shape have changed between releases).
- [ ] If suggestion panel uptake is low after 2 weeks, run a brief user study; common cause is placement below the fold on the incident form.

## Known limitations

- Cluster membership is reconstructed by keyword from the cluster summary, not persisted. Drafts after PI re-train can pick up incidents not in the original cluster. Acceptable trade-off; see [ADR-004](adr/0004-clustering-and-similarity-fallback.md).
- `m2m_kb_task` is used to detect "this cluster already has a KB". If your team uses a different linkage (e.g., direct `kb_knowledge` reference field on `incident`), patch `IncidentClusterEngine._findLinkedKb`.
- Now Assist alternate connector's `_extractText` walks three known response shapes. Future ServiceNow releases may introduce a fourth; log raw response on first failure and extend the function.
- Client Script DOM injection (when the Formatter is missing from form layout) targets a list of selectors. Next Experience UI changes may invalidate this list; the formatter path is the supported one.
