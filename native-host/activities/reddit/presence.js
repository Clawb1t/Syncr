/**
 * Syncr Activity: Reddit
 *
 * Uses Discord activity type 3 (Watching) with post title, subreddit,
 * author, score, and comment count. Two buttons: post and subreddit.
 */

function formatScore(raw) {
  const n = parseInt(String(raw).replace(/,/g, ''), 10);
  if (Number.isNaN(n)) return String(raw || '');
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000)    return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function formatPostType(type) {
  if (!type) return '';
  const labels = { link: 'Link', image: 'Image', video: 'Video', gallery: 'Gallery', crosspost: 'Crosspost' };
  return labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

module.exports = {
  id:         'reddit',
  name:       'Reddit',
  clientId:   '1521817709388759101',
  urlPattern: '*://www.reddit.com/*',

  formatPresence({
    browsing, browsingContext,
    title, author, authorUrl, subreddit, subredditUrl,
    score, comments, postType, thumbnailUrl, pageUrl,
  }, syncr) {
    if (browsing) {
      const ctx = browsingContext && browsingContext !== 'Home'
        ? browsingContext
        : null;
      return syncr.browsing({
        type:    syncr.ActivityType.Watching,
        name:    'Reddit',
        logo:    'reddit_logo',
        details: ctx ? `Browsing ${ctx}` : 'Browsing Reddit',
      });
    }

    const postTitle = title || 'Unknown Post';
    const sub       = subreddit || 'Reddit';
    const authorTag = author ? `u/${author.replace(/^u\//, '')}` : '';

    const detailsParts = [sub];
    if (authorTag) detailsParts.push(authorTag);

    const stateParts = [];
    if (score)     stateParts.push(`↑ ${formatScore(score)}`);
    if (comments)  stateParts.push(`${comments} comment${comments === '1' ? '' : 's'}`);
    const typeLabel = formatPostType(postType);
    if (typeLabel) stateParts.push(typeLabel);

    const builder = syncr.presence()
      .watching(postTitle)
      .details(detailsParts.join(' · '))
      .state(stateParts.join(' · ') || 'Reading')
      .largeImage(thumbnailUrl || 'reddit_logo', postTitle)
      .smallStatus('reading', 'Reading');

    if (pageUrl?.startsWith('https://')) {
      builder.button('View Post', pageUrl);
    }
    if (subredditUrl?.startsWith('https://')) {
      builder.button('View Subreddit', subredditUrl);
    } else if (authorUrl?.startsWith('https://')) {
      builder.button('View Profile', authorUrl);
    }

    return builder.build();
  },
};
