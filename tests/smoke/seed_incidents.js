/**
 * Seed: 200 closed incidents with realistic resolution notes
 *
 * Paste into System Definition > Scripts - Background. Idempotency: not
 * checked; rerun creates additional 200 rows. Use only on PDI or non-prod.
 */
var samples = [
    { sd: "Outlook will not connect to Exchange after VPN disconnect", res: "Cleared cached credentials in Credential Manager. Reconnected VPN before launching Outlook. Issue resolved.", cat: "software" },
    { sd: "MID Server stuck in Down state after restart", res: "Restarted MID Server service via services.msc. Verified outbound 443 to instance. Status went Up within 2 minutes.", cat: "software" },
    { sd: "User cannot access Service Portal, 403 forbidden", res: "User missing snc_internal role. Granted via sys_user_has_role. Logged out and back in.", cat: "inquiry" },
    { sd: "SAML login redirect loop on production instance", res: "IdP certificate had expired. Rotated cert in sys_properties.list (saml2.sp.cert). Tested login, working.", cat: "network" },
    { sd: "Scheduled job Data Export has not run for 3 days", res: "Job was on a node that crashed. Verified node status, reassigned job to active node, ran on demand to backfill.", cat: "software" }
];

for (var i = 0; i < 200; i++) {
    var s = samples[i % samples.length];
    var gr = new GlideRecord('incident');
    gr.initialize();
    gr.setValue('short_description', s.sd + ' (#' + i + ')');
    gr.setValue('description', s.sd + '. Reported by user via portal.');
    gr.setValue('close_notes', s.res);
    gr.setValue('category', s.cat);
    gr.setValue('state', 7);
    gr.setValue('incident_state', 7);
    gr.setValue('close_code', 'Solved (Permanently)');
    gr.setValue('resolved_at', gs.daysAgo(Math.floor(Math.random() * 180)));
    gr.insert();
}
gs.print('seeded 200 incidents');
