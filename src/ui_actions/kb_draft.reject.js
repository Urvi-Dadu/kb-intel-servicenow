/**
 * UI Action: Reject Draft
 * Table: x_1158634_kb_int_0_kb_draft   |   Form button   |   Server-side
 * Roles: knowledge_manager, admin
 * Condition: current.review_state IN ('draft','in_review')
 *
 * Dismisses the source cluster so the weekly job will not regenerate the
 * same draft. To force regeneration, manually flip cluster.status back to open.
 */
(function() {
    current.setValue('review_state', 'rejected');
    current.setValue('reviewer', gs.getUserID());
    current.update();

    if (!current.source_cluster.nil()) {
        var c = new GlideRecord('x_1158634_kb_int_0_cluster');
        if (c.get(current.getValue('source_cluster'))) {
            c.setValue('status', 'dismissed');
            c.update();
        }
    }

    gs.addInfoMessage('Draft rejected. Source cluster dismissed.');
    action.setRedirectURL(current);
})();
