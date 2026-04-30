/**
 * UI Action: Capture for KB
 * Table: incident   |   Form button   |   Server-side
 * Condition: current.state == 6 || current.state == 7
 *
 * Idempotent: opens the existing dev_capture record for this incident if one
 * already exists, otherwise creates a new one pre-filled from incident data.
 */
(function() {
    var existing = new GlideRecord('x_1158634_kb_int_0_dev_capture');
    existing.addQuery('source_incident', current.getUniqueValue());
    existing.setLimit(1);
    existing.query();
    if (existing.next()) {
        gs.addInfoMessage('Existing capture found, opening.');
        action.setRedirectURL('x_1158634_kb_int_0_dev_capture.do?sys_id=' + existing.getUniqueValue());
        return;
    }

    var cap = new GlideRecord('x_1158634_kb_int_0_dev_capture');
    cap.initialize();
    cap.setValue('source_type', 'incident');
    cap.setValue('source_incident', current.getUniqueValue());
    cap.setValue('developer', gs.getUserID());
    cap.setValue('problem_brief', current.getValue('short_description'));
    cap.setValue('resolution_brief', current.getValue('close_notes') || '');
    cap.setValue('state', 'draft');
    var sysId = cap.insert();

    action.setRedirectURL('x_1158634_kb_int_0_dev_capture.do?sys_id=' + sysId);
})();
