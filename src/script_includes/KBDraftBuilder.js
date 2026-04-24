/**
 * KBDraftBuilder
 *
 * Two entry points:
 *   buildFromCluster(clusterSysId)       -> draft sys_id | null
 *   buildFromDevCapture(captureSysId)    -> draft sys_id | null
 *
 * Story-sourced captures use `story_model` (gemini-2.5-pro); all others use
 * default model. DevOps commit context is fetched when source is a story.
 *
 * Scope: x_1158634_kb_int_0
 * Accessible from: This application scope only
 */
var KBDraftBuilder = Class.create();
KBDraftBuilder.prototype = {

    initialize: function() {
        this.llm = new x_1158634_kb_int_0.LLMConnector();
        this.storyModel = gs.getProperty('x_1158634_kb_int_0.story_model', 'gemini-2.5-pro');
    },

    buildFromCluster: function(clusterSysId) {
        var cluster = new GlideRecord('x_1158634_kb_int_0_cluster');
        if (!cluster.get(clusterSysId)) return null;

        var incidents = this._fetchTopIncidents(cluster, 5);
        if (!incidents.length) return null;

        var result = this.llm.callGemini(
            this._sysPromptCluster(),
            this._userPromptCluster(cluster, incidents),
            { maxTokens: 3000, enforceJson: true }
        );
        if (!result) return null;

        var parsed = this._parseArticle(result.text);
        var draft = this._insertDraft({
            title: parsed.title,
            summary: parsed.summary,
            body: parsed.body,
            source_type: 'incident_cluster',
            source_cluster: clusterSysId,
            llm: result
        });

        cluster.setValue('status', 'draft_pending');
        cluster.update();

        gs.eventQueue('x_1158634_kb_int_0.draft.created', null, draft, 'cluster');
        return draft;
    },

    buildFromDevCapture: function(captureSysId) {
        var cap = new GlideRecord('x_1158634_kb_int_0_dev_capture');
        if (!cap.get(captureSysId)) return null;

        var sourceType = cap.getValue('source_type');
        var commits = [];
        if (sourceType === 'story' && !cap.source_story.nil()) {
            try { commits = new x_1158634_kb_int_0.DevOpsContextFetcher().fetchForStory(cap.getValue('source_story')); }
            catch (e) { /* plugin absent */ }
        }

        var opts = { maxTokens: 4096, enforceJson: true };
        if (sourceType === 'story') opts.model = this.storyModel;

        var result = this.llm.callGemini(
            this._sysPromptDevCapture(),
            this._userPromptDevCapture(cap, commits),
            opts
        );
        if (!result) return null;

        var parsed = this._parseArticle(result.text);
        var draftId = this._insertDraft({
            title: parsed.title,
            summary: parsed.summary,
            body: parsed.body,
            source_type: sourceType === 'story' ? 'story' : 'dev_capture',
            source_dev_capture: cap.getUniqueValue(),
            source_story: cap.source_story.nil() ? null : cap.getValue('source_story'),
            source_incident: cap.source_incident.nil() ? null : cap.getValue('source_incident'),
            resolver: cap.getValue('developer'),
            llm: result
        });

        cap.setValue('generated_draft', draftId);
        cap.setValue('state', 'processed');
        cap.update();

        gs.eventQueue('x_1158634_kb_int_0.draft.created', null, draftId, sourceType === 'story' ? 'story' : 'dev_capture');
        return draftId;
    },

    _insertDraft: function(p) {
        var d = new GlideRecord('x_1158634_kb_int_0_kb_draft');
        d.initialize();
        d.setValue('title', p.title);
        d.setValue('summary', p.summary);
        d.setValue('body', p.body);
        d.setValue('source_type', p.source_type);
        if (p.source_cluster)     d.setValue('source_cluster', p.source_cluster);
        if (p.source_dev_capture) d.setValue('source_dev_capture', p.source_dev_capture);
        if (p.source_story)       d.setValue('source_story', p.source_story);
        if (p.source_incident)    d.setValue('source_incident', p.source_incident);
        if (p.resolver)           d.setValue('resolver', p.resolver);
        d.setValue('review_state', 'draft');
        d.setValue('llm_model_used', p.llm.model);
        d.setValue('llm_tokens_in', p.llm.tokensIn);
        d.setValue('llm_tokens_out', p.llm.tokensOut);
        d.setValue('generated_at', new GlideDateTime());
        return d.insert();
    },

    _fetchTopIncidents: function(cluster, limit) {
        var members = [], seen = {};
        var repId = cluster.getValue('representative_incident');
        if (repId) {
            var rep = new GlideRecord('incident');
            if (rep.get(repId)) { members.push(this._toObj(rep)); seen[repId] = true; }
        }

        var keyword = ((cluster.getValue('summary') || '').split('|')[0].trim()
            .split(/\s+/).filter(function(w) { return w.length > 4; })[0]) || '';

        var gr = new GlideRecord('incident');
        gr.addQuery('state', 'IN', '6,7');
        gr.addNotNullQuery('close_notes');
        if (keyword) gr.addQuery('short_description', 'CONTAINS', keyword);
        gr.orderByDesc('sys_updated_on');
        gr.setLimit(limit * 3);
        gr.query();
        while (gr.next() && members.length < limit) {
            var id = gr.getUniqueValue();
            if (seen[id]) continue;
            seen[id] = true;
            members.push(this._toObj(gr));
        }
        return members;
    },

    _toObj: function(gr) {
        return {
            number: gr.getValue('number'),
            short: gr.getValue('short_description') || '',
            description: (gr.getValue('description') || '').substring(0, 800),
            resolution: (gr.getValue('close_notes') || '').substring(0, 1500),
            category: gr.getValue('category') || ''
        };
    },

    _parseArticle: function(text) {
        try {
            var j = JSON.parse(text);
            return {
                title: (j.title || 'Untitled').toString().substring(0, 200),
                summary: (j.summary || '').toString().substring(0, 1000),
                body: (j.body_html || j.body || '').toString()
            };
        } catch (e) {
            var s = text.indexOf('{'), eIdx = text.lastIndexOf('}');
            if (s >= 0 && eIdx > s) {
                try {
                    var j2 = JSON.parse(text.substring(s, eIdx + 1));
                    return {
                        title: (j2.title || 'Untitled').toString().substring(0, 200),
                        summary: (j2.summary || '').toString().substring(0, 1000),
                        body: (j2.body_html || j2.body || '').toString()
                    };
                } catch (e2) {}
            }
            return { title: 'KB Draft (parse failed)', summary: text.substring(0, 500), body: '<p>' + GlideStringUtil.escapeHTML(text) + '</p>' };
        }
    },

    _sysPromptCluster: function() {
        return [
            'You are an expert ITSM Knowledge Management author writing for Tier 2 and Tier 3 support engineers. Your audience is technical: they read scripts, read logs, edit configurations. They do not need definitions of basic terms; they need precise, actionable guidance.',
            '',
            'You produce KB articles from clusters of similar resolved incidents. Your job is to identify the underlying recurring issue and write a single canonical article a Tier 2/3 engineer can follow on the next occurrence.',
            '',
            'OUTPUT REQUIREMENTS:',
            '- Return ONLY valid JSON matching the response schema (title, summary, body_html).',
            '- body_html uses ONLY: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <pre>, <code>, <strong>, <em>. No <html>, <body>, <script>, <style>, <a>, <img>, <table>.',
            '- body_html MUST contain these <h2> sections in this exact order:',
            '   1. Overview',
            '   2. Symptoms',
            '   3. Likely Root Causes',
            '   4. Diagnostic Steps',
            '   5. Resolution Steps  (must be an <ol> of numbered, imperative sentences)',
            '   6. Validation',
            '   7. Related Items',
            '- Preserve commands, queries, file paths, system properties verbatim in <pre><code>.',
            '- Do not invent facts. If a section has no source material, say "(no data in source incidents, engineer to supplement)".',
            '- Title: short imperative or descriptive line, max 12 words.',
            '- Summary: one sentence, max 30 words, suitable for KB search results.'
        ].join('\n');
    },

    _userPromptCluster: function(cluster, incidents) {
        var lines = [];
        lines.push('Write a KB article from this cluster of similar resolved incidents.', '');
        lines.push('CLUSTER METADATA');
        lines.push('- Cluster summary: ' + (cluster.getValue('summary') || '(none)'));
        lines.push('- Member count: ' + cluster.getValue('member_count'));
        lines.push('- Average resolution time: ' + (cluster.getValue('avg_resolution_minutes') || 'unknown') + ' minutes');
        lines.push('- Top assignment group: ' + (cluster.top_assignment_group.getDisplayValue() || 'unknown'), '');
        lines.push('SAMPLE INCIDENTS (top ' + incidents.length + ')');
        incidents.forEach(function(i) {
            lines.push('--- INCIDENT ' + i.number + ' ---');
            lines.push('Short description: ' + i.short);
            lines.push('Description: ' + i.description);
            lines.push('Category: ' + i.category);
            lines.push('Resolution notes: ' + i.resolution, '');
        });
        lines.push('Identify the underlying recurring issue across these incidents. Write a single canonical KB article a Tier 2/3 engineer can follow on the next occurrence. Be specific about commands, queries, scripts, configuration paths if mentioned in resolution notes. Preserve exact identifiers verbatim.');
        return lines.join('\n');
    },

    _sysPromptDevCapture: function() {
        return [
            'You are an expert technical writer producing KB articles from developer post-resolution captures. The audience is L2/L3 engineers and future developers who will encounter the same problem or build on the same workflow. They are technical; do not over-explain basics.',
            '',
            'OUTPUT REQUIREMENTS:',
            '- Return ONLY valid JSON matching the response schema (title, summary, body_html).',
            '- body_html uses ONLY: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <pre>, <code>, <strong>, <em>.',
            '- body_html MUST contain these sections in this exact order. Sections marked REQUIRED always appear; others appear only when source data exists for them:',
            '   - <h2>Context & Symptom</h2>            (REQUIRED)',
            '   - <h2>Root Cause / Why This Was Needed</h2>  (REQUIRED)',
            '   - <h2>Resolution Walkthrough</h2>        (REQUIRED; numbered <ol>)',
            '   - <h2>Workflow Changes</h2>              (only if workflow_changed=true)',
            '   - <h2>Script / Code Changes</h2>         (only if scripts_changed=true; show before/after in <pre><code> when available)',
            '   - <h2>Configuration Changes</h2>         (only if configs_changed=true)',
            '   - <h2>Validation Steps</h2>              (REQUIRED)',
            '   - <h2>Rollback / Watch-outs</h2>         (REQUIRED)',
            '   - <h2>Related Items</h2>',
            '',
            'CRITICAL RULES:',
            '- Use the developer\'s exact terminology. Do not paraphrase identifiers.',
            '- Where a REQUIRED section has sparse source data, write what is deducible and mark "(developer to confirm)".',
            '- NEVER invent script names, table names, system property names, or commit hashes that are not in the input.',
            '- Code snippets go in <pre><code>. Inline names go in <code>.',
            '- Title: max 12 words. Summary: one sentence, max 30 words.'
        ].join('\n');
    },

    _userPromptDevCapture: function(cap, commits) {
        var lines = [];
        lines.push('Generate a KB article from this developer\'s brief capture.', '', 'SOURCE');
        lines.push('- Source type: ' + cap.getValue('source_type'));
        if (!cap.source_story.nil()) {
            var s = new GlideRecord('rm_story');
            if (s.get(cap.getValue('source_story'))) {
                lines.push('- Story: ' + s.getValue('number') + ' (' + s.getValue('short_description') + ')');
                lines.push('- Acceptance criteria: ' + (s.getValue('acceptance_criteria') || '(none)'));
            }
        }
        if (!cap.source_incident.nil()) {
            var i = new GlideRecord('incident');
            if (i.get(cap.getValue('source_incident'))) {
                lines.push('- Incident: ' + i.getValue('number') + ' (' + i.getValue('short_description') + ')');
                lines.push('- Category: ' + (i.getValue('category') || ''));
            }
        }
        lines.push('- Developer: ' + cap.developer.getDisplayValue(), '');
        lines.push('PROBLEM BRIEF');     lines.push(cap.getValue('problem_brief') || '(empty)', '');
        lines.push('WHAT THE DEVELOPER DID'); lines.push(cap.getValue('resolution_brief') || '(empty)', '');
        lines.push('ROOT CAUSE');        lines.push(cap.getValue('root_cause') || '(empty)', '');

        var b = function(field) { var v = cap.getValue(field); return v === '1' || v === 'true'; };
        lines.push('WORKFLOW CHANGES: ' + (b('workflow_changed') ? 'yes' : 'no'));
        if (b('workflow_changed')) lines.push('Details: ' + (cap.getValue('workflow_details') || '(empty)'));
        lines.push('');
        lines.push('SCRIPT / CODE CHANGES: ' + (b('scripts_changed') ? 'yes' : 'no'));
        if (b('scripts_changed')) lines.push('Details: ' + (cap.getValue('script_details') || '(empty)'));
        lines.push('');
        lines.push('CONFIG CHANGES: ' + (b('configs_changed') ? 'yes' : 'no'));
        if (b('configs_changed')) lines.push('Details: ' + (cap.getValue('config_details') || '(empty)'));
        lines.push('');
        lines.push('VALIDATION STEPS PERFORMED'); lines.push(cap.getValue('validation_steps') || '(empty)', '');
        lines.push('RELATED ITEMS');     lines.push(cap.getValue('related_items') || '(none)', '');

        if (commits && commits.length) {
            lines.push('COMMIT CONTEXT (ServiceNow DevOps)');
            commits.forEach(function(c) {
                lines.push('- ' + c.hash + ' by ' + c.author + ': ' + c.message);
                if (c.files) lines.push('  Files: ' + c.files);
            });
            lines.push('');
        }

        lines.push('Produce the KB article per the system prompt rules. Use the developer\'s exact identifiers verbatim.');
        return lines.join('\n');
    },

    type: 'KBDraftBuilder'
};
