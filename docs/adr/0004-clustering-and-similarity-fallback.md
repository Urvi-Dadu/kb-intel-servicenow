# ADR-0004: Clustering and Similarity Fallback

Status: Accepted
Date: 2026-05-18

## Context

`IncidentClusterEngine` and `ResolutionSuggester` rely on Predictive Intelligence (`com.glide.platform_ml`). Two constraints work against PI as a hard requirement:

1. PI plugin is not active on every target instance (PDI for development, smaller deployments).
2. Solution training takes 10 minutes to 2 hours and must be re-run when input data drifts significantly. During training, the active solution returns stale predictions or fails.

The system must remain functional in both cases.

## Decision

Both engines implement the same two-path pattern:

```
function predict(input):
    result = try_pi(input)
    if result is None: result = keyword_fallback(input)
    return result
```

The `try_pi` path returns `None` (not an empty array) on any failure, signalling "PI did not run". The fallback then takes over.

Fallback algorithm: token-frequency grouping for clustering, token-overlap querying for similarity. Stop words removed; same token extraction across both engines for consistency.

## Rationale

- **PI is preferred when available.** Quality is materially better: ~0.7 cluster purity vs ~0.4 on the demo dataset; ~0.8 vs ~0.6 top-3 hit rate on similarity.
- **Fallback is acceptable.** L2/L3 use cases tolerate lower precision because the human consumes the output: a Knowledge Manager reviewing a cluster KB, or an engineer scanning three suggestions. Both reject false positives quickly.
- **No third party required.** The fallback is pure GlideRecord; no external embeddings API, no MID Server.

## Alternatives rejected

- **Hard require PI.** Blocks the value proposition on a plugin that isn't universally present.
- **Use an external embedding API (Gemini text embeddings, OpenAI ada).** Adds another network dependency and rate-limit surface. Reserved for a future ADR if fallback quality is found insufficient under real workload.
- **Build local TF-IDF in JavaScript.** Implemented in two prototype branches and rejected. Per-query cost in Rhino is acceptable; index maintenance across millions of rows is not.

## Consequences

Positive:
- System ships with no licensing dependencies beyond Knowledge Management Advanced.
- PI can be added later as a quality upgrade without code changes (engine auto-detects).

Negative:
- Documentation must explain two engines per component, increasing surface area.
- The cluster fetch in `KBDraftBuilder._fetchTopIncidents` re-queries by keyword rather than persisting cluster membership in an m2m table. If PI re-train shifts cluster boundaries between batch runs, draft inputs may not exactly match the cluster on disk. The drift is bounded (typical cluster keyword query overlap > 90%) and acceptable for our use case.

## Implementation notes

Token extraction (shared between engines):

```
STOP = {the, a, an, and, or, is, in, to, of, for, on, with, cannot, cant, not}
tokens = lowercase(text)
       -> replace [^a-z0-9 ] with space
       -> split on whitespace
       -> filter len > 2 AND token not in STOP
```

Clustering bucket key: `<category>::<sorted_tokens[0:2].join('_')>`. Sorting the two tokens means "outlook vpn" and "vpn outlook" land in the same bucket.

Similarity scoring (fallback):
- 0.75 if all three top keywords match
- 0.50 if top two match
- 0.30 if only the top one matches

These are not probabilities; they are display scores. Users understand the ordering, not the magnitude.

## Revisit triggers

- Fallback hit rate drops below 50% on representative incidents after instance gets > 5000 closed incidents (the diversity threshold where keyword overlap stops being precise).
- A new ServiceNow release exposes built-in text embeddings server-side without paid licensing.
- Operations data shows users ignoring fallback suggestions while accepting PI suggestions. The signal would justify hard-requiring PI for a particular customer's deployment.
