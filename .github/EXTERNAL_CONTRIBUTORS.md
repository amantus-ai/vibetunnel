# External Contributor CI Permissions

This document explains how our CI handles pull requests from external contributors (forks).

## Background

When external contributors submit PRs from forked repositories, GitHub restricts certain permissions for security reasons. This means actions that require write permissions (like posting comments) will fail.

## Our Approach

We've implemented graceful handling of these permission restrictions:

1. **Detection**: CI workflows detect when a PR is from a fork
2. **Graceful Failure**: Actions that require write permissions use `continue-on-error: true`
3. **Skip When Appropriate**: Some workflows skip entirely for external contributors
4. **Clear Logging**: We log when actions are skipped due to permissions

## Affected Workflows

### Lint Reporter (`/.github/actions/lint-reporter/`)
- Posts code quality reports as PR comments
- Uses `continue-on-error: true` on all comment-related steps
- Logs when running from a fork

### Claude Code Review (`/.github/workflows/claude-code-review.yml`)
- Runs AI-powered code reviews
- Skips entirely for PRs from forks (requires API keys)
- Checks permissions before attempting to run

## For External Contributors

If you're submitting a PR from a fork:
- Your code will still be tested and validated
- Some automated comments (linting reports, AI reviews) won't appear
- This is normal and expected - your PR will still be reviewed by maintainers
- All test results are still visible in the GitHub Actions tab

## For Maintainers

When reviewing PRs from external contributors:
- Check the Actions tab for test results (since automated comments may not appear)
- Run local linting/tests if needed
- Consider manually running Claude review after merge if desired

## Implementation Details

Key patterns used in our workflows:

```yaml
# Check if PR is from a fork
- name: Check permissions
  id: check-permissions
  run: |
    if [[ "${{ github.event.pull_request.head.repo.full_name }}" != "${{ github.repository }}" ]]; then
      echo "is_fork=true" >> $GITHUB_OUTPUT
    else
      echo "is_fork=false" >> $GITHUB_OUTPUT
    fi

# Use continue-on-error for steps that might fail due to permissions
- name: Post comment
  continue-on-error: true
  uses: some-action-that-posts-comments@v1
```

This approach ensures CI never fails solely due to permission issues while still providing full functionality for contributors with write access.