/**
 * BR: Suggest Resolution on Assignment
 * Table: incident   |   When: after   |   Insert+Update   |   Order: 1000   |   Async
 * Filter: assignment_group changes AND assignment_group is not empty
 */
(function executeRule(current, previous) {
    var state = current.getValue('state');
    if (state === '6' || state === '7' || state === '8') return;
    if (!current.assignment_group || current.assignment_group.nil()) return;

    try {
        new x_1158634_kb_int_0.ResolutionSuggester().suggestForIncident(current.getUniqueValue());
    } catch (e) {
        gs.error('assignment_suggest BR: ' + e.message);
    }
})(current, previous);
