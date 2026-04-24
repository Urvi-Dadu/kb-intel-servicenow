/**
 * Smoke: cluster -> draft end to end
 *
 * Creates a synthetic cluster row, runs KBDraftBuilder, prints the draft
 * sys_id and a body excerpt. Cleans up neither row; delete manually after
 * inspection.
 */
var rep = new GlideRecord('incident');
rep.addQuery('state', 'IN', '6,7');
rep.addNotNullQuery('close_notes');
rep.orderByDesc('sys_updated_on');
rep.setLimit(1);
rep.query();
if (!rep.next()) { gs.print('No closed incidents with close_notes found. Seed demo data first.'); /* halt */ }
else {

    var c = new GlideRecord('x_1158634_kb_int_0_cluster');
    c.initialize();
    c.setValue('name', 'smoke_test_' + new Date().getTime());
    c.setValue('summary', rep.getValue('short_description'));
    c.setValue('member_count', 5);
    c.setValue('status', 'open');
    c.setValue('representative_incident', rep.getUniqueValue());
    var clusterId = c.insert();
    gs.print('cluster: ' + clusterId);

    var draftId = new x_1158634_kb_int_0.KBDraftBuilder().buildFromCluster(clusterId);
    gs.print('draft: ' + draftId);

    if (draftId) {
        var d = new GlideRecord('x_1158634_kb_int_0_kb_draft');
        d.get(draftId);
        gs.print('title: ' + d.getValue('title'));
        gs.print('tokens i/o: ' + d.getValue('llm_tokens_in') + ' / ' + d.getValue('llm_tokens_out'));
        gs.print('body excerpt (first 600): ' + (d.getValue('body') || '').substring(0, 600));
        var sections = ['Overview','Symptoms','Likely Root Causes','Diagnostic Steps','Resolution Steps','Validation','Related Items'];
        var missing = sections.filter(function(s) { return (d.getValue('body') || '').indexOf('<h2>' + s) === -1; });
        gs.print('missing sections: ' + (missing.length ? missing.join(', ') : 'none'));
    }
}
