/**
 * UI Action: Approve and Publish
 * Table: x_1158634_kb_int_0_kb_draft   |   Form button   |   Server-side
 * Roles: knowledge_manager, admin
 * Condition: current.review_state IN ('draft','in_review')
 *
 * Creates kb_knowledge in the configured target base. Back-links the draft,
 * marks source cluster has_kb, attaches m2m_kb_task for source incident.
 */
(function() {
    var targetBase = gs.getProperty('x_1158634_kb_int_0.target_kb_base');
    if (!targetBase) {
        gs.addErrorMessage('x_1158634_kb_int_0.target_kb_base property not set.');
        action.setRedirectURL(current);
        return;
    }

    var kb = new GlideRecord('kb_knowledge');
    kb.initialize();
    kb.setValue('short_description', current.getValue('title'));
    kb.setValue('text', current.getValue('body'));
    kb.setValue('article_type', 'text');
    kb.setValue('kb_knowledge_base', targetBase);
    kb.setValue('workflow_state', 'published');
    kb.setValue('valid_to', '2099-12-31');
    var kbId = kb.insert();
    if (!kbId) {
        gs.addErrorMessage('kb_knowledge insert failed. Check ACLs on target base.');
        action.setRedirectURL(current);
        return;
    }

    current.setValue('published_kb', kbId);
    current.setValue('review_state', 'published');
    current.setValue('reviewer', gs.getUserID());
    current.update();

    if (!current.source_cluster.nil()) {
        var c = new GlideRecord('x_1158634_kb_int_0_cluster');
        if (c.get(current.getValue('source_cluster'))) {
            c.setValue('linked_kb', kbId);
            c.setValue('status', 'has_kb');
            c.update();
        }
    }

    if (!current.source_incident.nil()) {
        var m = new GlideRecord('m2m_kb_task');
        m.initialize();
        m.setValue('task', current.getValue('source_incident'));
        m.setValue('kb_knowledge', kbId);
        m.insert();
    }

    var newKb = new GlideRecord('kb_knowledge');
    newKb.get(kbId);
    gs.addInfoMessage('Published as ' + (newKb.getValue('number') || kbId));
    action.setRedirectURL('kb_knowledge.do?sys_id=' + kbId);
})();
