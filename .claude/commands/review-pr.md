# /review-pr

Perform a comprehensive code review of the current pull request using parallel sub-agents powered by Claude and Gemini, with results intelligently merged.

## Usage

```
/review-pr [options]
```

Options:
- `--focus <area>` - Focus on specific areas (security, performance, tests, etc.)
- `--gemini-only` - Perform the review only with gemini CLI

## Description

This command performs a thorough code review of the current branch's changes compared to the main branch. It runs two parallel sub-agents - one using Claude and another using Gemini - to perform independent comprehensive reviews. The results from both AI models are then intelligently merged provide a complete multi-perspective analysis.

## Examples

### Standard PR review
```
/review-pr
```

### Security-focused review
```
/review-pr --focus security
```

### Performance and scalability review
```
/review-pr --focus performance
```

## Implementation

When you use this command, I will:

1. **Initial PR Context Gathering**
   - Run `gh pr view` to check PR description and any existing comments
   - Run `git log main..HEAD --oneline` to see all commits in this PR
   - Run `git diff main...HEAD --stat` to get an overview of changed files
   - Generate comprehensive diff with `git diff main...HEAD` and exact line numbers

2. **Launch Two Parallel Sub-Agents**

   **Sub-Agent 1: Claude Review**
   - WARNING: This skep must be skipped when `--gemini-only` has been passed
   - Performs complete multi-aspect code review using Claude
   - Analyzes all aspects below independently
   
   **Sub-Agent 2: Gemini Review**
   - Runs Gemini CLI following instructions from `docs/gemini.md`
   - Performs complete multi-aspect code review using Gemini
   - Form the prompt to the Gemini CLI in a way that it only returns the final output of its findings, to save tokens
   - Analyzes all aspects below independently
   - Use a timeout of 10 minutes for the gemini CLI command

   **Both sub-agents analyze:**

   **Correctness & Logic**
   - Verify the code solves the intended problem
   - Check for edge cases, off-by-one errors, null/undefined handling
   - Validate business logic and algorithm correctness
   
   **Code Quality & Architecture**
   - Check adherence to DRY and SOLID principles
   - Assess function/class complexity and cohesion
   - Verify consistent naming conventions and code style
   - Ensure changes align with existing architecture patterns
   
   **Performance & Scalability**
   - Identify O(n²) algorithms that could be O(n)
   - Check for N+1 database queries
   - Look for memory leaks or excessive allocations
   - Identify missed caching opportunities
   
   **Security**
   - Check for SQL injection vulnerabilities
   - Identify XSS vulnerabilities
   - Verify authentication/authorization checks
   - Ensure no sensitive data in logs or commits
   - Validate all user inputs are sanitized
   
   **Testing**
   - Verify test coverage for new/modified code
   - Check if tests actually test the right behavior
   - Ensure edge cases are covered
   - Assess test maintainability and brittleness
   
   **Error Handling**
   - Verify errors are properly caught and handled
   - Check error messages are helpful for debugging
   - Ensure appropriate logging levels
   - Validate graceful failure modes
   
   **Documentation**
   - Check if complex logic is explained
   - Verify API documentation is updated
   - Look for outdated or misleading comments
   - Ensure README/docs are updated if needed

   **Automated Checks**
   - Execute `pnpm run lint` and `pnpm run typecheck` (for web/)
   - Run `./scripts/lint.sh` (for mac/)
   - Check if tests pass with appropriate test commands
   - Verify build succeeds

3. **Merge Results**
   - Intelligently combine findings from both Claude and Gemini
   - Identify common issues found by both models (high confidence)
   - Highlight unique insights from each model
   - Resolve any conflicting assessments
   - Generate unified severity ratings

4. **Generate Final Review Report**
   - Provide a structured review with:
     - **Summary**: High-level overview of changes
     - **Strengths**: What's done well
     - **Critical Issues**: Must-fix problems with exact line numbers
     - **Suggestions**: Nice-to-have improvements with exact line numbers
     - **Questions**: Clarifications needed with exact line numbers
   - Use accountability mindset - I'm as responsible as the author
   - Provide constructive, mentoring-oriented feedback
   - **CRITICAL**: Always include exact line numbers for every issue found
   - Use format: `filename:line_number` (e.g., `src/server.ts:142`)
   - For multi-line issues, use ranges: `filename:start_line-end_line`

## Review Checklist

### ✅ Shared Accountability
- [ ] I understand I share responsibility for this code once approved
- [ ] I've reviewed with the same care as if I wrote it

### 🎯 Functionality
- [ ] Code implements intended functionality
- [ ] Edge cases and error scenarios handled
- [ ] No regressions introduced

### 🏗️ Architecture & Design
- [ ] Changes align with system architecture
- [ ] Scalability and maintainability considered
- [ ] Design patterns appropriately used

### 🔒 Security
- [ ] Input validation present
- [ ] Authentication/authorization correct
- [ ] No sensitive data exposed
- [ ] Dependencies are secure

### ⚡ Performance
- [ ] No unnecessary database queries
- [ ] Efficient algorithms used
- [ ] Resource usage is reasonable
- [ ] Caching utilized where appropriate

### 🧪 Testing
- [ ] Adequate test coverage
- [ ] Tests are meaningful, not just coverage
- [ ] Edge cases tested
- [ ] Tests are maintainable

### 📝 Code Quality
- [ ] Code is DRY
- [ ] SOLID principles followed
- [ ] Clear naming and structure
- [ ] Appropriate comments/documentation

### 🔄 Backwards Compatibility
- [ ] API changes are backwards compatible
- [ ] Database migrations handled properly
- [ ] No breaking changes without discussion

## Note

This command emphasizes:
- **Parallel Sub-Agent Architecture**: Two independent sub-agents perform complete reviews - one using Claude, another using Gemini CLI
- **Integration**: Final step uses to intelligently merge findings from both AI models
- **Accountability**: Approving means you own the outcome
- **Mentorship**: Every comment is a teaching opportunity
- **Thoroughness**: Multiple passes from different angles by both AI models
- **Actionability**: Specific, clear feedback with examples
- **Precision**: Every issue must include exact line numbers

**Line Number Format Examples:**
- Single line issue: `src/server/auth.ts:234`
- Multi-line issue: `src/client/app.ts:45-52`
- Context reference: `src/utils/helpers.ts:78 (similar pattern at lines 95, 112)`

**Sub-Agent Execution:**
- Claude sub-agent performs the review using Claude's capabilities
- Gemini sub-agent runs the Gemini CLI following instructions from `docs/gemini.md`
- Both sub-agents work in parallel for efficiency

For large PRs, consider reviewing incrementally and suggesting the author break it into smaller PRs for more effective review.