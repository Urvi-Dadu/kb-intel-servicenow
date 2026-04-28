/**
 * BR: Story Closure to Dev Capture
 * Table: rm_story   |   When: after   |   Update   |   Order: 1000   |   Async
 * Filter: state changes (filtered in-script for portability across releases)
 *
 * State value for "Complete" varies between Agile module versions. Adjust the
 * completedStates array if your instance's choice list differs.
 */
(function executeRule(current, previous) {
    var completedStates = ['4', '3', 'closed_complete', 'complete'];
    if (completedStates.indexOf(current.getValue('state')) === -1) return;

    var existing = new GlideRecord('x_1158634_kb_int_0_dev_capture');
    existing.addQuery('source_story', current.getUniqueValue());
    existing.setLimit(1);
    existing.query();
    if (existing.next()) return;

    var cap = new GlideRecord('x_1158634_kb_int_0_dev_capture');
    cap.initialize();
    cap.setValue('source_type', 'story');
    cap.setValue('source_story', current.getUniqueValue());
    cap.setValue('developer', current.getValue('assigned_to'));
    cap.setValue('problem_brief', current.getValue('short_description'));
    cap.setValue('state', 'draft');
    var sysId = cap.insert();

    gs.eventQueue('x_1158634_kb_int_0.story.capture_request', null, sysId, current.getValue('assigned_to'));
})(current, previous);
