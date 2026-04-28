/**
 * Script Action: KB Draft Created Notification
 * Event: x_1158634_kb_int_0.draft.created
 *
 * Event params: parm1 = draft sys_id, parm2 = source kind
 */
(function executeAction(event) {
    var draftId = event.parm1 + '';
    var kind = event.parm2 + '';

    var draft = new GlideRecord('x_1158634_kb_int_0_kb_draft');
    if (!draft.get(draftId)) return;

    var groupId = gs.getProperty('x_1158634_kb_int_0.knowledge_manager_group');
    if (!groupId) {
        gs.warn('draft_created_notify: knowledge_manager_group property unset');
        return;
    }

    var members = new GlideRecord('sys_user_grmember');
    members.addQuery('group', groupId);
    members.query();
    var emails = [];
    while (members.next()) {
        var u = new GlideRecord('sys_user');
        if (u.get(members.getValue('user')) && u.getValue('email')) emails.push(u.getValue('email'));
    }
    if (!emails.length) { gs.warn('draft_created_notify: no member emails'); return; }

    var url = gs.getProperty('glide.servlet.uri') + 'x_1158634_kb_int_0_kb_draft.do?sys_id=' + draftId;
    var subject = '[KB Intelligence] New ' + kind + '-sourced draft for review: ' + draft.getValue('title');
    var body = [
        'New KB draft generated. Knowledge Manager review required.',
        '',
        'Source: ' + kind,
        'Title: ' + draft.getValue('title'),
        'Summary: ' + draft.getValue('summary'),
        '',
        url
    ].join('\n');

    var mail = new GlideEmailOutbound();
    mail.setSubject(subject);
    mail.setBody(body);
    emails.forEach(function(e) { mail.addAddress('to', e); });
    mail.save();
})(event);
