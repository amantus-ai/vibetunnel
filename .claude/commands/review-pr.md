# /review-pr

Perform a comprehensive code review of the current pull request using parallel sub-agents powered by Claude and Gemini, with results intelligently merged.

## Usage

```
/review-pr [options]
```

Options:
- `--focus <area>` - Focus on specific areas. Valid values: `security`, `performance`, `tests`, `architecture`, `documentation`, `all`
- `--gemini-only` - Perform the review only with gemini CLI

## Description

This command performs a thorough code review of the current branch's changes compared to the main branch. It runs two parallel sub-agents - one using Claude and another using Gemini - to perform independent comprehensive reviews. The results from both AI models are then intelligently merged to provide a complete multi-perspective analysis.

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
   - Check if required tools are available: `gh`, `git`, and `gemini`
   - Run `gh pr view` to check PR description and any existing comments (handle errors gracefully)
   - Run `git log "main..HEAD" --oneline` to see all commits in this PR (with proper shell escaping)
   - Run `git diff "main...HEAD" --stat` to get an overview of changed files (with proper shell escaping)
   - Generate comprehensive diff with secure temporary file handling:
     ```bash
     touch .pr_review_diff.tmp && chmod 600 .pr_review_diff.tmp
     git diff "main...HEAD" > .pr_review_diff.tmp
     ```
   - If any git commands fail, provide helpful error messages and guidance

2. **Launch Two Parallel Sub-Agents**

   **Sub-Agent 1: Claude Review**
   - WARNING: This step must be skipped when `--gemini-only` has been passed
   - Performs complete multi-aspect code review using Claude
   - Analyzes all aspects below independently
   
   **Sub-Agent 2: Gemini Review**
   - Runs Gemini CLI following instructions from `docs/gemini.md`
   - Performs complete multi-aspect code review using Gemini
   - Form the prompt to the Gemini CLI in a way that it only returns the final output of its findings, to save tokens
   - Analyzes all aspects below independently
   - Use a timeout of 10 minutes for the gemini CLI command (configurable via environment variable `GEMINI_TIMEOUT_SECONDS`, default: 600)
   - **IMPORTANT**: Gemini CLI can only access files within the project directory
     - Create temporary diff file in project root (e.g., `.pr_review_diff.tmp`)
     - Use `@.pr_review_diff.tmp` syntax to include the diff in Gemini prompt
     - Clean up temporary file after review completes

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
   - Execute `pnpm run check` (for web/) if available
   - Run `./scripts/lint.sh` (for mac/) if the script exists
   - Run `./lint.sh` (for tauri/) if the script exists
   - Check if tests pass with appropriate test commands
   - Verify build succeeds
   - If any checks fail, continue with review but note the failures

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

5. **Cleanup**
   - Remove temporary diff file `.pr_review_diff.tmp` from project root
   - Ensure no sensitive data remains in temporary files

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
- **Intelligent Merging**: Final step combines findings from both AI models by identifying common issues (high confidence), highlighting unique insights, and resolving conflicting assessments
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

## Prerequisites

- Git and GitHub CLI (`gh`) must be installed
- For full functionality: Gemini CLI must be installed (see Gemini documentation)
- For `--gemini-only` mode: Only Gemini CLI is required

## Security Considerations

**Input Sanitization:**
- All user-provided parameters (e.g., `--focus` values) are validated against a whitelist
- Git commands use proper shell escaping with quotes around branch names
- Temporary files are created with secure permissions (mode 600)
- File paths are validated to prevent directory traversal attacks
- The `--focus` parameter only accepts predefined values: security, performance, tests, architecture, documentation, all

**Safe Command Execution:**
```bash
# Always quote branch names and file paths
git diff "main...HEAD" --stat  # Correct
git diff main...HEAD --stat     # Vulnerable to injection

# Set restrictive permissions on temporary files
touch .pr_review_diff.tmp && chmod 600 .pr_review_diff.tmp
git diff "main...HEAD" > .pr_review_diff.tmp
```

## Error Handling

- If required tools are missing, the command will provide installation instructions
- Git command failures are handled gracefully with helpful error messages
- If automated checks fail, the review continues but notes the failures
- Timeout protection: Gemini sub-agent has a 10-minute timeout (configurable via `GEMINI_TIMEOUT_SECONDS` environment variable)

## Implementation Notes

**Gemini CLI File Access:**
- Gemini CLI can only access files within the project directory
- Always save temporary files in the project root with `.tmp` extension
- Use `.gitignore` patterns for temporary files (e.g., `.pr_review_*.tmp`)
- Example workflow:
  ```bash
  # Create file with secure permissions
  touch .pr_review_diff.tmp && chmod 600 .pr_review_diff.tmp
  
  # Save diff to project-accessible location
  git diff "main...HEAD" > .pr_review_diff.tmp
  
  # Use with Gemini
  gemini -p "@.pr_review_diff.tmp Your review prompt here"
  
  # Clean up
  rm -f .pr_review_diff.tmp
  ```

**Handling Large Diffs:**
- For very large PRs, consider splitting the diff by file type or directory
- Use Gemini's 2M token context window advantage for comprehensive analysis
- If diff exceeds reasonable size, suggest breaking PR into smaller chunks

**Chunking Strategy for Diffs Exceeding 1.5M Tokens:**

1. **Automatic splitting by file type:**
   ```bash
   # JavaScript/TypeScript files
   git diff "main...HEAD" -- "*.js" "*.ts" "*.jsx" "*.tsx" > .pr_review_js.tmp
   
   # Python files
   git diff "main...HEAD" -- "*.py" > .pr_review_py.tmp
   
   # Documentation
   git diff "main...HEAD" -- "*.md" "*.rst" "*.txt" > .pr_review_docs.tmp
   ```

2. **Split by directory structure:**
   ```bash
   # Frontend changes
   git diff "main...HEAD" -- "web/src/client/" > .pr_review_frontend.tmp
   
   # Backend changes
   git diff "main...HEAD" -- "web/src/server/" > .pr_review_backend.tmp
   
   # Test changes
   git diff "main...HEAD" -- "**/test/" "**/tests/" > .pr_review_tests.tmp
   ```

3. **Prioritize by change type:**
   ```bash
   # New files (highest priority)
   git diff "main...HEAD" --name-status | grep "^A" | cut -f2 | xargs git diff "main...HEAD" -- > .pr_review_new.tmp
   
   # Modified files
   git diff "main...HEAD" --name-status | grep "^M" | cut -f2 | xargs git diff "main...HEAD" -- > .pr_review_modified.tmp
   
   # Deleted files (lowest priority for review)
   git diff "main...HEAD" --name-status | grep "^D" | cut -f2 > .pr_review_deleted_list.tmp
   ```

4. **Token estimation:**
   - Rough estimate: 1 token ≈ 4 characters
   - Check file size: `wc -c .pr_review_diff.tmp`
   - If > 6MB (≈1.5M tokens), implement chunking strategy