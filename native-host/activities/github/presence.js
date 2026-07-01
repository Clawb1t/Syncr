/**
 * Syncr Activity: GitHub
 *
 * Rich presence for github.com and gist.github.com — repositories, issues,
 * pull requests, files, profiles, gists, and global browsing (PreMiD-style).
 */

function truncate(s, max = 128) {
  const str = String(s ?? '').trim();
  if (!str) return '';
  return str.length <= max ? str : `${str.slice(0, max - 1)}…`;
}

function cleanAuthor(raw) {
  return truncate(String(raw ?? '').replace(/\s+/g, ' ').trim());
}

function largeImage(avatarUrl, fallback = 'github_logo') {
  const url = String(avatarUrl ?? '').trim();
  if (url.startsWith('https://') && !/\/u\/?$/.test(url)) return url;
  return fallback;
}

module.exports = {
  id:         'github',
  name:       'GitHub',
  clientId:   '1521997378209714206',
  urlPattern: '*://github.com/*',

  formatPresence(data, syncr) {
    const pageUrl = data.pageUrl?.startsWith('https://') ? data.pageUrl : null;
    const mode      = data.mode || 'browsing';
    const details   = truncate(data.details);
    const state     = truncate(data.state);
    const avatar    = largeImage(data.avatarUrl);

    const builder = syncr.presence()
      .watching('GitHub')
      .largeImage(avatar, 'GitHub')
      .smallStatus('browsing', 'GitHub');

    switch (mode) {
      case 'viewing_profile': {
        const name = data.profileName || 'someone';
        const tab  = data.profileTab;
        builder
          .details(tab ? `Viewing ${name}'s ${tab}` : `Viewing ${name}'s profile`)
          .state(tab ? '' : 'Profile');
        if (pageUrl) builder.button('View Profile', pageUrl);
        break;
      }

      case 'viewing_org':
        builder.details(details || 'Viewing an organization');
        if (state) builder.state(state);
        if (pageUrl) builder.button('View Organization', pageUrl);
        break;

      case 'viewing_org_people':
        builder.details(details || 'Viewing organization');
        if (pageUrl) builder.button('View Organization', pageUrl);
        break;

      case 'viewing_gist':
        builder
          .details(details || 'Browsing gist')
          .state(state || (data.gistName ? `${data.gistName} by ${data.gistOwner}` : ''));
        if (pageUrl) builder.button('View Gist', pageUrl);
        break;

      case 'creating_gist':
        builder.details(details || 'Creating a GitHub gist');
        if (pageUrl) builder.button('Open GitHub', pageUrl);
        break;

      case 'creating_issue':
        builder.details(details || `Creating an issue in ${data.repoFull || 'a repository'}`);
        if (pageUrl) builder.button('View Repository', pageUrl);
        break;

      case 'viewing_issue':
        builder
          .details(details || (data.issueNum ? `Looking at issue #${data.issueNum}` : 'Looking at an issue'))
          .state(state || data.issueTitle || '');
        if (pageUrl) builder.button('View Issue', pageUrl);
        break;

      case 'browsing_issues':
        builder
          .details(details || 'Browsing issues')
          .state(state || data.repoFull || '');
        if (pageUrl) builder.button('View Repository', pageUrl);
        break;

      case 'viewing_pr':
        builder
          .details(details || (data.prNum ? `Looking at pull request #${data.prNum}` : 'Looking at a pull request'))
          .state(state || data.prTitle || '');
        if (pageUrl) builder.button('View Pull Request', pageUrl);
        break;

      case 'browsing_prs':
        builder
          .details(details || 'Browsing pull requests')
          .state(state || data.repoFull || '');
        if (pageUrl) builder.button('View Repository', pageUrl);
        break;

      case 'viewing_discussion':
        builder
          .details(details || 'Looking at a discussion')
          .state(state || '');
        if (pageUrl) builder.button('View Discussion', pageUrl);
        break;

      case 'browsing_discussions':
        builder
          .details(details || 'Browsing discussions in')
          .state(state || data.repoFull || '');
        if (pageUrl) builder.button('View Repository', pageUrl);
        break;

      case 'viewing_file':
        builder
          .details(details || (data.repoFull ? `Browsing repository ${data.repoFull}` : 'Browsing a repository'))
          .state(state || (data.fileName ? `Viewing file ${data.fileName}` : 'Viewing a file'));
        if (pageUrl) builder.button('View File', pageUrl);
        break;

      case 'browsing_folder':
        builder
          .details(details || (data.repoFull ? `Browsing repository ${data.repoFull}` : 'Browsing a repository'))
          .state(state || (data.folderPath ? `In folder ${data.folderPath}` : 'In a folder'));
        if (pageUrl) builder.button('View Repository', pageUrl);
        break;

      case 'browsing_insights':
        builder
          .details(details || (data.repoFull ? `Browsing insights of ${data.repoFull}` : 'Browsing insights'))
          .state(state || 'Insights');
        if (pageUrl) builder.button('View Repository', pageUrl);
        break;

      case 'browsing_repo':
        builder
          .details(details || 'Browsing repository')
          .state(state || data.repoFull || '');
        if (pageUrl) builder.button('View Repository', pageUrl);
        break;

      case 'searching':
        builder
          .details(details || 'Searching for')
          .state(state || data.searchQuery || '');
        if (pageUrl) builder.button('View Search', pageUrl);
        break;

      default:
        builder.details(details || 'Browsing GitHub');
        if (state) builder.state(state);
        if (pageUrl) builder.button('Open GitHub', pageUrl);
        break;
    }

    return builder.build();
  },
};
