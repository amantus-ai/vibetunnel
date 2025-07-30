# RepoPrompt Pair Programming Guide

RepoPrompt is a powerful MCP (Model Context Protocol) server that enables sophisticated AI pair programming workflows. This guide explains how to use RepoPrompt with Claude Code for complex development tasks.

## Overview

The pair programming mode allows Claude Code to collaborate with other AI models (like OpenAI's O1/O3 or Google's Gemini) by:
- Claude Code acts as a **context manager** - gathering files, managing tokens, and handling tools
- Another AI model acts as the **planner/executor** - providing deep reasoning and implementation
- Both models work together continuously throughout the task

## Key Benefits

1. **Leverages Model Strengths**: Claude excels at tool use and navigation; reasoning models excel at complex problem-solving
2. **Optimal Context Management**: Reasoning models work best with complete context upfront rather than incremental discovery
3. **Continuous Collaboration**: Maintains conversation state and file context between messages
4. **Higher Quality Output**: More considered implementations for complex tasks

## Installation

### Prerequisites
- Claude Code with MCP support
- RepoPrompt MCP server installed

### Quick Setup
```bash
# Install RepoPrompt if not already installed
claude mcp add RepoPrompt -- /path/to/repoprompt_cli

# Verify installation
claude mcp list

# Restart Claude Code to load the server
# Use Cmd+R or restart from command line
```

## Basic Workflow

### 1. Select Your Working Files

First, identify and select files relevant to your task:

```
# List current selection
manage_selection action="list" include_stats=true

# Add specific files
manage_selection action="add" paths=["src/main.ts", "src/utils.ts", "tests/main.test.ts"]

# Or replace entire selection
manage_selection action="replace" paths=["src/auth/login.ts", "src/auth/session.ts"]

# Clear selection to start fresh
manage_selection action="clear"
```

**Tips:**
- Keep total context under 100K tokens (ideally ~60K)
- Select only directly relevant files
- Use `get_code_structure` to preview large files efficiently

### 2. Set Your Task Description

Write a clear prompt describing what you want to accomplish:

```
set_prompt_state prompt="Implement user authentication with JWT tokens, including login, logout, and session management"
```

### 3. Start the Pair Programming Session

Begin with planning mode to have the AI create a detailed implementation plan:

```
chat_send mode="plan" message="Let's implement the authentication system as described"
```

### 4. Execute the Plan

Switch to edit mode to implement the changes:

```
chat_send mode="edit" message="Now let's implement the authentication module"
```

## Advanced Features

### File Discovery Workflow

Before starting, use these tools to find relevant files:

```
# Get project structure
get_file_tree type="files"

# Search for specific patterns
search pattern="authentication" mode="both"

# Preview file structure without full content
get_code_structure paths=["src/auth.ts", "src/server.ts"]

# Read specific files
read_file path="src/config/auth.config.ts"
```

### Context Management Strategy

1. **Start Minimal**: Begin with core files only
2. **Add Dependencies**: Include related files as needed
3. **Monitor Token Count**: Check with `manage_selection action="list" include_stats=true`
4. **Update Between Tasks**: Use `replace` when switching focus

### Working with Multiple Models

RepoPrompt supports various AI models. List available presets:

```
list_models
```

Choose a specific model for your task:

```
chat_send mode="plan" model="DeepAnalysis" message="Analyze our authentication architecture"
```

## Practical Examples

### Example 1: Adding a New Feature

```
# 1. Clear previous context
manage_selection action="clear"

# 2. Find relevant files
search pattern="session manager" mode="both"

# 3. Select core files
manage_selection action="add" paths=["src/session-manager.ts", "src/types/session.ts", "tests/session.test.ts"]

# 4. Set the task
set_prompt_state prompt="Add session expiration and automatic cleanup features"

# 5. Plan the implementation
chat_send mode="plan" message="Design session expiration system with configurable timeouts"

# 6. Execute the plan
chat_send mode="edit" message="Implement the session expiration features"
```

### Example 2: Debugging Complex Issues

```
# 1. Gather error context
search pattern="error.*websocket" mode="content"

# 2. Select relevant files
manage_selection action="replace" paths=["src/websocket.ts", "src/error-handler.ts", "logs/recent-errors.log"]

# 3. Describe the issue
set_prompt_state prompt="WebSocket connections dropping intermittently under high load"

# 4. Analyze with reasoning model
chat_send mode="plan" message="Investigate and fix WebSocket stability issues"
```

### Example 3: Refactoring

```
# 1. Select files to refactor
manage_selection action="add" paths=["src/old-api.ts", "src/handlers/*.ts"]

# 2. Set refactoring goals
set_prompt_state prompt="Refactor API to use async/await instead of callbacks, maintain backward compatibility"

# 3. Plan the refactor
chat_send mode="plan" message="Create refactoring plan preserving all existing functionality"

# 4. Execute incrementally
chat_send mode="edit" message="Start refactoring the authentication handlers"
```

## Best Practices

### 1. Context Selection
- Start with minimal context and add as needed
- Include test files when modifying code
- Add configuration files for system-wide changes
- Remove files that are no longer relevant

### 2. Prompt Writing
- Be specific about requirements
- Include constraints (e.g., "maintain backward compatibility")
- Mention relevant technologies and patterns
- Specify testing requirements

### 3. Mode Selection
- Use `plan` mode for:
  - Complex architectural decisions
  - Multi-file refactoring
  - New feature design
  
- Use `edit` mode for:
  - Direct implementation
  - Bug fixes with clear solutions
  - Following an established plan

- Use `chat` mode for:
  - General discussions
  - Code exploration
  - Understanding existing code

### 4. Session Management
- Continue existing chats for related work:
  ```
  chat_tools action="list"
  chat_send chat_id="existing-id" message="Continue the refactoring"
  ```
- Start new chats for unrelated tasks
- Name your chats for easy identification:
  ```
  chat_send new_chat=true chat_name="Auth System Refactor" message="Starting auth refactor"
  ```

## Troubleshooting

### Common Issues

1. **Token Limit Exceeded**
   - Check current usage: `manage_selection action="list" include_stats=true`
   - Remove unnecessary files: `manage_selection action="remove" paths=["large-file.ts"]`
   - Use code structure instead of full content for large files

2. **Model Not Responding**
   - Reasoning models can be slow, especially on complex tasks
   - Wait for completion before sending follow-up messages
   - Consider breaking large tasks into smaller chunks

3. **Context Lost Between Messages**
   - Ensure you're continuing the same chat session
   - Verify file selection hasn't changed: `manage_selection action="list"`
   - Check chat history: `chat_tools action="log"`

4. **Edit Mode Not Working**
   - Ensure you have write permissions for target files
   - Verify files exist and are selected
   - Check for syntax errors in previous edits

### Getting Help

- Use `chat_tools action="log"` to review conversation history
- Check file selection state with `manage_selection action="list"`
- Verify model availability with `list_models`
- Ensure RepoPrompt is running: `claude mcp list`

## Advanced Workflows

### Multi-Stage Development

For complex features spanning multiple components:

1. **Stage 1: Architecture Planning**
   ```
   manage_selection action="replace" paths=["docs/architecture.md", "src/index.ts"]
   chat_send mode="plan" message="Design microservice architecture"
   ```

2. **Stage 2: Core Implementation**
   ```
   manage_selection action="replace" paths=["src/core/*.ts", "src/types/*.ts"]
   chat_send mode="edit" message="Implement core service logic"
   ```

3. **Stage 3: Integration**
   ```
   manage_selection action="add" paths=["src/api/*.ts", "tests/integration/*.ts"]
   chat_send mode="edit" message="Add API endpoints and integration tests"
   ```

### Collaborative Review

Use RepoPrompt for code review and improvements:

```
# Select files for review
manage_selection action="replace" paths=["src/new-feature/*.ts"]

# Set review criteria
set_prompt_state prompt="Review for security vulnerabilities, performance issues, and code style"

# Get detailed analysis
chat_send mode="plan" message="Perform comprehensive code review"
```

## Tips for Success

1. **Let Models Play to Their Strengths**
   - Claude: File navigation, tool use, quick edits
   - O1/O3: Deep reasoning, complex algorithms, architecture
   - Gemini: Large context analysis, pattern recognition

2. **Maintain Clear Separation**
   - Planning: High-level design and approach
   - Execution: Actual code changes
   - Verification: Testing and validation

3. **Use Appropriate Context**
   - Include enough context for understanding
   - But not so much that it overwhelms the model
   - ~60K tokens is often the sweet spot

4. **Iterate Thoughtfully**
   - Start with planning before jumping to implementation
   - Review plans before execution
   - Test incrementally

## Conclusion

RepoPrompt's pair programming mode enables sophisticated AI collaboration for complex development tasks. By leveraging multiple models' strengths and maintaining careful context management, you can tackle challenging problems more effectively than with a single model alone.

Remember: The key is using Claude Code as an intelligent context manager while letting reasoning models handle complex problem-solving. This division of labor produces higher quality results than either model working alone.