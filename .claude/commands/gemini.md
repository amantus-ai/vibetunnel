# /gemini

Execute Gemini CLI with the context from docs/gemini.md for large codebase analysis.

## Usage

```
/gemini {prompt}
```

## Description

This command reads the `docs/gemini.md` file which contains best practices for using the Gemini CLI with large codebases, then executes the appropriate gemini command based on your prompt.

## Examples

### Analyze a single file
```
/gemini @src/main.py Explain this file's purpose and structure
```

### Check feature implementation
```
/gemini @src/ Has dark mode been implemented in this codebase?
```

### Analyze entire project
```
/gemini @./ Give me an overview of this entire project
```

### Verify security measures
```
/gemini @src/ @api/ Are SQL injection protections implemented?
```

## Implementation

When you use this command, I will:
1. Read the contents of `docs/gemini.md` to understand Gemini CLI usage patterns
2. Analyze your prompt to determine the appropriate Gemini command structure
3. Execute the gemini command with the proper flags and file inclusions
4. Return the results to help with your codebase analysis

## Note

The Gemini CLI is particularly useful when:
- Analyzing entire codebases or large directories
- Context window limits are a concern
- You need to verify implementation of specific features across many files
- Working with files totaling more than 100KB