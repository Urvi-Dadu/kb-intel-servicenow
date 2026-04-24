# Component Design

Pseudocode and contracts for each Script Include. Real JS lives under [../src/](../src/); this document is the design reference.

## Conventions

- Pseudocode uses Python-flavoured syntax for readability. Real implementation is server-side JS via Rhino.
- `GR(table)` denotes `new GlideRecord(table)`. `gr.query(filters)` collapses the `addQuery` / `addNotNullQuery` / `query` triplet.
- `prop(key, default)` denotes `gs.getProperty('x_1158634_kb_int_0.' + key, default)`.

## LLMConnector

Single seam for LLM access. Two implementations share an identical public surface.

### Contract

```
callGemini(systemPrompt: str, userPrompt: str, options: dict) -> Result | None
where
    options = {
        model: str = prop('default_model'),
        maxTokens: int = 4096,
        temperature: float = 0.3,
        enforceJson: bool = True,
    }
    Result = { text: str, model: str, tokensIn: int, tokensOut: int }
```

Method is named `callGemini` for backward compatibility across both implementations; the alternate variant routes to OneExtendUtil but keeps the signature.

### Gemini path

```
function callGemini(systemPrompt, userPrompt, options):
    apiKey = prop('gemini_api_key')
    if not apiKey: log_error('missing key'); return None

    body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
        },
        safetySettings: BLOCK_ONLY_HIGH for all four categories,
    }
    if options.enforceJson:
        body.generationConfig.responseMimeType = 'application/json'
        body.generationConfig.responseSchema = KB_OUTPUT_SCHEMA

    for attempt in 1..3:
        resp = POST(endpoint(options.model), body, header={'x-goog-api-key': apiKey})
        if resp.status == 200: return parse(resp)
        if resp.status == 429:
            sleep(4s * 2^(attempt-1))
            continue
        log_error('HTTP ' + resp.status); return None

    fire_event('x_1158634_kb_int_0.daily_cap_hit')
    return None
```

`KB_OUTPUT_SCHEMA` = `{ title: str, summary: str, body_html: str }`. JSON mode is preferred over post-hoc parsing; the model is constrained server-side at Gemini.

### Now Assist path (alternate)

```
function callNowAssist(systemPrompt, userPrompt, options):
    capId = prop('now_assist_capability_id')
    if not capId: log_error('missing capability id'); return None

    raw = OneExtendUtil.execute({
        executionRequests: [{
            capabilityId: capId,
            payload: { system_prompt: systemPrompt, user_prompt: userPrompt },
        }]
    })

    text = extract_text(raw)   # tries 3 known shapes by release
    usage = extract_usage(raw) # best-effort token counts
    return { text, model: 'now_assist:' + capId, tokensIn, tokensOut }
```

Response shape varies between Yokohama and Washington releases. `extract_text` walks three known structures and logs the raw response when none match. See [ADR-001](adr/0001-llm-provider.md) for selection criteria.

## IncidentClusterEngine

Groups closed incidents by topical similarity. Output: rows in `x_1158634_kb_int_0_cluster`.

### Contract

```
runClustering() -> int  # number of clusters upserted
```

### Pseudocode

```
function runClustering():
    clusters = try_pi() or keyword_fallback()

    upserted = 0
    for label, members in clusters.items():
        if len(members.ids) < prop('min_cluster_size'): continue
        upsert_cluster(label, members)
        upserted += 1
    return upserted

function try_pi():
    solver = PI.getSolution(prop('cluster_solution_name')).findActiveVersion()
    if not solver: return None

    buckets = {}
    for incident in GR('incident').query(
        state in (6,7),
        close_notes not null,
        sys_updated_on >= now - prop('lookback_days') days,
        limit 5000,
    ):
        label = solver.predict([incident])[0].getPrediction()
        if not label: continue
        buckets.setdefault(label, { ids: [], short_descs: [] })
        buckets[label].ids.append(incident.sys_id)
        buckets[label].short_descs.append(incident.short_description)
    return buckets or None

function keyword_fallback():
    STOP = {the, a, an, and, or, is, in, to, of, for, on, with, cannot, cant, not}
    buckets = {}
    for incident in (same query as try_pi):
        tokens = lowercase(short_description) -> strip non-alnum -> split -> drop STOP -> filter len>2
        if len(tokens) < 2: continue
        key = incident.category + '::' + sorted(tokens[0:2]).join('_')
        buckets.setdefault(key, ...).ids.append(incident.sys_id)
    return buckets

function upsert_cluster(label, members):
    row = GR('x_1158634_kb_int_0_cluster').get_or_init(name=label)
    row.summary = members.short_descs[0:3].join(' | ')
    row.member_count = len(members.ids)
    row.last_seen = now
    row.representative_incident = members.ids[0]

    # aggregate metrics
    row.avg_resolution_minutes = mean(resolved_at - opened_at for each in members)
    row.top_assignment_group = mode(assignment_group for each in members)

    if any member has m2m_kb_task link AND row.status != 'has_kb':
        row.linked_kb = that_kb
        row.status = 'has_kb'

    row.save()
```

Fallback path drops accuracy from ~0.7 to ~0.4 cluster purity on the demo dataset. Acceptable because clusters with `member_count >= 5` keyword matches are still typically about the same recurring issue at the L2/L3 granularity. PI is preferred and gated on plugin activation + solution training.

## ResolutionSuggester

Returns top-N similar past resolutions for a given incident. Writes an audit row to `x_1158634_kb_int_0_suggestion_log`.

### Contract

```
suggestForIncident(incidentSysId: str) -> [Suggestion]
where
    Suggestion = {
        incident_sys_id, incident_number,
        short_description, close_notes (<=600 chars),
        score: float in [0,1],
        kb_sys_id: str or '',
    }
```

### Pseudocode

```
function suggestForIncident(sys_id):
    incident = GR('incident').get(sys_id)
    if not incident: return []

    results = try_pi(incident) or keyword_fallback(incident)

    # always log, even empty (zero-result rows feed MTTR-delta analysis)
    GR('x_1158634_kb_int_0_suggestion_log').insert(
        incident=sys_id,
        suggested_kbs=json.dumps(results),
        suggested_at=now,
    )
    return results

function try_pi(incident):
    solver = PI.getSolution(prop('similarity_solution_name')).findActiveVersion()
    if not solver: return None

    sims = solver.predict([incident])[0].getSimilarRecords()  # or getTopPredictions
    out = []
    for sim in sims:
        if sim.sys_id == incident.sys_id: continue
        other = GR('incident').get(sim.sys_id)
        if not other.is_closed_with_notes(): continue
        out.append(format(other, sim.score))
        if len(out) >= prop('suggestion_top_n'): break
    return out

function keyword_fallback(incident):
    tokens = extract_tokens(incident.short_description)  # same as cluster engine
    attempts = [
        { strict: True,  terms: tokens[0:3], score: 0.75 },
        { strict: False, terms: tokens[0:2], score: 0.50 },
        { strict: False, terms: tokens[0:1], score: 0.30 },
    ]
    out, seen = [], { incident.sys_id }
    for a in attempts:
        if not a.terms: continue
        for other in GR('incident').query(
            state in (6,7),
            close_notes not null,
            category == incident.category,
            short_description CONTAINS each term in a.terms,
            order_by sys_updated_on desc,
            limit prop('suggestion_top_n') * 2,
        ):
            if other.sys_id in seen: continue
            seen.add(other.sys_id)
            out.append(format(other, a.score))
            if len(out) >= prop('suggestion_top_n'): return out
    return out

function format(other, score):
    return {
        incident_sys_id: other.sys_id,
        incident_number: other.number,
        short_description: other.short_description,
        close_notes: other.close_notes[0:600],
        score: round(score, 2),
        kb_sys_id: linked_kb(other.sys_id) or '',
    }

function linked_kb(sys_id):
    row = GR('m2m_kb_task').query(task == sys_id, limit 1).first()
    return row.kb_knowledge if row else None
```

## KBDraftBuilder

Assembles prompts, calls LLM, persists draft. Two entry points.

### Contract

```
buildFromCluster(clusterSysId: str) -> str (draftSysId) | None
buildFromDevCapture(captureSysId: str) -> str (draftSysId) | None
```

### Cluster path

```
function buildFromCluster(cluster_sys_id):
    cluster = GR('x_1158634_kb_int_0_cluster').get(cluster_sys_id) or return None
    incidents = fetch_top_incidents(cluster, n=5)
    if not incidents: return None

    sys_prompt = SYSTEM_PROMPT_CLUSTER     # see prompts.md P1
    user_prompt = USER_PROMPT_CLUSTER(cluster, incidents)  # P2

    result = LLMConnector().callGemini(sys_prompt, user_prompt, { maxTokens: 3000, enforceJson: True })
    if not result: return None

    parsed = parse_article(result.text)   # JSON.parse with brace-fallback
    draft = GR('x_1158634_kb_int_0_kb_draft').insert(
        title=parsed.title,
        summary=parsed.summary,
        body=parsed.body,
        source_type='incident_cluster',
        source_cluster=cluster_sys_id,
        review_state='draft',
        llm_model_used=result.model,
        llm_tokens_in=result.tokensIn,
        llm_tokens_out=result.tokensOut,
        generated_at=now,
    )

    cluster.status = 'draft_pending'; cluster.save()
    fire_event('x_1158634_kb_int_0.draft.created', draft.sys_id, 'cluster')
    return draft.sys_id
```

### Capture path

```
function buildFromDevCapture(capture_sys_id):
    capture = GR('x_1158634_kb_int_0_dev_capture').get(capture_sys_id) or return None

    commits = []
    if capture.source_type == 'story' and capture.source_story:
        commits = DevOpsContextFetcher().fetchForStory(capture.source_story)

    sys_prompt = SYSTEM_PROMPT_DEV_CAPTURE  # P3
    user_prompt = USER_PROMPT_DEV_CAPTURE(capture, commits)  # P4

    options = { maxTokens: 4096, enforceJson: True }
    if capture.source_type == 'story':
        options.model = prop('story_model')   # gemini-2.5-pro

    result = LLMConnector().callGemini(sys_prompt, user_prompt, options)
    if not result: return None

    parsed = parse_article(result.text)
    draft = GR('x_1158634_kb_int_0_kb_draft').insert(
        title=parsed.title, summary=parsed.summary, body=parsed.body,
        source_type='story' if capture.source_type=='story' else 'dev_capture',
        source_dev_capture=capture_sys_id,
        source_story=capture.source_story or null,
        source_incident=capture.source_incident or null,
        resolver=capture.developer,
        review_state='draft',
        llm_model_used=result.model,
        llm_tokens_in=result.tokensIn, llm_tokens_out=result.tokensOut,
        generated_at=now,
    )

    capture.generated_draft = draft.sys_id
    capture.state = 'processed'
    capture.save()

    fire_event('x_1158634_kb_int_0.draft.created', draft.sys_id, capture.source_type)
    return draft.sys_id
```

`fetch_top_incidents` uses the cluster's representative plus a keyword query rather than re-running PI clustering (which would require persisting cluster membership in a many-to-many table). This is an explicit accuracy/complexity trade-off documented in [ADR-004](adr/0004-clustering-and-similarity-fallback.md).

## DevOpsContextFetcher

Defensive reader for ServiceNow DevOps commit data. Returns `[]` on any failure path including plugin-absent.

### Contract

```
fetchForStory(storySysId: str) -> [Commit]
where
    Commit = { hash: str, message: str, author: str, files: str }
```

### Pseudocode

```
function fetchForStory(story_sys_id):
    if not story_sys_id: return []

    for table in ['sn_devops_commit', 'sn_devops_change_artifact']:
        commits = try_table(table, story_sys_id)
        if commits: return commits
    return []

function try_table(table, story_sys_id):
    gr = GR(table)
    if not gr.isValid(): return []   # plugin not active

    for fk in ['story', 'rm_story', 'task', 'change_request']:
        if not gr.isValidField(fk): continue
        results = GR(table).query(fk == story_sys_id, limit 20).map(extract_commit)
        if results: return results
    return []

function extract_commit(gr):
    # field names vary by release; pick first non-empty
    return {
        hash: pick_first(gr, ['commit_id','hash','short_id','sha','revision'])[0:40],
        message: pick_first(gr, ['commit_message','message','short_description','description'])[0:500],
        author: pick_first_display(gr, ['author','committer','developer']),
        files: pick_first(gr, ['changed_files','files','diff_files','modified_files'])[0:1000],
    }
```

## SuggestionAjax

Client-callable Script Include extending `AbstractAjaxProcessor`. Bridges the onLoad Client Script to `ResolutionSuggester`.

### Contract

Two AJAX-exposed methods. Parameters arrive via `this.getParameter(name)`. Responses are JSON strings.

```
getSuggestions()       -> { incident_id, suggestions: [], debug: str }
refreshSuggestions()   -> same shape; forces a ResolutionSuggester re-run first
```

### Pseudocode

```
function getSuggestions():
    sys_id = this.getParameter('sysparm_incident_id')
    if not sys_id: return json({ suggestions: [], debug: 'no id' })

    row = GR('x_1158634_kb_int_0_suggestion_log').query(incident == sys_id, order_by suggested_at desc, limit 1).first()
    if not row: return json({ suggestions: [], debug: 'no log row' })

    return json({ suggestions: json.parse(row.suggested_kbs), debug: 'ok' })

function refreshSuggestions():
    sys_id = this.getParameter('sysparm_incident_id')
    if not sys_id: return json({ suggestions: [], debug: 'no id' })
    ResolutionSuggester().suggestForIncident(sys_id)
    return getSuggestions()
```

Script Include must be marked `Client callable = true` and `Accessible from = All application scopes`. The Client Script lives in Global on the `incident` table; this is the bridge.
