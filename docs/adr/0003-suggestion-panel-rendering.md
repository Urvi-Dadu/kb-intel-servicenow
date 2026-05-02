# ADR-0003: Suggestion Panel Rendering

Status: Accepted
Date: 2026-05-28
Supersedes: Initial Jelly-driven design (W2 of the prototype)

## Context

W2 (resolution suggester) renders a panel on the incident form showing top-N similar past resolutions. The initial design used a UI Macro with server-side Jelly: a `<g:evaluate>` block read `current.sys_id`, queried `x_1158634_kb_int_0_suggestion_log`, and rendered cards via `<j:forEach>`.

That design failed in practice. `current.sys_id` resolved to empty when the macro was authored in the scoped app and rendered as a Formatter on the Global-scope incident form. The Jelly evaluation context did not consistently bind `current` across the scope boundary. `RP.getParameterValue('sys_id')` was unreliable across UI16 / Next Experience / embedded contexts. Hardcoding a sys_id worked, confirming the query and downstream rendering were sound; the failure was the `current` binding.

## Options considered

1. **Move the UI Macro to Global.** Removes the scope-boundary issue. Empirically still produced empty `current` in some Next Experience renders during testing.
2. **Add a Display Business Rule on `incident` writing to `g_scratchpad`, read in a Client Script.** Works, but `g_scratchpad` is opaque to anyone reading the project later and couples server-side rendering to a serialised side channel.
3. **Static UI Macro placeholder + onLoad Client Script + AJAX Script Include.** Split rendering from data fetch. Macro becomes inert. Client Script obtains sys_id from `g_form.getUniqueValue()` (reliable in any UI variant) and pulls data via `GlideAjax`.

## Decision

Option 3. Three components, each with a single responsibility:

- **`kb_intel_suggestion_panel`** UI Macro: emits `<div id="kbi_panel">Loading...</div>`. No Jelly evaluation, no `current` reference. Cannot fail across scopes because it has no dynamic behaviour.
- **`SuggestionAjax`** Script Include extends `AbstractAjaxProcessor`. Methods: `getSuggestions`, `refreshSuggestions`. Returns JSON.
- **`CS_incident_suggestions_load`** Client Script (onLoad on `incident`): reads `g_form.getUniqueValue()`, calls `SuggestionAjax`, renders HTML into the placeholder. Falls back to dynamic injection if the placeholder is absent.

## Rationale

- `g_form.getUniqueValue()` is the only API that is reliable across UI16, Next Experience, Service Portal embedded, and Workspace. Server-side Jelly bindings are not.
- `GlideAjax` is the official client-to-server contract. It crosses scope boundaries by design.
- Separating concerns makes each component testable in isolation: the AJAX endpoint can be hit from the browser console; the renderer can be tested by injecting a fake AJAX response.

## Consequences

Positive:
- Eliminates the entire class of `current`-binding failures.
- Adds a manual "Refresh suggestions" button (uses the same Script Include's second method). Useful when the async assignment-suggest BR hasn't completed by the time the user reloads.
- Browser DevTools become the primary debug surface, which is familiar territory for L2/L3 engineers.

Negative:
- Adds two artefacts compared to the original design (the Client Script and the AJAX Script Include).
- DOM injection in the fallback path (when the Formatter is missing) targets a list of selectors. Brittle to Next Experience UI overhauls. The Formatter path is the supported one; the fallback is a safety net.

## Implementation notes

- `SuggestionAjax` must be flagged `Client callable = true` AND `Accessible from = All application scopes`. Both are easy to miss; deployment docs flag this explicitly.
- The Client Script HTML-escapes all data from the AJAX response before insertion (`escapeHtml` helper). The suggestion log can contain arbitrary text from incident `short_description` and `close_notes`.
- A small debug line near the top of the panel surfaces the server's diagnostic string (`ok (3 suggestions)`, `no log row`, etc.). Comment it out for production via the marker in `CS_incident_suggestions_load.js`.

## Revisit triggers

- ServiceNow ships a Workspace-native suggestion component. At that point, port the rendering layer; the Script Includes can stay.
- The Formatter mechanism is deprecated. Migrate to a Now Experience Component (UI Framework, `@servicenow/ui-component-cli`).
