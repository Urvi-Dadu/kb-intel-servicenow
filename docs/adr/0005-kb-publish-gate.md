# ADR-0005: Mandatory KB Publish Gate

Status: Accepted
Date: 2026-05-11

## Context

Every LLM-generated draft passes through `x_1158634_kb_int_0_kb_draft` and requires a Knowledge Manager to invoke `Approve & Publish` before becoming a `kb_knowledge` record. Auto-publish was considered and rejected.

## Decision

No auto-publish path. Period. Every draft, regardless of source, requires explicit KM approval via UI Action. The Approve action creates the `kb_knowledge`, links back, and updates the source cluster status. The Reject action dismisses the source cluster so the scheduled job does not regenerate the same draft.

## Rationale

LLM output on technical KB content has empirically observed ~3% rate of identifier hallucination on this project's demo dataset. Failure modes:

- Wrong Business Rule name in the resolution walkthrough.
- Inferred sys_property name that does not exist.
- Confidence-inflected text on a fix that worked on one incident but is not the canonical resolution.

A KB targeting L2/L3 engineers that contains a wrong script name actively harms the user: they spend 20 minutes looking for a Business Rule that isn't there, then lose trust in every other KB in the corpus. A 3% miss rate is unacceptable for unsupervised publication.

A KM review at ~2 minutes per draft yields effectively zero published-error rate.

## Options considered and rejected

- **Auto-publish with periodic human audit.** Inverts the problem: errors are in production before discovery, by which time L2/L3 engineers have already encountered them.
- **Auto-publish into a "Draft" `workflow_state` and require manual promotion.** Functionally identical to current design but couples this project to `kb_knowledge.workflow_state` semantics. Rejected to keep the gate as an explicit project artefact.
- **LLM-on-LLM verification (use a second model to grade the first).** Tested; correlation with KM judgement was 0.6. Not strong enough to replace human review. May revisit when frontier models improve.

## Consequences

Positive:
- Zero confidence cost on published KBs. Engineers trust the corpus.
- KM has full edit capability on the draft body before publishing. The LLM output is a strong starting point, not a final artefact.
- Rejection signal is captured (`status = dismissed` on the cluster) and feeds back into batch behaviour.

Negative:
- Throughput is bounded by KM capacity. At ~2 min per draft, one KM handles ~150 drafts/day. Sustainable for our projected volume but a real constraint at scale.
- Latency: cluster batch runs Sunday night; KM review happens Monday; KB visible to engineers Monday afternoon. Three-day cycle between recurring issue detection and KB availability. Acceptable for an L2/L3 audience where most issues recur on a weekly+ cadence.

## Implementation notes

- `Approve & Publish` UI Action is gated by `knowledge_manager` or `admin` role.
- Approve action sets `kb_knowledge.workflow_state = 'published'` directly. No KB Article Lifecycle workflow involvement. If the deployment uses Knowledge Workflow (where articles transition through Draft / Review / Published), set `workflow_state = 'draft'` on insert instead and let the existing KB workflow take over.
- Reject action sets `cluster.status = 'dismissed'`. Manually flipping back to `open` will cause the scheduled job to regenerate; this is a deliberate escape hatch for "rejected because of prompt issue, retry after prompt tuning".

## Revisit triggers

- LLM identifier-hallucination rate drops below 0.1% on this corpus. (Test by running a fresh batch on holdout incidents and grading.)
- KM throughput becomes a documented bottleneck. Mitigation: assign categories to specific KMs; do not relax the gate.
