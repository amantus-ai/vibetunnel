# Claude CLI Usage Guide

The Claude CLI is a powerful command-line interface for interacting with Claude. This guide covers basic usage, advanced features, and important considerations when using Claude as an agent.

## Installation

```bash
# Install via npm
npm install -g @anthropic/claude-cli

# Or use directly with npx
npx @anthropic/claude-cli
```

## Basic Usage

### Recommended: Use VibeTunnel for Better Visibility

When working within VibeTunnel, use `vt claude` instead of `claude` directly. This provides better visibility into what Claude is doing:

```bash
# Use vt claude for better monitoring
vt claude "What is the capital of France?"

# VibeTunnel will show Claude's activities in real-time
vt claude -f src/*.js "Refactor this code"
```

### One-Shot Prompts

```bash
# Simple question
vt claude "What is the capital of France?"

# Multi-line prompt with quotes
vt claude "Explain the following code:
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}"
```

### Input Methods

```bash
# Pipe input from another command
echo "Hello, world!" | vt claude "Translate this to Spanish"

# Read prompt from file
vt claude < prompt.txt

# Use heredoc for complex prompts
vt claude << 'EOF'
Analyze this SQL query for performance issues:
SELECT * FROM users WHERE created_at > '2023-01-01'
EOF
```

### File Context

```bash
# Single file context
vt claude -f script.js "Explain what this script does"

# Multiple files
vt claude -f src/*.js -f tests/*.test.js "Find potential bugs"

# With explicit file references
vt claude -f config.json -f app.js "How does the app use the config?"
```

## Advanced Features

### Timeout Considerations

⏱️ **Important**: Claude can be slow but thorough. When calling Claude from scripts or other tools, **set a timeout of more than 10 minutes**:

```bash
# Example: Using timeout command
timeout 900s vt claude -f "*.js" "Refactor this codebase"

# Example: In a Python script
subprocess.run(['vt', 'claude', 'analyze this'], timeout=900)

# Example: In a Node.js script
await exec('vt claude "complex task"', { timeout: 900000 })  // milliseconds
```

Claude may take time to:
- Analyze large codebases thoroughly
- Consider multiple approaches before responding
- Verify its suggestions are correct
- Generate comprehensive solutions

**Note**: Claude itself has no built-in timeout mechanism. The calling process must implement timeout handling.

⚠️ **Critical**: Even if a timeout occurs, Claude may have already modified multiple files before being interrupted. After any Claude invocation (successful or timed out):

1. **Re-read all files** that were passed to Claude
2. **Check related files** that Claude might have modified (imports, dependencies, tests)
3. **Use version control** to see what changed: `git status` and `git diff`
4. **Never assume** the operation failed completely - partial changes are common

```bash
# Example: Safe Claude invocation pattern
git add -A  # Stage current state
timeout 900s vt claude -f src/*.js "Refactor error handling" || true
git status  # See what changed
git diff    # Review all modifications

# In scripts: Always check for changes
vt claude -f config.json "Update settings" || echo "Claude timed out"
# Still need to check if config.json was modified!
```

### Environment Variables

```bash
# Set API key
export ANTHROPIC_API_KEY="your-key-here"

# Set model (if supported)
export CLAUDE_MODEL="claude-3-opus-20240229"

```

### Output Formatting

```bash
# Save response to file
vt claude "Write a Python hello world" > hello.py

# Append to file
vt claude "Add error handling" >> hello.py

# Process output with other tools
vt claude "List 10 programming languages" | grep -i python
```

### Interactive Mode

```bash
# Start interactive session
vt claude -i

# With initial context
vt claude -i -f project.md "Let's work on this project"
```

## Important Considerations: Claude as an Agent

⚠️ **Critical Understanding**: Claude is an intelligent agent that aims to be helpful and thorough. This means:

### Default Behavior

When you use Claude via CLI, it will:
- **Analyze the full context** of your request
- **Make reasonable inferences** about what you need
- **Perform additional helpful actions** beyond the literal request
- **Verify and validate** its work
- **Provide explanations** and context

### Example of Agent Behavior

```bash
# What you ask:
vt claude -f buggy.js "Fix the syntax error on line 5"

# What Claude might do:
# 1. Fix the syntax error on line 5
# 2. Notice and fix other syntax errors
# 3. Identify potential bugs
# 4. Suggest better practices
# 5. Format the code
# 6. Add helpful comments
```

### Controlling Agent Behavior

If you need Claude to perform **ONLY** specific actions without additional help:

#### Strict Mode Prompting

```bash
# Explicit constraints
vt claude -f config.json "Change ONLY the 'port' value to 8080. 
Make NO other changes. 
Do NOT fix any other issues you might notice.
Do NOT add comments or formatting.
Output ONLY the modified line."

# Surgical edits
vt claude -f script.sh "Replace EXACTLY the string 'localhost' with '0.0.0.0' on line 23.
Make NO other modifications to the file.
Do NOT analyze or improve the script."
```

#### Best Practices for Strict Operations

1. **Be explicit about constraints**:
   ```bash
   vt claude "List EXACTLY 3 items. No more, no less. No explanations."
   ```

2. **Use precise language**:
   ```bash
   # Instead of: "Fix the typo"
   # Use: "Change 'recieve' to 'receive' on line 42 ONLY"
   ```

3. **Specify output format**:
   ```bash
   vt claude "Output ONLY valid JSON, no markdown formatting, no explanations"
   ```

4. **Chain commands for control**:
   ```bash
   # Use grep/sed for deterministic edits instead of Claude
   vt claude -f file.py "Find the typo" | grep -n "recieve"
   sed -i 's/recieve/receive/g' file.py
   ```

## Use Cases

### When to Use Claude's Agent Capabilities

- **Code review**: Let Claude analyze thoroughly
- **Debugging**: Benefit from comprehensive analysis
- **Learning**: Get detailed explanations
- **Refactoring**: Allow intelligent improvements

### When to Constrain Claude

- **CI/CD pipelines**: Need deterministic behavior
- **Automated scripts**: Require predictable outputs
- **Specific edits**: Want surgical precision
- **Integration with other tools**: Need exact output formats

## Examples

### Development Workflow

```bash
# Let Claude be helpful (default)
vt claude -f app.js -f test.js "Add error handling"

# Constrained for automation
vt claude -f config.yml "Output ONLY the value of 'database.host'. No formatting." > db_host.txt
```

### Script Integration

```bash
#!/bin/bash
# Get exactly what you need
PORT=$(vt claude -f config.json "Print ONLY the port number. Nothing else.")
echo "Server will run on port: $PORT"
```

## Tips

1. **Test first**: Always test Claude's behavior before using in automation
2. **Be explicit**: Over-specify when you need exact behavior
3. **Use version control**: Claude might make helpful changes you didn't expect
4. **Review outputs**: Especially in automated workflows
5. **Leverage intelligence**: Don't over-constrain when you want smart help

## Command Reference

```bash
vt claude --help              # Show all options
vt claude --version          # Show version
vt claude -f FILE            # Include file context
vt claude -i                 # Interactive mode
vt claude --no-markdown      # Disable markdown formatting
vt claude --json             # JSON output (if supported)
```

**Note**: When not using VibeTunnel, replace `vt claude` with just `claude` in all commands above.

Remember: Claude is designed to be a helpful assistant. This is usually what you want, but sometimes you need precise, limited actions. Plan accordingly!