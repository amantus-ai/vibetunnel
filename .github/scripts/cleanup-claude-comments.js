#!/usr/bin/env node

/**
 * Script to clean up multiple Claude bot comments on a PR
 * Keeps only the most recent successful review and collapses others
 */

async function cleanupClaudeComments({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issue_number = context.issue.number;

  try {
    // Get all comments on the PR
    const allComments = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data } = await github.rest.issues.listComments({
        owner,
        repo,
        issue_number,
        per_page: 100,
        page
      });

      allComments.push(...data);
      hasMore = data.length === 100;
      page++;
    }

    // Filter Claude bot comments
    const claudeComments = allComments
      .filter(comment => 
        comment.user.login === 'claude[bot]' || 
        comment.user.login === 'claude' ||
        (comment.user.type === 'Bot' && comment.body.includes('Claude'))
      )
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (claudeComments.length <= 1) {
      core.info(`Found ${claudeComments.length} Claude comments, no cleanup needed`);
      return;
    }

    core.info(`Found ${claudeComments.length} Claude comments, cleaning up...`);

    // Categorize comments
    const successfulReviews = [];
    const errorComments = [];
    const statusComments = [];

    for (const comment of claudeComments) {
      if (comment.body.includes('Claude finished') && comment.body.includes('## 📋 Summary')) {
        successfulReviews.push(comment);
      } else if (comment.body.includes('Claude encountered an error')) {
        errorComments.push(comment);
      } else if (comment.body.includes('Claude Code is analyzing')) {
        statusComments.push(comment);
      }
    }

    // Keep the most recent successful review visible
    const commentsToCollapse = [];
    let keptReview = false;

    if (successfulReviews.length > 0) {
      // Keep the first (most recent) successful review
      keptReview = true;
      commentsToCollapse.push(...successfulReviews.slice(1));
    }

    // Collapse all error and status comments
    commentsToCollapse.push(...errorComments, ...statusComments);

    // If no successful review, keep the most recent comment of any type
    if (!keptReview && claudeComments.length > 0) {
      commentsToCollapse.push(...claudeComments.slice(1));
    }

    // Process comments to collapse
    for (const comment of commentsToCollapse) {
      try {
        const timestamp = new Date(comment.created_at).toLocaleString();
        const commentType = 
          comment.body.includes('encountered an error') ? 'error' :
          comment.body.includes('is analyzing') ? 'status' :
          comment.body.includes('finished') ? 'review' : 'comment';

        // Collapse the comment
        await github.rest.issues.updateComment({
          owner,
          repo,
          comment_id: comment.id,
          body: `<details><summary>Claude ${commentType} from ${timestamp} (outdated - click to expand)</summary>\n\n${comment.body}\n</details>`
        });

        core.info(`Collapsed Claude ${commentType} comment ${comment.id} from ${timestamp}`);
      } catch (error) {
        // If update fails, try to delete (might not have permission)
        try {
          await github.rest.issues.deleteComment({
            owner,
            repo,
            comment_id: comment.id
          });
          core.info(`Deleted Claude comment ${comment.id}`);
        } catch (deleteError) {
          core.warning(`Failed to update or delete comment ${comment.id}: ${error.message}`);
        }
      }
    }

    core.info(`Cleanup complete. Collapsed ${commentsToCollapse.length} comments`);

  } catch (error) {
    core.error(`Failed to cleanup Claude comments: ${error.message}`);
    throw error;
  }
}

// Export for use in GitHub Actions
module.exports = cleanupClaudeComments;