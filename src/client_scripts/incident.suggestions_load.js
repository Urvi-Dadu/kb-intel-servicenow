/**
 * Client Script: KB Intel - Load Suggestions
 * Table: incident   |   Type: onLoad   |   UI Type: All
 *
 * Calls SuggestionAjax via GlideAjax, renders into the kb_intel_suggestion_panel
 * placeholder (or creates one if the Formatter is absent). HTML-escapes all
 * incident-derived text before injection.
 */
function onLoad() {
    if (typeof g_form === 'undefined' || !g_form) return;
    if (g_form.isNewRecord && g_form.isNewRecord()) return;

    var sysId = g_form.getUniqueValue();
    if (!sysId) return;

    fetchAndRender();

    document.addEventListener('click', function(ev) {
        if (ev.target && ev.target.id === 'kbi_refresh_btn') {
            ev.preventDefault();
            ev.target.disabled = true;
            ev.target.innerText = 'Refreshing...';
            refresh();
        }
    });

    function fetchAndRender() {
        var ga = new GlideAjax('x_1158634_kb_int_0.SuggestionAjax');
        ga.addParam('sysparm_name', 'getSuggestions');
        ga.addParam('sysparm_incident_id', sysId);
        ga.getXMLAnswer(function(answer) {
            handleResponse(answer);
        });
    }

    function refresh() {
        var ga = new GlideAjax('x_1158634_kb_int_0.SuggestionAjax');
        ga.addParam('sysparm_name', 'refreshSuggestions');
        ga.addParam('sysparm_incident_id', sysId);
        ga.getXMLAnswer(function(answer) {
            handleResponse(answer);
        });
    }

    function handleResponse(answer) {
        try {
            var data = JSON.parse(answer || '{}');
            render(data.suggestions || [], data.debug || '');
        } catch (e) {
            console.error('KB Intel: AJAX parse error', e, answer);
            render([], 'parse error');
        }
    }

    function render(suggestions, debugInfo) {
        var panel = document.getElementById('kbi_panel');
        if (!panel) panel = injectPlaceholder();
        if (!panel) return;
        panel.innerHTML = buildHtml(suggestions, debugInfo);
    }

    function injectPlaceholder() {
        var p = document.createElement('div');
        p.id = 'kbi_panel';
        p.style.cssText = 'border:1px solid #d0d7de;padding:12px;border-radius:6px;background:#f6f8fa;margin:10px 0;';
        var candidates = [
            document.querySelector('table.formtable'),
            document.querySelector('.section_form_only'),
            document.querySelector('form[name="incident.do"]')
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i] && candidates[i].parentNode) {
                candidates[i].parentNode.insertBefore(p, candidates[i]);
                return p;
            }
        }
        console.warn('KB Intel: no form target found');
        return null;
    }

    function esc(s) {
        if (s === null || typeof s === 'undefined') return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function buildHtml(suggestions, debugInfo) {
        var p = ['<h4 style="margin:0 0 8px 0;color:#0969da;">Similar Past Resolutions (L2 / L3)</h4>'];
        p.push('<div style="font-size:0.75em;color:#999;margin-bottom:6px;">debug: ' + esc(debugInfo) + '</div>'); // remove for prod

        if (!suggestions.length) {
            p.push('<em style="color:#57606a;">No suggestions yet. Assign to a group, save, reload. Or click Refresh below.</em>');
        } else {
            for (var i = 0; i < suggestions.length; i++) {
                var s = suggestions[i];
                p.push('<div style="margin-bottom:10px;border-left:3px solid #0969da;padding-left:8px;">');
                p.push(  '<div><strong><a href="incident.do?sys_id=' + esc(s.incident_sys_id) + '" target="_blank">' + esc(s.incident_number) + '</a></strong>');
                p.push(  '<span style="color:#57606a;font-size:0.9em;"> (similarity ' + esc(s.score) + ')</span></div>');
                p.push(  '<div style="margin:4px 0;">' + esc(s.short_description) + '</div>');
                p.push(  '<details style="margin-top:4px;"><summary style="cursor:pointer;color:#57606a;">Resolution notes</summary>');
                p.push(    '<pre style="white-space:pre-wrap;background:#fff;padding:8px;border:1px solid #eee;border-radius:4px;font-size:0.9em;">' + esc(s.close_notes) + '</pre></details>');
                if (s.kb_sys_id) p.push('<div style="margin-top:4px;"><a href="kb_view.do?sysparm_article=' + esc(s.kb_sys_id) + '" target="_blank">View linked KB</a></div>');
                p.push('</div>');
            }
        }
        p.push('<button type="button" id="kbi_refresh_btn" style="margin-top:6px;padding:4px 10px;font-size:0.85em;cursor:pointer;border:1px solid #0969da;background:#fff;color:#0969da;border-radius:4px;">Refresh suggestions</button>');
        return p.join('');
    }
}
