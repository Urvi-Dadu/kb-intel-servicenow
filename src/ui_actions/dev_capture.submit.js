/**
 * UI Action: Submit for KB Generation
 * Table: x_1158634_kb_int_0_dev_capture   |   Form button   |   Server-side
 * Condition: current.state == 'draft'
 *
 * Validates minimum input. The async BR (dev_capture.submitted) picks up the
 * state transition and invokes KBDraftBuilder.
 */
(function() {
    if (!current.problem_brief || current.problem_brief.toString().trim().length < 10) {
        gs.addErrorMessage('Problem brief must be at least 10 characters.');
        action.setRedirectURL(current);
        return;
    }
    if (!current.resolution_brief || current.resolution_brief.toString().trim().length < 10) {
        gs.addErrorMessage('Resolution brief must be at least 10 characters. This field is the primary LLM signal.');
        action.setRedirectURL(current);
        return;
    }

    current.setValue('state', 'submitted');
    current.update();

    gs.addInfoMessage('Draft generation queued. KM group will receive a review email when ready.');
    action.setRedirectURL(current);
})();
