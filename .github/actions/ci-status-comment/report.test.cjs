const assert = require('node:assert/strict');
const test = require('node:test');

const { STATUS_MARKER, renderStatusComment, upsertStatusComment } = require('./report.cjs');

test('renders failed jobs and their failing steps', () => {
  const comment = renderStatusComment({
    conclusion: 'failure',
    htmlUrl: 'https://example.test/runs/1',
    jobs: [
      {
        name: 'Node.js CI',
        conclusion: 'failure',
        steps: [
          { name: 'Install', conclusion: 'success' },
          { name: 'Test', conclusion: 'failure' },
        ],
      },
      {
        name: 'Mac CI',
        conclusion: 'success',
        steps: [],
      },
    ],
  });

  assert.equal(
    comment,
    `${STATUS_MARKER}
## ❌ CI Failed

[View failed run](https://example.test/runs/1)

### Failed Jobs:
- **Node.js CI**
  - Failed at: Test`
  );
});

test('renders a passing replacement for a successful rerun', () => {
  const comment = renderStatusComment({
    conclusion: 'success',
    htmlUrl: 'https://example.test/runs/2',
  });

  assert.equal(
    comment,
    `${STATUS_MARKER}
## ✅ CI Passed

[View successful run](https://example.test/runs/2)`
  );
  assert.doesNotMatch(comment, /Failed/);
});

test('does not replace status for an inconclusive run', () => {
  assert.equal(
    renderStatusComment({
      conclusion: 'cancelled',
      htmlUrl: 'https://example.test/runs/3',
    }),
    null
  );
});

test('updates the existing bot status comment after a successful rerun', async () => {
  const calls = [];
  const github = {
    paginate: async () => [
      {
        id: 42,
        user: { login: 'github-actions[bot]' },
        body: `${STATUS_MARKER}\n## ❌ CI Failed`,
      },
    ],
    rest: {
      issues: {
        listComments() {},
        updateComment: async (request) => calls.push(['update', request]),
        createComment: async (request) => calls.push(['create', request]),
      },
    },
  };
  const body = renderStatusComment({
    conclusion: 'success',
    htmlUrl: 'https://example.test/runs/4',
  });

  assert.equal(
    await upsertStatusComment({
      github,
      owner: 'amantus-ai',
      repo: 'vibetunnel',
      issueNumber: 123,
      body,
    }),
    'updated'
  );
  assert.deepEqual(calls, [
    [
      'update',
      {
        owner: 'amantus-ai',
        repo: 'vibetunnel',
        comment_id: 42,
        body,
      },
    ],
  ]);
});

test('creates a status comment when no bot marker exists', async () => {
  const calls = [];
  const github = {
    paginate: async () => [],
    rest: {
      issues: {
        listComments() {},
        updateComment: async (request) => calls.push(['update', request]),
        createComment: async (request) => calls.push(['create', request]),
      },
    },
  };
  const body = renderStatusComment({
    conclusion: 'failure',
    htmlUrl: 'https://example.test/runs/5',
  });

  assert.equal(
    await upsertStatusComment({
      github,
      owner: 'amantus-ai',
      repo: 'vibetunnel',
      issueNumber: 123,
      body,
    }),
    'created'
  );
  assert.deepEqual(calls, [
    [
      'create',
      {
        owner: 'amantus-ai',
        repo: 'vibetunnel',
        issue_number: 123,
        body,
      },
    ],
  ]);
});

test('keeps a first-time successful run silent', async () => {
  const calls = [];
  const github = {
    paginate: async () => [],
    rest: {
      issues: {
        listComments() {},
        updateComment: async (request) => calls.push(['update', request]),
        createComment: async (request) => calls.push(['create', request]),
      },
    },
  };
  const body = renderStatusComment({
    conclusion: 'success',
    htmlUrl: 'https://example.test/runs/6',
  });

  assert.equal(
    await upsertStatusComment({
      github,
      owner: 'amantus-ai',
      repo: 'vibetunnel',
      issueNumber: 123,
      body,
      createIfMissing: false,
    }),
    'unchanged'
  );
  assert.deepEqual(calls, []);
});
