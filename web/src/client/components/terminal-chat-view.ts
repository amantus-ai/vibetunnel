import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('terminal-chat-view');

interface ChatMessage {
  type: 'command' | 'output' | 'error' | 'prompt';
  content: string;
  timestamp: Date;
  id: string;
}

interface InteractiveOption {
  label: string;
  response: string;
}

@customElement('terminal-chat-view')
export class TerminalChatView extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
      width: 100%;
      background-color: rgb(var(--color-bg));
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
      position: relative;
      z-index: 10;
      pointer-events: auto !important; /* Ensure interactions work */
    }

    .chat-view-container {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .chat-messages-container {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 1rem;
      /* Large top padding to ensure first message clears the header on iPad */
      padding-top: 8rem;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */
      touch-action: pan-y; /* Allow vertical scrolling */
      overscroll-behavior: contain; /* Prevent scroll chaining */
    }

    /* Chat input container (WhatsApp style) */
    .chat-input-container {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.625rem 0.875rem;
      background-color: rgb(30 35 40);
      border-top: 1px solid rgb(50 55 60);
      position: relative;
      z-index: 100;
    }

    .chat-input {
      flex: 1;
      padding: 0.75rem 1.125rem;
      background-color: rgb(45 50 55);
      border: 1px solid rgb(60 65 70);
      border-radius: 1.5rem;
      color: #ffffff;
      font-family: inherit;
      font-size: 16px; /* Prevent zoom on iOS */
      outline: none;
      -webkit-user-select: text;
      user-select: text;
      opacity: 1;
    }

    .chat-input:focus {
      border-color: #00a884;
      background-color: rgb(50 55 60);
      box-shadow: 0 0 0 2px rgba(0, 168, 132, 0.2);
    }

    .chat-input::placeholder {
      color: rgb(140 145 150);
      opacity: 1;
    }

    .send-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2.75rem;
      height: 2.75rem;
      background: linear-gradient(135deg, #00a884 0%, #008f72 100%);
      border: none;
      border-radius: 50%;
      color: white;
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;
      -webkit-tap-highlight-color: transparent;
      box-shadow: 0 2px 6px rgba(0, 168, 132, 0.3);
    }

    .send-button:hover:not(:disabled) {
      background: linear-gradient(135deg, #00c49a 0%, #00a884 100%);
      transform: scale(1.05);
      box-shadow: 0 3px 10px rgba(0, 168, 132, 0.4);
    }

    .send-button:active:not(:disabled) {
      transform: scale(0.95);
    }

    .send-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .keyboard-dismiss-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      background-color: rgb(55 60 65);
      border: 1px solid rgb(70 75 80);
      border-radius: 50%;
      color: rgb(150 155 160);
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;
      -webkit-tap-highlight-color: transparent;
    }

    .keyboard-dismiss-button:hover {
      background-color: rgb(65 70 75);
      color: rgb(200 205 210);
    }

    .keyboard-dismiss-button:active {
      transform: scale(0.95);
    }

    .chat-message {
      margin-bottom: 1rem;
      display: flex;
      flex-direction: column;
      animation: slideIn 0.2s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .message-header {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      margin-bottom: 0.25rem;
      font-size: 0.7rem;
      color: rgb(var(--color-text-muted));
      padding: 0 0.5rem;
    }

    .message-icon {
      font-size: 0.875rem;
    }

    .message-sender {
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.025em;
    }

    .message-separator {
      opacity: 0.4;
    }

    .message-time {
      opacity: 0.6;
    }

    .message-path {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace;
      opacity: 0.8;
      color: rgb(var(--color-primary));
      font-size: 0.65rem;
    }

    .message-bubble {
      padding: 0.875rem 1rem;
      border-radius: 1.125rem;
      max-width: 88%;
      word-wrap: break-word;
      font-size: 0.9rem;
      line-height: 1.5;
      position: relative;
    }

    .message-content {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
    }

    /* Command messages (user) - align right, WhatsApp green style */
    .chat-message.command {
      align-items: flex-end;
    }

    .chat-message.command .message-header {
      justify-content: flex-end;
    }

    .chat-message.command .message-bubble {
      background: linear-gradient(135deg, #00a884 0%, #008f72 100%);
      color: white;
      border-radius: 1.125rem 1.125rem 0.25rem 1.125rem;
      box-shadow: 0 1px 3px rgba(0, 168, 132, 0.3);
    }

    /* Output messages (system) - align left, dark bubble */
    .chat-message.output,
    .chat-message.prompt {
      align-items: flex-start;
    }

    .chat-message.output .message-bubble,
    .chat-message.prompt .message-bubble {
      background-color: rgb(45 50 55);
      color: rgb(var(--color-text));
      border-radius: 1.125rem 1.125rem 1.125rem 0.25rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    /* Error messages */
    .chat-message.error {
      align-items: flex-start;
    }

    .chat-message.error .message-bubble {
      background-color: rgb(60 30 30);
      color: #ff6b6b;
      border-radius: 1.125rem 1.125rem 1.125rem 0.25rem;
      box-shadow: 0 1px 3px rgba(255, 107, 107, 0.2);
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: rgb(120 130 140);
      text-align: center;
      padding: 2rem;
    }

    .empty-state-icon {
      font-size: 3.5rem;
      margin-bottom: 1.25rem;
      opacity: 0.6;
    }

    .empty-state-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: rgb(200 205 210);
    }

    .empty-state-description {
      font-size: 0.8rem;
      max-width: 320px;
      line-height: 1.5;
      color: rgb(100 110 120);
    }

    /* Scrollbar styling */
    .chat-messages-container::-webkit-scrollbar {
      width: 8px;
    }

    .chat-messages-container::-webkit-scrollbar-track {
      background: rgb(var(--color-bg-secondary));
    }

    .chat-messages-container::-webkit-scrollbar-thumb {
      background: rgb(var(--color-border-base));
      border-radius: 4px;
    }

    .chat-messages-container::-webkit-scrollbar-thumb:hover {
      background: rgb(var(--color-text-muted));
    }

    /* Interactive options - pill-style bubbles */
    .interactive-options {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.875rem;
      padding-top: 0.75rem;
    }

    .option-button {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1rem;
      background: linear-gradient(135deg, rgba(0, 168, 132, 0.15) 0%, rgba(0, 143, 114, 0.2) 100%);
      border: 1.5px solid rgba(0, 168, 132, 0.5);
      border-radius: 1.25rem;
      color: #00d4a4;
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: left;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      white-space: nowrap;
    }

    .option-button:hover {
      background: linear-gradient(135deg, rgba(0, 168, 132, 0.25) 0%, rgba(0, 143, 114, 0.3) 100%);
      border-color: #00a884;
      transform: scale(1.03);
      box-shadow: 0 2px 8px rgba(0, 168, 132, 0.25);
    }

    .option-button:active {
      transform: scale(0.97);
      background: linear-gradient(135deg, rgba(0, 168, 132, 0.35) 0%, rgba(0, 143, 114, 0.4) 100%);
    }

    .option-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.25rem;
      height: 1.25rem;
      background-color: #00a884;
      color: white;
      border-radius: 50%;
      font-size: 0.7rem;
      font-weight: 700;
      flex-shrink: 0;
    }

    .option-text {
      line-height: 1.3;
    }
  `;

  @property() onSend?: (data: string) => void;
  @property() onPendingInputChange?: (input: string) => void;
  @property() subscribeToOutput?: (listener: (data: string) => void) => () => void;
  @property() getTerminalInputLine?: () => string;
  @property({ type: Boolean }) active = false;
  @property({ type: String }) pendingInput = '';
  @property({ type: String }) sessionId = '';
  private outputUnsubscribe?: () => void;
  private syncInterval?: ReturnType<typeof setInterval>;
  private lastInputTime = 0;

  @state() private messages: ChatMessage[] = [];

  @query('#chat-input-field')
  private inputElement!: HTMLInputElement;

  @query('.chat-messages-container')
  private messagesContainer!: HTMLElement;

  private messageIdCounter = 0;

  connectedCallback() {
    super.connectedCallback();
    // Subscribe to terminal output when connected
    if (this.subscribeToOutput) {
      this.outputUnsubscribe = this.subscribeToOutput((data: string) => {
        this.processTerminalOutput(data);
      });
    }
  }

  disconnectedCallback() {
    // Unsubscribe from terminal output
    if (this.outputUnsubscribe) {
      this.outputUnsubscribe();
      this.outputUnsubscribe = undefined;
    }
    // Stop sync interval
    this.stopTerminalSync();
    super.disconnectedCallback();
  }

  /**
   * Start periodic sync from terminal to keep lastSentValue in sync
   * This prevents drift between chat input and terminal state
   */
  private startTerminalSync(): void {
    if (this.syncInterval) return; // Already running

    const SYNC_INTERVAL_MS = 300;
    const SYNC_DELAY_AFTER_INPUT_MS = 500; // Wait after user stops typing

    this.syncInterval = setInterval(() => {
      // Only sync if user hasn't typed recently
      const timeSinceLastInput = Date.now() - this.lastInputTime;
      if (timeSinceLastInput < SYNC_DELAY_AFTER_INPUT_MS) {
        return;
      }

      this.syncLastSentValueFromTerminal();
    }, SYNC_INTERVAL_MS);

    logger.debug('Terminal sync started');
  }

  private stopTerminalSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
      logger.debug('Terminal sync stopped');
    }
  }

  /**
   * Sync lastSentValue with what's actually in the terminal
   * This corrects any drift between our tracking and terminal state
   */
  private syncLastSentValueFromTerminal(): void {
    if (!this.getTerminalInputLine) return;

    const terminalInput = this.getTerminalInputLine();
    if (terminalInput === null || terminalInput === undefined) return;

    // Clean up terminal input (remove TUI artifacts)
    // biome-ignore lint/complexity/useRegexLiterals: Avoiding control character lint errors
    const controlCharPattern = new RegExp('[\\x00-\\x1F\\x7F]', 'g');
    const cleanedInput = terminalInput
      .replace(controlCharPattern, '')
      .replace(/[│┃┆┇┊┋|]/g, ' ')
      .replace(/[─━┄┅┈┉═]/g, '')
      .replace(/[╭╮╰╯┌┐└┘]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Update lastSentValue if different - this fixes drift
    if (this.lastSentValue !== cleanedInput) {
      logger.debug(`Syncing lastSentValue: "${this.lastSentValue}" -> "${cleanedInput}"`);
      this.lastSentValue = cleanedInput;
    }
  }

  /**
   * Sync input from terminal with retry - gives time for buffer to fully load
   */
  private syncFromTerminalWithRetry(attempt = 0): void {
    if (!this.getTerminalInputLine) return;

    let terminalInput = this.getTerminalInputLine();

    if (terminalInput) {
      // Aggressively clean up TUI artifacts and special characters
      // biome-ignore lint/complexity/useRegexLiterals: Avoiding control character lint errors
      const ctrlPattern = new RegExp('[\\x00-\\x1F\\x7F]', 'g');
      terminalInput = terminalInput
        .replace(ctrlPattern, '') // Remove control characters
        .replace(/[│┃┆┇┊┋|]/g, ' ') // Replace box-drawing pipes with space
        .replace(/[─━┄┅┈┉═]/g, '') // Remove horizontal lines
        .replace(/[╭╮╰╯┌┐└┘]/g, '') // Remove corners
        .replace(/\s+/g, ' ') // Collapse multiple spaces to one
        .trim();

      if (terminalInput) {
        // Set input value directly on DOM element (not via reactive binding)
        if (this.inputElement) {
          this.inputElement.value = terminalInput;
        }
        return;
      }
    }

    if (attempt < 3) {
      // Retry after a short delay (buffer might still be loading)
      setTimeout(() => this.syncFromTerminalWithRetry(attempt + 1), 150);
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has('messages')) {
      this.scrollToBottom();
    }
    // Subscribe to output if subscribeToOutput prop was set after connection
    if (
      changedProperties.has('subscribeToOutput') &&
      this.subscribeToOutput &&
      !this.outputUnsubscribe
    ) {
      this.outputUnsubscribe = this.subscribeToOutput((data: string) => {
        this.processTerminalOutput(data);
      });
    }
    // Sync input when becoming active
    if (changedProperties.has('active')) {
      if (this.active) {
        // Priority: terminal buffer > pendingInput
        if (this.getTerminalInputLine) {
          // Read from terminal buffer - it has the "truth" of what's on screen
          this.lastSentValue = '';
          if (this.inputElement) {
            this.inputElement.value = '';
          }
          this.syncFromTerminalWithRetry();
          this.syncLastSentValueFromTerminal();
        } else if (this.pendingInput && this.inputElement) {
          // Fallback to pendingInput
          this.inputElement.value = this.pendingInput;
          this.lastSentValue = this.pendingInput;
        } else {
          // No input to sync, start fresh
          this.lastSentValue = '';
          if (this.inputElement) {
            this.inputElement.value = '';
          }
        }

        // Start periodic sync to keep lastSentValue in sync with terminal
        this.startTerminalSync();

        // Focus the input field when chat becomes active - with delay to ensure DOM is ready
        setTimeout(() => {
          if (this.inputElement) {
            this.inputElement.focus();
            logger.log('Chat input focused on activation');
          }
        }, 100);
      } else {
        this.lastSentValue = '';
        if (this.inputElement) {
          this.inputElement.value = '';
        }
        // Stop sync when leaving chat mode
        this.stopTerminalSync();
      }
    }
    // NOTE: We intentionally do NOT sync pendingInput back to the input element here.
    // The chat input is the "source of truth" while the user is typing.
    // Syncing from pendingInput (which comes from terminal) would overwrite
    // accented characters that the terminal might not render correctly.
  }

  private processTerminalOutput(data: string) {
    // Strip ANSI codes
    const cleanData = this.stripAnsiCodes(data);

    // Ignore empty data
    if (!cleanData.trim() && !cleanData.includes('\r') && !cleanData.includes('\n')) {
      return;
    }

    // Split by lines to process each one
    const lines = cleanData.split(/\r?\n/);

    // Get the last command sent to filter out its echo
    const lastCommandMsg = this.messages
      .slice()
      .reverse()
      .find((m) => m.type === 'command');
    const lastCommand = lastCommandMsg ? lastCommandMsg.content : '';

    // Get current input value to filter out live echo
    const currentInput = this.inputElement?.value.trim() || '';

    for (const line of lines) {
      let trimmedLine = line.trim();

      // 1. Filter out noise (separators, spinners, system prompts)
      if (!trimmedLine) continue;

      // Filter echo of executed command
      if (lastCommand && (trimmedLine === lastCommand || trimmedLine.endsWith(lastCommand)))
        continue;

      // Filter live echo of current typing
      // We strip common prompt chars and box borders to check if the content matches what we are typing
      const cleanContent = trimmedLine
        .replace(/^[\s│]*[>·$#]\s?/, '') // Remove leading prompt/box
        .replace(/[│\s]*$/, ''); // Remove trailing box/space

      if (currentInput && cleanContent && currentInput.startsWith(cleanContent)) {
        continue;
      }

      // Filter TUI noise (boxes, status bars, spinners)
      if (this.isNoiseLine(trimmedLine)) continue;

      // Clean up leading symbols (spinners, prompts)
      // Includes braille patterns for spinners and various bullets
      trimmedLine = trimmedLine.replace(/^[\s]*[·⏵>⏺✻✽✶✳✢✦⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s?/, '');

      // If line became empty after cleaning, skip
      if (!trimmedLine.trim()) continue;

      // 2. Append to current message or create new one
      this.appendOutputToChat(trimmedLine.trim());
    }
  }

  private isNoiseLine(line: string): boolean {
    // Box borders and horizontal lines
    if (line.match(/^[─_━\s╭╮╰╯│]+$/)) return true;

    // Very short lines that are likely noise (single chars like ~, >, etc)
    const trimmed = line.trim();
    if (trimmed.length <= 2 && !trimmed.match(/^[a-zA-Z0-9]$/)) return true;

    // Thinking/processing indicators (Gemini, Claude CLI)
    if (
      line.includes('Thinking') ||
      line.includes('Thought for') ||
      line.includes('ctrl+o to show') ||
      line.match(/^∴/) || // Gemini thinking symbol
      line.match(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/) || // Braille spinners
      line.includes('Processing') ||
      line.includes('Generating')
    ) {
      return true;
    }

    // Permission dialogs - keep interactive options visible but filter noise
    if (
      line.includes('current working directory') ||
      line.includes('Shell ') || // Shell command headers
      line.includes('(Cre') || // Truncated "(Create..." etc
      line.includes('(Deleti') || // Truncated "(Deleting..." etc
      line.match(/^[?!]\s+Shell/) || // Permission prompt headers
      line.includes('← │') || // TUI box edges
      line.includes('│ ?') ||
      line.includes('Waiting for user')
    ) {
      return true;
    }

    // Specific Gemini/Claude TUI elements
    if (
      line.includes('Gemini CLI update available') ||
      line.includes('Installed via Homebrew') ||
      line.includes('Using:') || // Gemini "Using: - X GEMINI.md files"
      trimmed === 'Usi' || // Partial "Using:" (streaming)
      trimmed === 'ng:' || // Partial "Using:" continued
      line.includes('GEMINI.md') || // Config file references
      line.includes('CLAUDE.md') || // Config file references
      line.match(/^-\s*\d+\s*(GEMINI|CLAUDE|\.md)/i) || // "- 4 GEMINI.md files" pattern
      line.includes('Type your message or @path') ||
      line.includes('no sandbox') || // Status bar - filter any line with this
      line.includes('Converting coffee into code') ||
      line.includes('Considering the Greeting') ||
      line.includes("I'm Feeling Lucky") ||
      line.includes('esc to cancel') ||
      line.includes('esc to interrupt') ||
      line.includes('bypass permissions on') ||
      line.includes('Marinating') ||
      line.includes('Clauding') ||
      line.includes('Simmering') ||
      line.includes('enable IDE integration') ||
      line.includes('Queued (press') ||
      line.includes('Tip: Open the Command Palette')
    ) {
      return true;
    }

    // Status bar fragments - be more aggressive
    if (line.match(/^~\/.*no sandbox/)) return true;
    if (trimmed === 'auto' || trimmed === 'manual' || trimmed === 'plan') return true;
    if (line.match(/^\s*(auto|manual|plan)\s*$/)) return true;

    // Boxed content (lines starting and ending with │) that looks like noise
    if (line.startsWith('│') && line.endsWith('│')) {
      // Assume it's a TUI box if it's short or matches known patterns
      // (We already caught specific messages above, but this catches generic boxes)
      // To be safe, we only filter if it contains "update" or "Homebrew" which we already did.
      // Let's filter empty box lines
      if (line.replace(/[│\s]/g, '').length === 0) return true;
    }

    return false;
  }

  private appendOutputToChat(content: string) {
    const lastMsg = this.messages[this.messages.length - 1];

    // If last message is from System (output), append to it
    if (lastMsg && lastMsg.type === 'output') {
      const lastLines = lastMsg.content.split('\n');
      const lastLine = lastLines[lastLines.length - 1].trim();

      // Case 1: Exact duplicate - skip
      if (lastLine === content) {
        return;
      }

      // Case 2: Content already exists in message - skip
      if (lastMsg.content.includes(content)) {
        return;
      }

      // Case 3: New content is a continuation of the last line (streaming/progressive reveal)
      // e.g., lastLine = "Hello", content = "Hello, how are you?"
      if (content.startsWith(lastLine) && lastLine.length > 0) {
        // Replace last line with the longer version
        if (lastLines.length > 1) {
          lastLines[lastLines.length - 1] = content;
          lastMsg.content = lastLines.join('\n');
        } else {
          lastMsg.content = content;
        }
        this.requestUpdate();
        this.scrollToBottom();
        return;
      }

      // Case 4: Last line is a prefix of the new content on a different part
      // Check if any recent line starts the same as the new content
      const recentLines = lastLines.slice(-5); // Check last 5 lines
      for (let i = recentLines.length - 1; i >= 0; i--) {
        const recentLine = recentLines[i].trim();
        if (recentLine && content.startsWith(recentLine)) {
          // This is a continuation of a recent line - likely a redraw, skip
          return;
        }
      }

      // Normal case: append new content
      lastMsg.content += (lastMsg.content ? '\n' : '') + content;
      this.requestUpdate();
      this.scrollToBottom();
    } else {
      // Create new system message
      this.addMessage('output', content);
    }
  }

  private stripAnsiCodes(str: string): string {
    // Remove ANSI escape codes but preserve the text
    // biome-ignore lint/complexity/useRegexLiterals: Avoiding control character lint errors
    const colorCodes = new RegExp('\\x1b\\[[0-9;]*m', 'g');
    // biome-ignore lint/complexity/useRegexLiterals: Avoiding control character lint errors
    const escapeSeq = new RegExp('\\x1b\\[.*?[@-~]', 'g');
    // biome-ignore lint/complexity/useRegexLiterals: Avoiding control character lint errors
    const oscSeq = new RegExp('\\x1b\\].*?\\x07', 'g');
    // biome-ignore lint/complexity/useRegexLiterals: Avoiding control character lint errors
    const otherSeq = new RegExp('\\x1b.*?[\\x40-\\x5a\\x5c\\x5f]', 'g');
    return str
      .replace(colorCodes, '')
      .replace(escapeSeq, '')
      .replace(oscSeq, '')
      .replace(otherSeq, '');
  }

  private addMessage(type: ChatMessage['type'], content: string) {
    if (!content.trim()) return;

    // Detect if this is an error message
    const isError = this.detectError(content);
    const messageType = isError ? 'error' : type;

    this.messages = [
      ...this.messages,
      {
        type: messageType,
        content: content.trim(),
        timestamp: new Date(),
        id: `msg-${this.messageIdCounter++}`,
      },
    ];
  }

  private detectError(str: string): boolean {
    const errorKeywords = [
      'error',
      'failed',
      'cannot',
      'permission denied',
      'not found',
      'fatal',
      'exception',
      'traceback',
    ];
    const lowerStr = str.toLowerCase();
    return errorKeywords.some((keyword) => lowerStr.includes(keyword));
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      if (this.messagesContainer) {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      }
    });
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private detectInteractiveOptions(content: string): InteractiveOption[] | null {
    // Detect Gemini CLI permission format like:
    // ● 1. Yes, allow once
    //   2. Yes, allow always ...
    //   3. No, suggest changes (esc)
    const geminiPattern = /[●\s]*(\d+)\.\s+(.+?)(?:\s*\.{3}|\s*\(esc\))?$/gm;
    const geminiMatches: InteractiveOption[] = [];

    for (const match of content.matchAll(geminiPattern)) {
      const label = match[2]
        .trim()
        .replace(/\s*\.{3}$/, '')
        .replace(/\s*\(esc\)$/, '');
      geminiMatches.push({ label, response: match[1] });
    }

    if (geminiMatches.length >= 2) {
      return geminiMatches;
    }

    // Detect numbered options like:
    // 1) Option one
    // 2) Option two
    const numberedPattern = /^\s*(\d+)\)\s+(.+)$/gm;
    const matches: InteractiveOption[] = [];

    for (const match of content.matchAll(numberedPattern)) {
      matches.push({ label: match[2].trim(), response: match[1] });
    }

    if (matches.length >= 2) {
      return matches;
    }

    // Detect lettered options like:
    // a) Option one
    // b) Option two
    const letteredPattern = /^\s*([a-z])\)\s+(.+)$/gm;
    const letterMatches: InteractiveOption[] = [];

    for (const match of content.matchAll(letteredPattern)) {
      letterMatches.push({ label: match[2].trim(), response: match[1] });
    }

    if (letterMatches.length >= 2) {
      return letterMatches;
    }

    // Detect bracketed options like:
    // [1] Option one
    // [2] Option two
    const bracketPattern = /^\s*\[(\d+)\]\s+(.+)$/gm;
    const bracketMatches: InteractiveOption[] = [];

    for (const match of content.matchAll(bracketPattern)) {
      bracketMatches.push({ label: match[2].trim(), response: match[1] });
    }

    if (bracketMatches.length >= 2) {
      return bracketMatches;
    }

    // Detect yes/no questions
    if (/\(y\/n\)|\[y\/n\]|yes\/no/i.test(content)) {
      return [
        { label: 'Yes', response: 'y' },
        { label: 'No', response: 'n' },
      ];
    }

    // Detect "Allow execution" prompts
    if (/Allow execution of/i.test(content)) {
      return [
        { label: 'Yes, allow once', response: '1' },
        { label: 'Yes, allow always', response: '2' },
        { label: 'No', response: '3' },
      ];
    }

    return null;
  }

  private handleOptionClick(option: InteractiveOption) {
    if (!this.onSend) return;

    // Send the option response + enter to the terminal
    const input = `${option.response}\r`;
    this.onSend(input);

    // Mark the current message as "answered" by changing it to show just the selected option
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg && lastMsg.type === 'output') {
      // Replace the message content with just the selected option
      lastMsg.content = `Selected: ${option.label}`;
      this.requestUpdate();
    }

    // Force next output to create a new message by adding a placeholder command
    this.addMessage('command', `[Option ${option.response}]`);

    logger.log(`Selected option ${option.response}: ${option.label}`);
  }

  /**
   * Clean up content when showing interactive options
   * Removes shell box content and other noise to show just the question
   */
  private cleanContentForOptions(content: string): string {
    const lines = content.split('\n');
    const cleanLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip shell box frames
      if (
        trimmed.match(/^[╭╮╰╯│─┌┐└┘├┤┬┴┼]+$/) ||
        trimmed.match(/^[─━═]+$/) ||
        trimmed.startsWith('│') ||
        trimmed.endsWith('│')
      ) {
        continue;
      }

      // Skip checkmark lines (shell execution confirmations)
      if (trimmed.startsWith('✓') || trimmed.startsWith('✔')) {
        continue;
      }

      // Skip lines that look like shell commands
      if (trimmed.match(/^Shell\s+/) || trimmed.match(/^(mkdir|rm|mv|cp|cd|ls|cat|echo)\s/)) {
        continue;
      }

      // Skip empty lines
      if (!trimmed) continue;

      // Skip option lines (they'll be rendered as buttons)
      if (
        trimmed.match(/^[●○•]\s*\d+\./) || // Gemini option format
        trimmed.match(/^\d+[.)]\s/) || // Numbered options
        trimmed.match(/^[a-z][.)]\s/i)
      ) {
        // Lettered options
        continue;
      }

      cleanLines.push(trimmed);
    }

    // If nothing remains, return a default prompt
    if (cleanLines.length === 0) {
      return 'Choose an option:';
    }

    return cleanLines.join('\n');
  }

  /**
   * Extract working directory path from the beginning of a message
   * Returns { path, content } where path is the extracted path (or null) and content is the remaining text
   */
  private extractPathFromContent(content: string): { path: string | null; content: string } {
    // Match paths like ~/Projects, ~/foo/bar, /Users/something at the start of the message
    const pathMatch = content.match(/^(~\/[^\s\n]+|\/[^\s\n]+)\s*/);
    if (pathMatch) {
      const path = pathMatch[1];
      const remainingContent = content.slice(pathMatch[0].length).trim();
      return { path, content: remainingContent };
    }
    return { path: null, content };
  }

  private renderMessage(msg: ChatMessage) {
    const isCommand = msg.type === 'command';
    const isError = msg.type === 'error';
    const options = !isCommand ? this.detectInteractiveOptions(msg.content) : null;

    // Extract path from system messages to show in header
    let { path, content: messageContent } = !isCommand
      ? this.extractPathFromContent(msg.content)
      : { path: null, content: msg.content };

    // When showing interactive options, clean up the content to show just the relevant question
    // Remove shell box content and noise
    if (options) {
      messageContent = this.cleanContentForOptions(messageContent);
    }

    return html`
      <div
        class="chat-message ${msg.type}"
        data-message-id="${msg.id}"
      >
        <div class="message-header">
          <span class="message-icon">
            ${isCommand ? '💬' : isError ? '❌' : options ? '❓' : '🤖'}
          </span>
          <span class="message-sender">
            ${isCommand ? 'You' : 'System'}
          </span>
          ${
            path
              ? html`
            <span class="message-separator">•</span>
            <span class="message-path">${path}</span>
          `
              : ''
          }
          <span class="message-separator">•</span>
          <span class="message-time">${this.formatTime(msg.timestamp)}</span>
        </div>
        <div class="message-bubble ${msg.type}">
          <pre class="message-content">${messageContent}</pre>
          ${
            options
              ? html`
            <div class="interactive-options">
              ${options.map(
                (option, index) => html`
                <button
                  class="option-button"
                  @click=${() => this.handleOptionClick(option)}
                  @touchend=${(e: TouchEvent) => {
                    e.preventDefault();
                    this.handleOptionClick(option);
                  }}
                >
                  <span class="option-number">${index + 1}</span>
                  <span class="option-text">${option.label}</span>
                </button>
              `
              )}
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;
  }

  private handleContainerClick(e: Event) {
    // On iPad, clicking outside the input loses focus and makes it hard to refocus
    // Always refocus the input when clicking anywhere in the chat view
    const target = e.target as HTMLElement;
    // Don't refocus if clicking on a button (send button, option buttons)
    if (target.tagName !== 'BUTTON' && !target.closest('button')) {
      // Use setTimeout to ensure focus happens after any other handlers
      setTimeout(() => {
        if (this.inputElement && this.active) {
          this.inputElement.focus();
          logger.log('Chat input focused via container click');
        }
      }, 50);
    }
  }

  render() {
    return html`
      <div class="chat-view-container" @click=${this.handleContainerClick}>
        <div class="chat-messages-container">
          ${
            this.messages.length === 0
              ? html`
                <div class="empty-state">
                  <div class="empty-state-icon">💬</div>
                  <div class="empty-state-title">Chat Mode Active</div>
                  <div class="empty-state-description">
                    Type your commands below and press Enter to send them.
                    Responses will appear here as chat messages.
                  </div>
                </div>
              `
              : this.messages.map((msg) => this.renderMessage(msg))
          }
        </div>
        
        <!-- Chat input area (WhatsApp style) -->
        <div 
          class="chat-input-container"
          @click=${(e: Event) => e.stopPropagation()}
          @keydown=${(e: KeyboardEvent) => e.stopPropagation()}
        >
          <!-- Autocorrect is intentional; spellcheck stays off because commands may contain secrets. -->
          <input
            id="chat-input-field"
            type="text"
            class="chat-input"
            placeholder="Type a command..."
            autocomplete="off"
            autocorrect="on"
            autocapitalize="off"
            spellcheck="false"
            @keydown=${this.handleInputKeydown}
            @input=${this.handleInput}
            @focus=${() => logger.log('Input focused')}
            @blur=${() => logger.log('Input blurred')}
          />
          <button
            class="keyboard-dismiss-button"
            @click=${this.handleDismissKeyboard}
            title="Hide keyboard"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/>
              <path d="M12 19l-4 3v-3h-4v-2h16v2h-4v3z" opacity="0.5"/>
            </svg>
          </button>
          <button
            class="send-button"
            @click=${this.handleSend}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  private handleInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  private handleDismissKeyboard() {
    // Hide keyboard - user can tap input again to refocus if needed
    if (!this.inputElement) return;
    this.inputElement.blur();
  }

  private lastSentValue = '';

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!this.onSend) return;

    // Track when user last typed - used to pause sync during active typing
    this.lastInputTime = Date.now();

    const newValue = input.value;

    // Update pending input for InputManager (for display sync)
    this.onPendingInputChange?.(newValue);

    // Send delta to terminal (only the difference from what we already sent)
    this.sendDeltaToTerminal(newValue);
  }

  private sendDeltaToTerminal(newValue: string) {
    if (!this.onSend) return;

    const oldValue = this.lastSentValue;

    // Find common prefix length
    let commonLen = 0;
    while (
      commonLen < oldValue.length &&
      commonLen < newValue.length &&
      oldValue[commonLen] === newValue[commonLen]
    ) {
      commonLen++;
    }

    // Calculate how many characters to delete (backspaces needed)
    const charsToDelete = oldValue.length - commonLen;

    // Characters to add after the common prefix
    const charsToAdd = newValue.slice(commonLen);

    // Build the sequence: backspaces + new characters
    let sequence = '';

    // Send backspaces for deleted characters
    for (let i = 0; i < charsToDelete; i++) {
      sequence += '\x7f'; // DEL character (backspace)
    }

    // Send new characters
    sequence += charsToAdd;

    if (sequence) {
      this.onSend(sequence);
    }

    this.lastSentValue = newValue;
  }

  private handleSend() {
    // Read directly from the input element to avoid reactive binding issues
    const input = this.inputElement;
    if (!input) return;

    const command = input.value.trim();
    if (!command) return;

    // Add command to chat
    this.addMessage('command', command);

    // Send Enter to execute the command (characters were already sent via delta)
    if (this.onSend) {
      this.onSend('\r');
    }

    // Clear input directly on the DOM element
    input.value = '';
    this.lastSentValue = '';

    // Clear pending input in InputManager
    this.onPendingInputChange?.('');

    // Scroll to show the sent message
    this.scrollToBottom();
  }
}
