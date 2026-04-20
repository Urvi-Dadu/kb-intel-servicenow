/**
 * Smoke: LLMConnector
 *
 * Paste into System Definition > Scripts - Background. Confirms:
 *   - API key resolves
 *   - Outbound HTTPS to Gemini works
 *   - JSON enforcement returns parseable JSON
 *   - Token usage is reported
 *
 * Pass criteria: gs.print outputs non-empty text, both token counts > 0.
 */
var llm = new x_1158634_kb_int_0.LLMConnector();
var r = llm.callGemini(
    'Return ONLY valid JSON. Schema: {"title":string,"summary":string,"body_html":string}.',
    'Title and one-sentence summary about the colour blue. body_html should be a single <p> tag.',
    { maxTokens: 300, enforceJson: true }
);

gs.print('--- LLMConnector smoke ---');
gs.print('result: ' + (r ? 'OK' : 'NULL'));
if (r) {
    gs.print('model: ' + r.model);
    gs.print('tokensIn: ' + r.tokensIn);
    gs.print('tokensOut: ' + r.tokensOut);
    gs.print('text (first 400): ' + (r.text || '').substring(0, 400));
} else {
    gs.print('Inspect System Logs > Errors for "LLMConnector:" lines.');
}
