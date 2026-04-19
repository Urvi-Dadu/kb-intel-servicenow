# ADR-0001: LLM Provider Selection

Status: Accepted
Date: 2026-05-13

## Context

The cluster-to-KB and capture-to-KB pipelines require generative text production. Predictive Intelligence covers classification, similarity, and clustering, but does not generate prose. An LLM is required.

## Options considered

1. **ServiceNow Now Assist (`sn_now_assist_itsm` + `sn_one_extend`).** Bundled with Now Assist licensing. Server-side call via `OneExtendUtil`. Data stays inside the instance.
2. **Google Gemini API (`generativelanguage.googleapis.com`).** External REST. Free tier with documented usage rights; paid tier with no-training guarantee.
3. **Azure OpenAI via IntegrationHub spoke.** External REST. Requires IntegrationHub Pro+ licensing; pricing model differs.
4. **Self-hosted (Llama / Mistral via MID Server proxy).** Operational overhead too high for the value delivered.

## Decision

Use Google Gemini as the default. Architect the LLM access layer (`LLMConnector` Script Include) such that swapping providers is a single-file replacement, not a project-wide refactor. Ship a Now Assist variant (`LLMConnector.now_assist.js`) that matches the same public surface; activate via the `llm_provider` system property.

## Rationale

- **Now Assist licensing is non-trivial.** The target instance (PDI for initial development) does not have it. Production deployment may or may not; the project must be functional without.
- **Gemini free tier is sufficient.** 1,500 requests/day on `gemini-2.5-flash` exceeds projected volume (~160 requests/month). Story KBs use `gemini-2.5-pro` (100/day) which gates by user behaviour, not batch.
- **Native JSON output mode** (`responseMimeType: 'application/json'` with `responseSchema`) eliminates output-parsing fragility. The Now Assist OneExtendUtil API does not consistently expose this; parser fallback added.
- **One-seam abstraction.** All LLM calls flow through `LLMConnector.callGemini`. The Now Assist variant exposes the same method name. Swap is a paste-and-save, no caller changes.

## Consequences

Positive:
- Zero licensing dependency for development and small-team deployments.
- Trivial provider swap path on lift-and-shift to instances with Now Assist.
- No MID Server required; instance reaches Gemini directly over HTTPS.

Negative:
- **Free-tier data exposure.** Per Google AI Studio terms, free-tier prompts and responses may be used to improve Google's models. Documented in [operations.md § Production checklist](../operations.md#production-checklist) as a blocker before processing customer data. Paid tier or Now Assist required to lift.
- Network dependency on `generativelanguage.googleapis.com`. Outbound HTTPS must be permitted from the instance; hardened instances may require explicit allowlisting.
- Response-shape drift across Gemini API versions. Mitigation: pinned to `v1beta`, version field in property if upstream changes.

## Implementation notes

- `LLMConnector.callGemini` enforces JSON via `responseSchema` matching `{ title, summary, body_html }`.
- 429 backoff: 4s, 8s, 16s, then `gs.eventQueue('x_1158634_kb_int_0.daily_cap_hit', ...)` and return null.
- `safetySettings` set to `BLOCK_ONLY_HIGH` across all four harm categories; default `BLOCK_MEDIUM_AND_ABOVE` blocks legitimate credential / SAML / token resolution content with `finishReason = SAFETY`.

## Revisit triggers

- If Gemini free tier terms change to no-training-by-default, this ADR becomes moot.
- If Now Assist licensing is acquired for the target environment, switch `llm_provider` and revisit which model handles which pipeline.
- If output quality on `gemini-2.5-pro` for story KBs becomes the bottleneck, evaluate Anthropic Claude (Opus or Sonnet) via Bedrock through IntegrationHub.
