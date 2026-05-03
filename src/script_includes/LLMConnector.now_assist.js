/**
 * LLMConnector (Now Assist variant)
 *
 * Drop-in replacement. Same class name and method signature; routes through
 * `sn_one_extend_util.OneExtendUtil.execute` when
 * `x_1158634_kb_int_0.llm_provider = 'now_assist'`. Falls back to the Gemini
 * REST path for any other provider value, so a property flip reverses the
 * switch without re-pasting.
 *
 * Scope: x_1158634_kb_int_0
 * Accessible from: All application scopes
 * Requires: sn_one_extend, sn_now_assist_skillkit, published Capability
 */
var LLMConnector = Class.create();
LLMConnector.prototype = {

    initialize: function() {
        this.provider = gs.getProperty('x_1158634_kb_int_0.llm_provider', 'gemini');
        this.capabilityId = gs.getProperty('x_1158634_kb_int_0.now_assist_capability_id', '');
        this.defaultModel = gs.getProperty('x_1158634_kb_int_0.default_model', 'gemini-2.5-flash');
        this.apiKeyProperty = 'x_1158634_kb_int_0.gemini_api_key';
        this.endpointBase = 'https://generativelanguage.googleapis.com/v1beta/models/';
    },

    callGemini: function(systemPrompt, userPrompt, options) {
        options = options || {};
        return (this.provider === 'now_assist')
            ? this._callNowAssist(systemPrompt, userPrompt, options)
            : this._callGemini(systemPrompt, userPrompt, options);
    },

    _callNowAssist: function(systemPrompt, userPrompt, options) {
        if (!this.capabilityId) {
            gs.error('LLMConnector: now_assist_capability_id not set');
            return null;
        }

        var raw;
        try {
            raw = sn_one_extend_util.OneExtendUtil.execute({
                executionRequests: [{
                    capabilityId: this.capabilityId,
                    payload: { system_prompt: systemPrompt, user_prompt: userPrompt }
                }]
            });
        } catch (e) {
            gs.error('LLMConnector: OneExtend exception ' + e.message);
            return null;
        }

        if (!raw) { gs.error('LLMConnector: OneExtend returned null'); return null; }

        var text = this._extractText(raw);
        if (!text) {
            var rawJson;
            try { rawJson = (typeof raw === 'string') ? raw : JSON.stringify(raw); }
            catch (e) { rawJson = '[unserializable]'; }
            gs.error('LLMConnector: extract failed. Raw: ' + rawJson.substring(0, 2000));
            return null;
        }

        var usage = this._extractUsage(raw);
        return {
            text: text,
            model: 'now_assist:' + this.capabilityId,
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut
        };
    },

    _extractText: function(raw) {
        if (raw.capabilities && this.capabilityId && raw.capabilities[this.capabilityId]) {
            var c = raw.capabilities[this.capabilityId];
            if (c.response && typeof c.response.content === 'string') return c.response.content;
            if (typeof c.response === 'string') return c.response;
            if (c.executionResults && c.executionResults[0] && c.executionResults[0].response) {
                var r1 = c.executionResults[0].response;
                if (typeof r1 === 'string') return r1;
                if (r1.content) return r1.content;
            }
        }
        if (raw.executionResults && raw.executionResults[0]) {
            var er = raw.executionResults[0];
            if (er.payload) {
                if (typeof er.payload.response === 'string') return er.payload.response;
                if (er.payload.response && er.payload.response.content) return er.payload.response.content;
                if (typeof er.payload === 'string') return er.payload;
            }
            if (er.response) {
                if (typeof er.response === 'string') return er.response;
                if (er.response.content) return er.response.content;
            }
        }
        if (typeof raw.content === 'string')  return raw.content;
        if (typeof raw.response === 'string') return raw.response;
        if (typeof raw.text === 'string')     return raw.text;
        return null;
    },

    _extractUsage: function(raw) {
        var inT = 0, outT = 0;
        var probe = function(o) {
            if (!o || typeof o !== 'object') return;
            if (typeof o.input_tokens === 'number') inT = o.input_tokens;
            if (typeof o.output_tokens === 'number') outT = o.output_tokens;
            if (typeof o.prompt_tokens === 'number') inT = inT || o.prompt_tokens;
            if (typeof o.completion_tokens === 'number') outT = outT || o.completion_tokens;
        };
        probe(raw.usage);
        if (raw.capabilities && this.capabilityId && raw.capabilities[this.capabilityId]) {
            probe(raw.capabilities[this.capabilityId].usage);
        }
        if (raw.executionResults && raw.executionResults[0]) {
            probe(raw.executionResults[0].usage);
            probe(raw.executionResults[0].metadata);
        }
        return { tokensIn: inT, tokensOut: outT };
    },

    _callGemini: function(systemPrompt, userPrompt, options) {
        var model = options.model || this.defaultModel;
        var maxTokens = options.maxTokens || 4096;
        var temperature = (typeof options.temperature === 'number') ? options.temperature : 0.3;
        var enforceJson = options.enforceJson !== false;
        var apiKey = gs.getProperty(this.apiKeyProperty);
        if (!apiKey) { gs.error('LLMConnector: missing Gemini key'); return null; }

        var generationConfig = { temperature: temperature, maxOutputTokens: maxTokens };
        if (enforceJson) {
            generationConfig.responseMimeType = 'application/json';
            generationConfig.responseSchema = {
                type: 'object',
                properties: { title: {type:'string'}, summary: {type:'string'}, body_html: {type:'string'} },
                required: ['title', 'summary', 'body_html']
            };
        }

        var body = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: generationConfig,
            safetySettings: ['HARM_CATEGORY_HARASSMENT','HARM_CATEGORY_HATE_SPEECH','HARM_CATEGORY_SEXUALLY_EXPLICIT','HARM_CATEGORY_DANGEROUS_CONTENT']
                .map(function(c) { return { category: c, threshold: 'BLOCK_ONLY_HIGH' }; })
        };

        var endpoint = this.endpointBase + model + ':generateContent';
        var backoff = 4000;
        for (var attempt = 0; attempt < 3; attempt++) {
            var rm = new sn_ws.RESTMessageV2();
            rm.setEndpoint(endpoint);
            rm.setHttpMethod('POST');
            rm.setRequestHeader('x-goog-api-key', apiKey);
            rm.setRequestHeader('Content-Type', 'application/json');
            rm.setRequestBody(JSON.stringify(body));
            rm.setHttpTimeout(60000);
            var r;
            try { r = rm.execute(); }
            catch (e) { gs.error('LLMConnector: REST exception ' + e.message); return null; }
            var status = r.getStatusCode();
            if (status === 200) {
                var parsed = JSON.parse(r.getBody());
                var cand = parsed.candidates && parsed.candidates[0];
                if (!cand || !cand.content || !cand.content.parts) return null;
                if (cand.finishReason && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') return null;
                var u = parsed.usageMetadata || {};
                return {
                    text: cand.content.parts.map(function(p) { return p.text || ''; }).join(''),
                    model: model,
                    tokensIn: u.promptTokenCount || 0,
                    tokensOut: u.candidatesTokenCount || 0
                };
            }
            if (status === 429) { gs.sleep(backoff); backoff *= 2; continue; }
            gs.error('LLMConnector: HTTP ' + status);
            return null;
        }
        gs.eventQueue('x_1158634_kb_int_0.daily_cap_hit', null, model, 'LLMConnector');
        return null;
    },

    type: 'LLMConnector'
};
