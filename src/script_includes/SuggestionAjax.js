/**
 * SuggestionAjax
 *
 * AJAX endpoint for the incident form's onLoad Client Script
 * (CS_incident_suggestions_load). Two methods:
 *   getSuggestions       -> read latest suggestion_log row for the incident
 *   refreshSuggestions   -> force ResolutionSuggester re-run, then read
 *
 * Scope: x_1158634_kb_int_0
 * Accessible from: All application scopes
 * Client callable: true
 */
var SuggestionAjax = Class.create();
SuggestionAjax.prototype = Object.extendsObject(AbstractAjaxProcessor, {

    getSuggestions: function() {
        var sysId = this.getParameter('sysparm_incident_id');
        var out = { incident_id: sysId, suggestions: [], debug: '' };
        if (!sysId) { out.debug = 'no sysparm_incident_id'; return JSON.stringify(out); }

        var gr = new GlideRecord('x_1158634_kb_int_0_suggestion_log');
        gr.addQuery('incident', sysId);
        gr.orderByDesc('suggested_at');
        gr.setLimit(1);
        gr.query();
        if (!gr.next()) { out.debug = 'no log row'; return JSON.stringify(out); }

        try {
            out.suggestions = JSON.parse(gr.getValue('suggested_kbs') || '[]');
            out.debug = 'ok (' + out.suggestions.length + ')';
        } catch (e) {
            out.debug = 'parse error: ' + e.message;
        }
        return JSON.stringify(out);
    },

    refreshSuggestions: function() {
        var sysId = this.getParameter('sysparm_incident_id');
        if (!sysId) return JSON.stringify({ suggestions: [], debug: 'no sysparm_incident_id' });
        try { new x_1158634_kb_int_0.ResolutionSuggester().suggestForIncident(sysId); }
        catch (e) { return JSON.stringify({ suggestions: [], debug: 'suggester error: ' + e.message }); }
        return this.getSuggestions();
    },

    type: 'SuggestionAjax'
});
