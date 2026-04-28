/**
 * BR: Update Suggestion Log on Close
 * Table: incident   |   When: after   |   Update   |   Order: 2000   |   Async
 * Filter: state changes to 6 or 7
 *
 * Closes the loop on MTTR-delta measurement by stamping resolution_minutes
 * onto the most recent suggestion_log row for this incident.
 */
(function executeRule(current, previous) {
    var s = current.getValue('state');
    if (s !== '6' && s !== '7') return;
    if (previous && (previous.getValue('state') === '6' || previous.getValue('state') === '7')) return;

    var log = new GlideRecord('x_1158634_kb_int_0_suggestion_log');
    log.addQuery('incident', current.getUniqueValue());
    log.orderByDesc('suggested_at');
    log.setLimit(1);
    log.query();
    if (!log.next()) return;

    var opened = current.getValue('opened_at');
    var resolved = current.getValue('resolved_at') || current.getValue('closed_at');
    if (opened && resolved) {
        var diff = (new GlideDateTime(resolved)).getNumericValue() - (new GlideDateTime(opened)).getNumericValue();
        log.setValue('resolution_minutes', Math.floor(diff / 60000));
    }
    log.setValue('resolver', current.getValue('resolved_by') || current.getValue('closed_by'));
    log.update();
})(current, previous);
