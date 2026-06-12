const assert = require('node:assert/strict');
const test = require('node:test');

const { renderSection, upsertSection } = require('./comment-body.cjs');

test('replaces a failed section with a passing result', () => {
  const existingBody = `## Code Quality Report
<!-- lint-results -->

### Node.js Build ✅ **Status**: Passed

### Node.js Tests ❌ **Status**: Failed

<details>
<summary>Click to see details</summary>

\`\`\`
test failure
\`\`\`

</details>

### Node.js Security Audit ✅ **Status**: Passed`;

  const section = renderSection({
    title: 'Node.js Tests',
    result: 'success',
    output: 'No output',
  });

  assert.equal(
    upsertSection(existingBody, 'Node.js Tests', section),
    `## Code Quality Report
<!-- lint-results -->

### Node.js Build ✅ **Status**: Passed

### Node.js Tests ✅ **Status**: Passed

### Node.js Security Audit ✅ **Status**: Passed`
  );
});

test('replaces a passing section with failure details', () => {
  const existingBody = `Header

### Node.js Tests ✅ **Status**: Passed`;
  const section = renderSection({
    title: 'Node.js Tests',
    result: 'failure',
    output: 'one test failed',
  });

  const updatedBody = upsertSection(existingBody, 'Node.js Tests', section);

  assert.match(updatedBody, /### Node\.js Tests ❌ \*\*Status\*\*: Failed/);
  assert.match(updatedBody, /one test failed/);
  assert.doesNotMatch(updatedBody, /Passed/);
});

test('keeps Markdown headings contained in failure output', () => {
  const existingBody = `Header

### Node.js Tests ❌ **Status**: Failed

<details>
<summary>Click to see details</summary>

\`\`\`
### diagnostic heading
\`\`\`

</details>

### Node.js Security Audit ✅ **Status**: Passed`;
  const section = renderSection({
    title: 'Node.js Tests',
    result: 'success',
    output: 'No output',
  });

  assert.equal(
    upsertSection(existingBody, 'Node.js Tests', section),
    `Header

### Node.js Tests ✅ **Status**: Passed

### Node.js Security Audit ✅ **Status**: Passed`
  );
});

test('does not replace a section whose title only shares a prefix', () => {
  const existingBody = `Header

### Node.js Tests Extended ✅ **Status**: Passed`;
  const section = renderSection({
    title: 'Node.js Tests',
    result: 'success',
    output: 'No output',
  });

  const updatedBody = upsertSection(existingBody, 'Node.js Tests', section);

  assert.match(updatedBody, /### Node\.js Tests Extended ✅/);
  assert.match(updatedBody, /### Node\.js Tests ✅/);
});

test('appends a missing section', () => {
  const section = renderSection({
    title: 'Mac Linting',
    result: 'success',
    output: 'No output',
  });

  assert.equal(
    upsertSection('Header\n', 'Mac Linting', section),
    'Header\n\n### Mac Linting ✅ **Status**: Passed'
  );
});

test('renders successful coverage output without details', () => {
  const section = renderSection({
    title: 'Node.js Test Coverage',
    result: 'success',
    output: 'Lines: 42%',
  });

  assert.equal(
    section,
    `### Node.js Test Coverage ✅ **Status**: Passed

Lines: 42%`
  );
});
