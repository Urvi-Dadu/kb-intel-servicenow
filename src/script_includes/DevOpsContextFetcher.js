/**
 * DevOpsContextFetcher
 *
 * Reads commit data linked to a story via the ServiceNow DevOps plugin.
 * Returns [] on any failure path including plugin-absent. Defensive across
 * release-dependent table/field naming.
 *
 * Scope: x_1158634_kb_int_0
 * Accessible from: This application scope only
 */
var DevOpsContextFetcher = Class.create();
DevOpsContextFetcher.prototype = {

    initialize: function() {},

    /**
     * @param {string} storySysId
     * @returns {Array<{hash:string, message:string, author:string, files:string}>}
     */
    fetchForStory: function(storySysId) {
        if (!storySysId) return [];
        return this._tryTable('sn_devops_commit', storySysId)
            || this._tryTable('sn_devops_change_artifact', storySysId)
            || [];
    },

    _tryTable: function(table, storySysId) {
        var probe = new GlideRecord(table);
        if (!probe.isValid()) return null;

        var fks = ['story', 'rm_story', 'task', 'change_request'];
        for (var i = 0; i < fks.length; i++) {
            var fk = fks[i];
            if (!probe.isValidField(fk)) continue;
            var gr = new GlideRecord(table);
            gr.addQuery(fk, storySysId);
            gr.setLimit(20);
            gr.query();
            var commits = [];
            while (gr.next()) commits.push(this._extract(gr));
            if (commits.length) return commits;
        }
        return null;
    },

    _extract: function(gr) {
        var pick = function(fields, displayValue) {
            for (var i = 0; i < fields.length; i++) {
                if (gr.isValidField(fields[i])) {
                    var v = displayValue ? gr.getDisplayValue(fields[i]) : gr.getValue(fields[i]);
                    if (v) return v;
                }
            }
            return '';
        };
        return {
            hash:    (pick(['commit_id','hash','short_id','sha','revision']) || '').substring(0, 40),
            message: (pick(['commit_message','message','short_description','description']) || '').substring(0, 500),
            author:  pick(['author','committer','developer'], true),
            files:   (pick(['changed_files','files','diff_files','modified_files']) || '').substring(0, 1000)
        };
    },

    type: 'DevOpsContextFetcher'
};
