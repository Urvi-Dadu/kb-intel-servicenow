/**
 * Script Action: Story Capture Request Notification
 * Event: x_1158634_kb_int_0.story.capture_request
 *
 * Event params: parm1 = capture sys_id, parm2 = developer sys_id
 */
(function executeAction(event) {
    var captureId = event.parm1 + '';
    var developerId = event.parm2 + '';
    if (!developerId) return;

    var dev = new GlideRecord('sys_user');
    if (!dev.get(developerId) || !dev.getValue('email')) return;

    var cap = new GlideRecord('x_1158634_kb_int_0_dev_capture');
    if (!cap.get(captureId)) return;

    var url = gs.getProperty('glide.servlet.uri') + 'x_1158634_kb_int_0_dev_capture.do?sys_id=' + captureId;
    var subject = '[KB Intelligence] 2-minute brief: ' + (cap.getValue('problem_brief') || '').substring(0, 80);
    var body = [
        'Hi ' + dev.getValue('first_name') + ',',
        '',
        'You closed a story. Please fill the capture form below. The fields you actually changed will be expanded into a KB article. Fields you skipped are skipped in the article too.',
        '',
        url,
        '',
        'You will be credited as the resolver. The Knowledge Manager group reviews and publishes.'
    ].join('\n');

    var mail = new GlideEmailOutbound();
    mail.setSubject(subject);
    mail.setBody(body);
    mail.addAddress('to', dev.getValue('email'));
    mail.save();
})(event);
