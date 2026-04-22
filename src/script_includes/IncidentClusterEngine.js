/**
 * IncidentClusterEngine
 *
 * Groups closed `incident` records into clusters of similar resolutions.
 * PI Cluster Solution primary; deterministic keyword grouping fallback.
 * Output: rows in x_1158634_kb_int_0_cluster.
 *
 * Scope: x_1158634_kb_int_0
 * Accessible from: This application scope only
 */
var IncidentClusterEngine = Class.create();
IncidentClusterEngine.prototype = {

    initialize: function() {
        this.solutionName = gs.getProperty('x_1158634_kb_int_0.cluster_solution_name', 'incident_cluster_l2l3');
        this.minClusterSize = parseInt(gs.getProperty('x_1158634_kb_int_0.min_cluster_size', '5'), 10);
        this.lookbackDays = parseInt(gs.getProperty('x_1158634_kb_int_0.lookback_days', '365'), 10);
    },

    runClustering: function() {
        var buckets = this._tryPI() || this._keywordFallback();
        var upserted = 0;
        for (var label in buckets) {
            if (buckets[label].ids.length < this.minClusterSize) continue;
            this._upsert(label, buckets[label]);
            upserted++;
        }
        gs.info('IncidentClusterEngine: ' + upserted + ' clusters upserted');
        return upserted;
    },

    _tryPI: function() {
        var version;
        try {
            var sol = sn_ml.SolutionStore.getSolution(this.solutionName);
            if (!sol) return null;
            version = sol.findActiveVersion();
            if (!version) return null;
        } catch (e) { return null; }

        var buckets = {};
        var gr = this._closedIncidentQuery();
        while (gr.next()) {
            var label;
            try {
                var out = version.predict([gr]);
                label = (out && out[0] && typeof out[0].getPrediction === 'function') ? out[0].getPrediction() : null;
            } catch (e) { continue; }
            if (!label) continue;
            if (!buckets[label]) buckets[label] = { ids: [], shortDescs: [] };
            buckets[label].ids.push(gr.getUniqueValue());
            buckets[label].shortDescs.push(gr.getValue('short_description'));
        }
        return Object.keys(buckets).length ? buckets : null;
    },

    _keywordFallback: function() {
        var STOP = { the:1, a:1, an:1, and:1, or:1, is:1, in:1, to:1, of:1, for:1, on:1, with:1, cannot:1, cant:1, not:1 };
        var buckets = {};
        var gr = this._closedIncidentQuery();
        while (gr.next()) {
            var sd = (gr.getValue('short_description') || '').toLowerCase();
            var tokens = sd.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function(t) {
                return t.length > 2 && !STOP[t];
            });
            if (tokens.length < 2) continue;
            var key = (gr.getValue('category') || 'misc') + '::' + tokens.slice(0, 2).sort().join('_');
            if (!buckets[key]) buckets[key] = { ids: [], shortDescs: [] };
            buckets[key].ids.push(gr.getUniqueValue());
            buckets[key].shortDescs.push(gr.getValue('short_description'));
        }
        return buckets;
    },

    _closedIncidentQuery: function() {
        var gr = new GlideRecord('incident');
        gr.addQuery('state', 'IN', '6,7');
        gr.addNotNullQuery('close_notes');
        gr.addQuery('sys_updated_on', '>=', this._daysAgoISO(this.lookbackDays));
        gr.setLimit(5000);
        gr.query();
        return gr;
    },

    _upsert: function(label, members) {
        var c = new GlideRecord('x_1158634_kb_int_0_cluster');
        c.addQuery('name', label);
        c.query();
        var isNew = !c.next();
        if (isNew) {
            c.initialize();
            c.setValue('name', label);
            c.setValue('status', 'open');
        }

        c.setValue('summary', members.shortDescs.slice(0, 3).join(' | '));
        c.setValue('member_count', members.ids.length);
        c.setValue('last_seen', new GlideDateTime());
        c.setValue('representative_incident', members.ids[0]);

        var agg = this._aggregate(members.ids);
        if (agg.avgMinutes !== null) c.setValue('avg_resolution_minutes', agg.avgMinutes);
        if (agg.topGroup) c.setValue('top_assignment_group', agg.topGroup);

        var kb = this._findLinkedKb(members.ids);
        if (kb && c.getValue('status') !== 'has_kb') {
            c.setValue('linked_kb', kb);
            c.setValue('status', 'has_kb');
        }
        c.update();
    },

    _aggregate: function(ids) {
        var sum = 0, n = 0, groups = {};
        for (var i = 0; i < ids.length; i++) {
            var gr = new GlideRecord('incident');
            if (!gr.get(ids[i])) continue;
            var o = gr.getValue('opened_at'), r = gr.getValue('resolved_at');
            if (o && r) {
                var diff = (new GlideDateTime(r)).getNumericValue() - (new GlideDateTime(o)).getNumericValue();
                if (diff > 0) { sum += Math.floor(diff / 60000); n++; }
            }
            var ag = gr.getValue('assignment_group');
            if (ag) groups[ag] = (groups[ag] || 0) + 1;
        }
        var topGroup = null, topCount = 0;
        for (var g in groups) if (groups[g] > topCount) { topGroup = g; topCount = groups[g]; }
        return { avgMinutes: n > 0 ? Math.floor(sum / n) : null, topGroup: topGroup };
    },

    _findLinkedKb: function(ids) {
        var m = new GlideRecord('m2m_kb_task');
        m.addQuery('task', 'IN', ids.join(','));
        m.setLimit(1);
        m.query();
        return m.next() ? m.getValue('kb_knowledge') : null;
    },

    _daysAgoISO: function(days) {
        var gdt = new GlideDateTime();
        gdt.addDaysLocalTime(-days);
        return gdt.getValue();
    },

    type: 'IncidentClusterEngine'
};
