/**
 * LLMConnector
 *
 * Single seam to Google Gemini `generateContent`. JSON output enforced via
 * `responseSchema`. Exponential backoff on HTTP 429. Surfaces
 * `x_1158634_kb_int_0.daily_cap_hit` event when retries exhausted.
 *
 * Scope: x_1158634_kb_int_0
 * Accessible from: All application scopes
 */
var LLMConnector = Class.create();
LLMConnector.prototype = {

    initialize: function() {
        this.apiKeyProperty = 'x_1158634_kb_int_0.gemini_api_key';
        this.endpointBase = 'https://generativelanguage.googleapis.com/v1beta/models/';
        this.defaultModel = gs.getProperty('x_1158634_kb_int_0.default_model', 'gemini-2.5-flash');
    },

    /**
     * @param {string} systemPrompt
     * @param {string} userPrompt
     * @param {{model?:string, maxTokens?:number, temperature?:number, enforceJson?:boolean}} [options]
     * @returns {{text:string, model:string, tokensIn:number, tokensOut:number}|null}
     */
    callGemini: function(systemPrompt, userPrompt, options) {
        options = options || {};
        var model = options.model || this.defaultModel;
        var maxTokens = options.maxTokens || 4096;
        var temperature = (typeof options.temperature === 'number') ? options.temperature : 0.3;
        var enforceJson = options.enforceJson !== false;

        var apiKey = gs.getProperty(this.apiKeyProperty);
        if (!apiKey) {
            gs.error('LLMConnector: missing API key ' + this.apiKeyProperty);
            return null;
        }

        var generationConfig = { temperature: temperature, maxOutputTokens: maxTokens };
        if (enforceJson) {
            generationConfig.responseMimeType = 'application/json';
            generationConfig.responseSchema = {
                type: 'object',
                properties: {
                    title:     { type: 'string' },
                    summary:   { type: 'string' },
                    body_html: { type: 'string' }
                },
                required: ['title', 'summary', 'body_html']
            };
        }

        var body = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: generationConfig,
            safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
            ]
        };

        var endpoint = this.endpointBase + model + ':generateContent';
        var backoff = 4000;

        for (var attempt = 0; attempt < 3; attempt++) {
            var resp = this._send(endpoint, apiKey, body);
            if (!resp) return null;

            if (resp.status === 200) return this._parse(resp.body, model);
            if (resp.status === 429) {
                gs.sleep(backoff);
                backoff *= 2;
                continue;
            }
            gs.error('LLMConnector: HTTP ' + resp.status + ' ' + resp.body);
            return null;
        }

        gs.eventQueue('x_1158634_kb_int_0.daily_cap_hit', null, model, 'LLMConnector');
        return null;
    },

    _send: function(endpoint, apiKey, body) {
        try {
            var rm = new sn_ws.RESTMessageV2();
            rm.setEndpoint(endpoint);
            rm.setHttpMethod('POST');
            rm.setRequestHeader('x-goog-api-key', apiKey);
            rm.setRequestHeader('Content-Type', 'application/json');
            rm.setRequestBody(JSON.stringify(body));
            rm.setHttpTimeout(60000);
            var r = rm.execute();
            return { status: r.getStatusCode(), body: r.getBody() };
        } catch (e) {
            gs.error('LLMConnector: REST exception ' + e.message);
            return null;
        }
    },

    _parse: function(bodyText, model) {
        var parsed;
        try { parsed = JSON.parse(bodyText); }
        catch (e) { gs.error('LLMConnector: non-JSON response'); return null; }

        if (!parsed.candidates || !parsed.candidates.length) return null;
        var cand = parsed.candidates[0];
        if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
            gs.error('LLMConnector: finishReason=' + cand.finishReason);
            return null;
        }
        if (!cand.content || !cand.content.parts) return null;

        var text = cand.content.parts.map(function(p) { return p.text || ''; }).join('');
        var usage = parsed.usageMetadata || {};

        return {
            text: text,
            model: model,
            tokensIn:  usage.promptTokenCount     || 0,
            tokensOut: usage.candidatesTokenCount || 0
        };
    },

    type: 'LLMConnector'
};
