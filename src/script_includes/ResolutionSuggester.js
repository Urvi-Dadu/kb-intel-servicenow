/**
 * ResolutionSuggester
 *
 * Returns top-N similar past resolutions for a given incident. Writes an
 * audit row to x_1158634_kb_int_0_suggestion_log on every invocation
 * (including zero-result for MTTR-delta analysis).
 *
 * Scope: x_1158634_kb_int_0
 * Accessible from: All application scopes
 */
var ResolutionSuggester = Class.create();
ResolutionSuggester.prototype = {

    initialize: function() {
        this.solutionName = gs.getProperty('x_1158634_kb_int_0.similarity_solution_name', 'incident_similarity_l2l3');
        this.topN = parseInt(gs.getProperty('x_1158634_kb_int_0.suggestion_top_n', '3'), 10);
    },

    suggestForIncident: function(incidentSysId) {
        var inc = new GlideRecord('incident');
        if (!inc.get(incidentSysId)) return [];

        var results = this._tryPI(inc);
        if (!results || !results.length) results = this._keywordFallback(inc);

        var log = new GlideRecord('x_1158634_kb_int_0_suggestion_log');
        log.initialize();
        log.setValue('incident', incidentSysId);
        log.setValue('suggested_kbs', JSON.stringify(results));
        log.setValue('suggested_at', new GlideDateTime());
        log.insert();

        return results;
    },

    _tryPI: function(inc) {
        var version;
        try {
            var sol = sn_ml.SolutionStore.getSolution(this.solutionName);
            if (!sol) return null;
            version = sol.findActiveVersion();
            if (!version) return null;
        } catch (e) { return null; }

        var results = [];
        try {
            var out = version.predict([inc]);
            if (!out || !out.length) return null;
            var sims = (typeof out[0].getSimilarRecords === 'function')
                ? out[0].getSimilarRecords()
                : (typeof out[0].getTopPredictions === 'function' ? out[0].getTopPredictions(this.topN * 3) : []);

            for (var i = 0; i < sims.length && results.length < this.topN; i++) {
                var s = sims[i];
                var simId = (typeof s.getSysId === 'function') ? s.getSysId()
                          : (typeof s.getValue === 'function' ? s.getValue() : null);
                var score = (typeof s.getScore === 'function') ? s.getScore()
                          : (typeof s.getProbability === 'function' ? s.getProbability() : 0);
                if (!simId || simId === inc.getUniqueValue()) continue;

                var other = new GlideRecord('incident');
                if (!other.get(simId)) continue;
                if (other.getValue('state') !== '6' && other.getValue('state') !== '7') continue;
                if (!other.getValue('close_notes')) continue;

                results.push(this._format(other, score));
            }
        } catch (e) { return null; }
        return results;
    },

    _keywordFallback: function(inc) {
        var STOP = { the:1, a:1, an:1, and:1, or:1, is:1, in:1, to:1, of:1, for:1, on:1, with:1, cannot:1, cant:1, not:1 };
        var sd = (inc.getValue('short_description') || '').toLowerCase();
        var keywords = sd.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
            .filter(function(t) { return t.length > 3 && !STOP[t]; })
            .slice(0, 3);

        var attempts = [
            { score: 0.75, terms: keywords.slice(0, 3) },
            { score: 0.50, terms: keywords.slice(0, 2) },
            { score: 0.30, terms: keywords.slice(0, 1) }
        ];
        var results = [], seen = {};
        seen[inc.getUniqueValue()] = true;

        for (var a = 0; a < attempts.length && results.length < this.topN; a++) {
            if (!attempts[a].terms.length) continue;
            var gr = new GlideRecord('incident');
            gr.addQuery('state', 'IN', '6,7');
            gr.addNotNullQuery('close_notes');
            if (inc.getValue('category')) gr.addQuery('category', inc.getValue('category'));
            attempts[a].terms.forEach(function(t) { gr.addQuery('short_description', 'CONTAINS', t); });
            gr.orderByDesc('sys_updated_on');
            gr.setLimit(this.topN * 2);
            gr.query();
            while (gr.next() && results.length < this.topN) {
                var id = gr.getUniqueValue();
                if (seen[id]) continue;
                seen[id] = true;
                results.push(this._format(gr, attempts[a].score));
            }
        }
        return results;
    },

    _format: function(gr, score) {
        return {
            incident_sys_id: gr.getUniqueValue(),
            incident_number: gr.getValue('number'),
            short_description: gr.getValue('short_description'),
            close_notes: (gr.getValue('close_notes') || '').substring(0, 600),
            score: Math.round((score || 0) * 100) / 100,
            kb_sys_id: this._linkedKb(gr.getUniqueValue()) || ''
        };
    },

    _linkedKb: function(sysId) {
        var m = new GlideRecord('m2m_kb_task');
        m.addQuery('task', sysId);
        m.setLimit(1);
        m.query();
        return m.next() ? m.getValue('kb_knowledge') : null;
    },

    type: 'ResolutionSuggester'
};
