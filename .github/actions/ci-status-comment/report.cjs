const STATUS_MARKER = '<!-- vibetunnel-ci-status -->';

function renderFailureReport(htmlUrl, jobs) {
  const lines = [
    STATUS_MARKER,
    '## ❌ CI Failed',
    '',
    `[View failed run](${htmlUrl})`,
    '',
    '### Failed Jobs:',
  ];

  for (const job of jobs.filter((candidate) => candidate.conclusion === 'failure')) {
    lines.push(`- **${job.name}**`);
    const failedStep = job.steps?.find((step) => step.conclusion === 'failure');
    if (failedStep) {
      lines.push(`  - Failed at: ${failedStep.name}`);
    }
  }

  return lines.join('\n');
}

function renderStatusComment({ conclusion, htmlUrl, jobs = [] }) {
  if (conclusion === 'failure') {
    return renderFailureReport(htmlUrl, jobs);
  }

  if (conclusion === 'success') {
    return [
      STATUS_MARKER,
      '## ✅ CI Passed',
      '',
      `[View successful run](${htmlUrl})`,
    ].join('\n');
  }

  return null;
}

async function upsertStatusComment({
  github,
  owner,
  repo,
  issueNumber,
  body,
  createIfMissing = true,
}) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  const existingComment = comments.find(
    (comment) =>
      comment.user?.login === 'github-actions[bot]' && comment.body?.includes(STATUS_MARKER)
  );

  if (existingComment) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body,
    });
    return 'updated';
  }

  if (!createIfMissing) {
    return 'unchanged';
  }

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
  return 'created';
}

module.exports = {
  STATUS_MARKER,
  renderStatusComment,
  upsertStatusComment,
};
