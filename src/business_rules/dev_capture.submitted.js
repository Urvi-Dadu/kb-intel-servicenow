/**
 * BR: Dev Capture Submitted to Draft
 * Table: x_1158634_kb_int_0_dev_capture   |   When: after   |   Update   |   Async
 * Filter: state changes to 'submitted'
 *
 * On generation failure, transitions state back to 'draft' so the user can
 * retry. Avoids the surface-area of a silent-fail "submitted" state.
 */
(function executeRule(current, previous) {
    if (current.getValue('state') !== 'submitted') return;
    if (previous && previous.getValue('state') === 'submitted') return;

    try {
        var draftId = new x_1158634_kb_int_0.KBDraftBuilder().buildFromDevCapture(current.getUniqueValue());
        if (!draftId) {
            gs.warn('dev_capture.submitted: build returned null for ' + current.getUniqueValue());
            current.setValue('state', 'draft');
            current.update();
        }
    } catch (e) {
        gs.error('dev_capture.submitted: ' + e.message);
        current.setValue('state', 'draft');
        current.update();
    }
})(current, previous);
