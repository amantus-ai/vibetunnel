# VibeTunnel Logging Style Guide

## Logging style

### 1. No Colors in Error/Warn
```typescript
// ❌ BAD
logger.error(chalk.red('Failed to connect'));
logger.warn(chalk.yellow('Missing config'));

// ✅ GOOD
logger.error('Failed to connect');
logger.warn('Missing config');
```

### 2. Use Colors in logger.log Only
```typescript
// Success = green
logger.log(chalk.green('Session created'));
logger.log(chalk.green(`Connected to ${server}`));

// Warning/Neutral = yellow
logger.log(chalk.yellow('Shutting down...'));
logger.log(chalk.yellow(`Client disconnected`));

// Info = blue
logger.log(chalk.blue('New client connected'));

// Metadata = gray
logger.log(chalk.gray('Debug mode enabled'));
```

### 3. Always Include Error Object
```typescript
// ❌ BAD
logger.error(`Failed: ${error.message}`);

// ✅ GOOD
logger.error('Failed to connect:', error);
```

### 4. Message Format
- Start with lowercase (except acronyms)
- No periods at end
- Be concise
- Include relevant IDs

```typescript
// ❌ BAD
logger.log('The session has been created successfully.');
logger.error('ERROR: Failed to connect to server!');

// ✅ GOOD
logger.log(`Session ${id} created`);
logger.error('Failed to connect to server');
```

### 5. No Prefixes or Tags
```typescript
// ❌ BAD
logger.log('[STREAM] Client connected');
logger.error('ERROR: Connection failed');
logger.warn('WARNING: Low memory');

// ✅ GOOD
logger.log('Client connected to stream');
logger.error('Connection failed');
logger.warn('Low memory');
```

## Common Patterns

### Lifecycle Events
```typescript
// Starting
logger.log(chalk.green('Server started'));
logger.log(chalk.green(`Session ${id} created`));

// Stopping
logger.log(chalk.yellow('Shutting down...'));
logger.log(chalk.yellow(`Session ${id} terminated`));

// Connections
logger.log(chalk.blue('Client connected'));
logger.log(chalk.yellow('Client disconnected'));
```

### Operations
```typescript
// Success
logger.log(chalk.green(`File uploaded: ${filename}`));

// In Progress
logger.log(`Processing ${count} items`);

// Failure
logger.error('Upload failed:', error);
```

### Debug (no colors needed)
```typescript
logger.debug(`Buffer size: ${size}`);
logger.debug(`Request headers: ${JSON.stringify(headers)}`);
```

## Quick Reference

| Event Type | Log Level | Color |
|------------|-----------|--------|
| Success | log | chalk.green |
| Connection | log | chalk.blue |
| Disconnect | log | chalk.yellow |
| Shutdown | log | chalk.yellow |
| Error | error | none |
| Warning | warn | none |
| Debug info | debug | none |
| Metadata | log | chalk.gray |