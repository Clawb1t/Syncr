/**
 * Syncr Activity: Proton Mail
 *
 * Privacy-first — only generic activity labels are shown.
 * No subjects, senders, recipients, or message content.
 */

module.exports = {
  id:         'proton-mail',
  name:       'Proton Mail',
  clientId:   '1522106123456789012',
  urlPattern: '*://mail.proton.me/*',

  formatPresence({ mode, context, pageUrl }, syncr) {
    const label = context || 'Browsing emails';

    const builder = syncr.presence()
      .watching('Proton Mail')
      .details(label)
      .state(mode === 'drafting' ? 'Composing' : mode === 'viewing' ? 'Reading' : 'In mailbox')
      .largeImage('proton_mail_logo', 'Proton Mail')
      .smallStatus('mail', 'Proton Mail');

    const openUrl = pageUrl?.startsWith('https://') ? pageUrl : 'https://mail.proton.me/';
    builder.button('Open Proton Mail', openUrl);

    return builder.build();
  },
};
