/**
 * Scheduled Script Execution: Weekly Incident Cluster Run
 * Frequency: Weekly, Sunday 02:00
 *
 * Refreshes clusters, then generates drafts for open clusters at or above the
 * min size threshold that do not already have a non-rejected draft. 5s sleep
 * between LLM calls stays below Gemini free-tier 15 RPM. Per-run safety cap
 * of 50 clusters; biggest first by member_count to bias toward impact.
 */
(function() {
    var minSize = parseInt(gs.getProperty('x_1158634_kb_int_0.min_cluster_size', '5'), 10);

    gs.info('weekly_cluster_run: refreshing clusters');
    var n = new x_1158634_kb_int_0.IncidentClusterEngine().runClustering();
    gs.info('weekly_cluster_run: ' + n + ' clusters refreshed');

    var builder = new x_1158634_kb_int_0.KBDraftBuilder();
    var generated = 0;

    var gaps = new GlideRecord('x_1158634_kb_int_0_cluster');
    gaps.addQuery('status', 'open');
    gaps.addQuery('member_count', '>=', minSize);
    gaps.orderByDesc('member_count');
    gaps.setLimit(50);
    gaps.query();

    while (gaps.next()) {
        var existing = new GlideRecord('x_1158634_kb_int_0_kb_draft');
        existing.addQuery('source_cluster', gaps.getUniqueValue());
        existing.addQuery('review_state', 'IN', 'draft,in_review,approved,published');
        existing.setLimit(1);
        existing.query();
        if (existing.next()) continue;

        try {
            var draftId = builder.buildFromCluster(gaps.getUniqueValue());
            if (draftId) generated++;
        } catch (e) {
            gs.error('weekly_cluster_run: ' + e.message);
        }
        gs.sleep(5000);
    }

    gs.info('weekly_cluster_run: ' + generated + ' new drafts');
})();
