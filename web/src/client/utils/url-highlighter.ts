/**
 * URL Highlighter utility for DOM terminal
 *
 * Handles detection and highlighting of URLs in terminal content,
 * including multi-line URLs that span across terminal lines.
 */

// Constants
const MIN_URL_LENGTH = 7;
const MAX_URL_LENGTH = 2048;
const URL_PROTOCOLS = ['https://', 'http://', 'file://'] as const;
const TERMINAL_LINK_CLASS = 'terminal-link';

// Compiled regex patterns (created once for performance)
const URL_START_PATTERN = /https?:\/\/|file:\/\//g;
const PARTIAL_PROTOCOL_PATTERN =
  /(^|\s)(h|ht|htt|http|https|https:|https:\/|https:\/\/|f|fi|fil|file|file:|file:\/|file:\/\/)$/;
const DOMAIN_START_PATTERN = /^[a-zA-Z0-9[\].-]/;
const PATH_START_PATTERN = /^[/a-zA-Z0-9[\].-]/;
const URL_END_CHARS_PATTERN = /[^\w\-._~:/?#[\]@!$&'()*+,;=%{}|\\^`]/;
// Pattern breakdown:
// - https?:\/\/ - HTTP or HTTPS protocol
// - Host options:
//   - localhost - literal localhost
//   - [\d.]+ - IPv4 addresses
//   - \[[\da-fA-F:]+\] - IPv6 addresses in brackets
//   - Domain names: Must have at least domain.tld structure
//     - Optional subdomains: ([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*
//     - Required domain: [a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?
//     - Required dot and TLD: \.[a-zA-Z]+
// - (:\d+)? - Optional port number
// - .* - Any path/query/fragment
// - file:\/\/.+ - File protocol with any path
const LOCALHOST_PATTERN =
  /^(https?:\/\/(localhost|[\d.]+|\[[\da-fA-F:]+\]|(([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]+))(:\d+)?.*|file:\/\/.+)/;

// Pattern to validate individual domain labels
const VALID_DOMAIN_LABEL = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

type ProcessedRange = {
  start: number;
  end: number;
};

/**
 * Main entry point - process all links in a container
 */
export function processLinks(container: HTMLElement): void {
  const processor = new LinkProcessor(container);
  processor.process();
}

/**
 * LinkProcessor class encapsulates the URL detection and highlighting logic
 */
class LinkProcessor {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used in constructor
  private container: HTMLElement;
  private lines: NodeListOf<Element>;
  private processedRanges: Map<number, ProcessedRange[]> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
    this.lines = container.querySelectorAll('.terminal-line');
  }

  process(): void {
    if (this.lines.length === 0) return;

    // Process each line
    for (let i = 0; i < this.lines.length; i++) {
      this.processLine(i);
    }
  }

  private processLine(lineIndex: number): void {
    // Check if this line continues a URL from the previous line
    if (lineIndex > 0) {
      this.checkPreviousLineContinuation(lineIndex);
    }

    // Find new URLs starting in this line
    this.findUrlsInLine(lineIndex);
  }

  private checkPreviousLineContinuation(lineIndex: number): void {
    const currentLineText = this.getLineText(lineIndex);
    const prevLineText = this.getLineText(lineIndex - 1);

    // Try to find incomplete URLs at the end of the previous line
    const incompleteUrl = this.findIncompleteUrlAtLineEnd(prevLineText, currentLineText);

    if (incompleteUrl) {
      const { startPos } = incompleteUrl;

      // Build the complete URL
      const completeUrl = this.buildMultiLineUrl(lineIndex - 1, startPos);

      if (completeUrl && this.isValidUrl(completeUrl.url)) {
        // Check if already processed
        if (!this.isRangeProcessed(lineIndex - 1, startPos, completeUrl.endLine)) {
          this.createUrlLinks(completeUrl.url, lineIndex - 1, completeUrl.endLine, startPos);
          this.markRangeAsProcessed(lineIndex - 1, completeUrl.endLine, startPos, completeUrl.url);
        }
      }
    }
  }

  private findIncompleteUrlAtLineEnd(
    prevLineText: string,
    currentLineText: string
  ): { startPos: number; protocol: string } | null {
    // Check for complete protocol at line end
    for (const protocol of URL_PROTOCOLS) {
      const index = prevLineText.lastIndexOf(protocol);
      if (index >= 0 && prevLineText.endsWith(protocol)) {
        // Verify next line starts with valid domain/path (after trimming whitespace)
        if (DOMAIN_START_PATTERN.test(currentLineText.trimStart())) {
          return { startPos: index, protocol };
        }
      }
    }

    // Check for partial protocol at line end
    const partialMatch = prevLineText.match(PARTIAL_PROTOCOL_PATTERN);
    if (partialMatch) {
      const protocol = partialMatch[2];
      const startPos = (partialMatch.index ?? 0) + (partialMatch[1] ? 1 : 0);

      if (this.isValidContinuation(protocol, currentLineText)) {
        return { startPos, protocol };
      }
    }

    return null;
  }

  private isValidContinuation(partialProtocol: string, nextLineText: string): boolean {
    // Trim leading whitespace for validation
    const trimmedText = nextLineText.trimStart();

    // Complete protocols - accept domain names
    if (partialProtocol === 'https://' || partialProtocol === 'file://') {
      return DOMAIN_START_PATTERN.test(trimmedText);
    }

    // Partial protocol ending with /
    if (partialProtocol.endsWith('/')) {
      return PATH_START_PATTERN.test(trimmedText);
    }

    // Partial protocol without / - check if continuation completes it
    const combined = partialProtocol + trimmedText;
    return /^(https?:\/\/|file:\/\/)/.test(combined);
  }

  private isValidUrlContinuation(currentUrl: string, nextLineText: string): boolean {
    const trimmedNext = nextLineText.trimStart();

    // Empty line or only whitespace - URL ended
    if (!trimmedNext) {
      return false;
    }

    // If we're still building the protocol part, check if continuation makes sense
    if (!currentUrl.includes('://')) {
      // Check if the combination would form a valid protocol
      const combined = currentUrl + trimmedNext;
      return /^(https?:|file:|https?:\/|file:\/|https?:\/\/|file:\/\/)/.test(combined);
    }

    // If the current URL ends with a protocol, next should be domain-like
    if (currentUrl.match(/(https?:|file:)\/\/$/)) {
      return DOMAIN_START_PATTERN.test(trimmedNext);
    }

    // For established URLs, check if the next line could plausibly continue the URL
    // This is more permissive to handle various splitting scenarios

    // Common cases where URLs definitely don't continue:
    // - Line starts with common non-URL words
    if (
      /^(and|or|but|the|is|are|was|were|been|have|has|had|will|would|could|should|may|might|check|visit|go|see|click|open|navigate)\b/i.test(
        trimmedNext
      )
    ) {
      return false;
    }

    // Line starts with sentence-ending punctuation (but not domain dots)
    if (/^[!?;]/.test(trimmedNext)) {
      return false;
    }

    // Special check for dots - only reject if followed by space or end of line
    if (/^\.(\s|$)/.test(trimmedNext)) {
      return false;
    }

    // For more accurate detection, check if the line starts with something that looks like
    // it could be part of a URL vs regular text
    const firstWord = trimmedNext.split(/\s/)[0];

    // If the first word contains URL-like patterns, it might continue
    if (/[/:._-]/.test(firstWord)) {
      return true;
    }

    // If it's all alphanumeric with no URL-like characters, and it's a common word,
    // it's probably not a URL continuation
    if (/^[a-zA-Z]+$/.test(firstWord) && firstWord.length > 2) {
      // More extensive list of common English words that shouldn't start a URL continuation
      const commonWords =
        /^(next|line|with|text|this|that|then|when|where|which|while|after|before|during|since|until|above|below|between|into|through|under|over|about|against|among|around|behind|beside|beyond|inside|outside|toward|within|without|according|although|because|however|therefore|moreover|nevertheless|furthermore|otherwise|meanwhile|indeed|instead|likewise|similarly|specifically|subsequently|ultimately|additionally|consequently|eventually|finally|initially|particularly|previously|recently|suddenly|usually)/i;
      return !commonWords.test(firstWord);
    }

    // Otherwise, if it starts with URL-safe characters, it might be a continuation
    return /^[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]/.test(trimmedNext);
  }

  private findUrlsInLine(lineIndex: number): void {
    const lineText = this.getLineText(lineIndex);

    // Reset the regex
    URL_START_PATTERN.lastIndex = 0;

    let match = URL_START_PATTERN.exec(lineText);
    while (match !== null) {
      const urlStart = match.index;

      // Check if already processed
      if (this.isPositionProcessed(lineIndex, urlStart)) {
        match = URL_START_PATTERN.exec(lineText);
        continue;
      }

      // Build the URL from this position
      const completeUrl = this.buildMultiLineUrl(lineIndex, urlStart);

      if (completeUrl && this.isValidUrl(completeUrl.url)) {
        this.createUrlLinks(completeUrl.url, lineIndex, completeUrl.endLine, urlStart);
        this.markRangeAsProcessed(lineIndex, completeUrl.endLine, urlStart, completeUrl.url);
      }

      match = URL_START_PATTERN.exec(lineText);
    }
  }

  private buildMultiLineUrl(
    startLine: number,
    startCol: number
  ): { url: string; endLine: number } | null {
    let url = '';
    let endLine = startLine;

    for (let i = startLine; i < this.lines.length; i++) {
      const lineText = this.getLineText(i);
      let remainingText: string;

      if (i === startLine) {
        remainingText = lineText.substring(startCol);
      } else {
        // Only continue if this looks like a valid URL continuation
        const currentUrl = url;
        const shouldContinue = this.isValidUrlContinuation(currentUrl, lineText);
        if (!shouldContinue) {
          endLine = i - 1;
          break;
        }

        // For continuation lines, skip leading whitespace
        remainingText = lineText.trimStart();

        // If the line was only whitespace, stop here
        if (!remainingText) {
          endLine = i - 1;
          break;
        }
      }

      // Find where the URL ends in this line
      const urlEnd = this.findUrlEndInText(remainingText);

      if (urlEnd >= 0) {
        url += remainingText.substring(0, urlEnd);
        endLine = i;
        break;
      } else {
        url += remainingText;
        endLine = i;

        if (i === this.lines.length - 1) break;
      }
    }

    return { url: this.cleanUrl(url), endLine };
  }

  private findUrlEndInText(text: string): number {
    // Look for whitespace first
    const whitespaceIndex = text.search(/\s/);
    if (whitespaceIndex >= 0) return whitespaceIndex;

    // Look for characters that typically end URLs
    const endMatch = text.match(URL_END_CHARS_PATTERN);
    if (endMatch && endMatch.index !== undefined) {
      return endMatch.index;
    }

    return -1;
  }

  private createUrlLinks(url: string, startLine: number, endLine: number, startCol: number): void {
    const highlighter = new LinkHighlighter(this.lines, url);
    highlighter.createLinks(startLine, endLine, startCol);
  }

  private getLineText(lineIndex: number): string {
    if (lineIndex < 0 || lineIndex >= this.lines.length) return '';
    return this.lines[lineIndex].textContent || '';
  }

  private isValidUrl(url: string): boolean {
    if (url.length < MIN_URL_LENGTH || url.length > MAX_URL_LENGTH) {
      return false;
    }

    // Check for obvious non-URL characters
    if (/[\n\r\t]/.test(url)) {
      return false;
    }

    // Basic pattern validation
    if (!LOCALHOST_PATTERN.test(url)) {
      return false;
    }

    // Try to parse as URL
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) {
        return false;
      }

      // For HTTP(S) URLs, validate domain structure
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const hostname = parsed.hostname;

        // Skip validation for localhost, IP addresses, and IPv6
        if (hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.startsWith('[')) {
          return true;
        }

        // Validate each domain label
        const labels = hostname.split('.');
        if (labels.length < 2) {
          return false; // Must have at least domain.tld
        }

        // Check all labels including the last one
        for (let i = 0; i < labels.length; i++) {
          if (!VALID_DOMAIN_LABEL.test(labels[i])) {
            return false;
          }
        }

        // Additional check for TLD - must contain at least one letter
        // This allows for internationalized TLDs while ensuring it's not purely numeric
        const tld = labels[labels.length - 1];
        if (!/[a-zA-Z]/.test(tld)) {
          return false; // TLD must contain at least one letter
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  private cleanUrl(url: string): string {
    let cleaned = url;

    // Balance parentheses
    const openParens = (cleaned.match(/\(/g) || []).length;
    const closeParens = (cleaned.match(/\)/g) || []).length;

    if (closeParens > openParens) {
      const toRemove = closeParens - openParens;
      cleaned = cleaned.replace(/\)+$/, (match) => match.substring(0, match.length - toRemove));
    }

    // Remove common trailing punctuation
    cleaned = cleaned.replace(/[.,;:!?]+$/, '');

    return cleaned;
  }

  private isRangeProcessed(startLine: number, startCol: number, endLine: number): boolean {
    for (let line = startLine; line <= endLine; line++) {
      if (this.isPositionProcessed(line, line === startLine ? startCol : 0)) {
        return true;
      }
    }
    return false;
  }

  private isPositionProcessed(line: number, position: number): boolean {
    const ranges = this.processedRanges.get(line);
    if (!ranges) return false;

    return ranges.some((range) => position >= range.start && position < range.end);
  }

  private markRangeAsProcessed(
    startLine: number,
    endLine: number,
    startCol: number,
    url: string
  ): void {
    // Calculate actual URL portions on each line
    let remainingUrl = url;
    let currentLine = startLine;

    while (currentLine <= endLine && remainingUrl.length > 0) {
      const lineText = this.getLineText(currentLine);

      if (!this.processedRanges.has(currentLine)) {
        this.processedRanges.set(currentLine, []);
      }

      const ranges = this.processedRanges.get(currentLine);
      if (!ranges) continue;

      let rangeStart: number;
      let rangeEnd: number;

      if (currentLine === startLine) {
        // First line: start from startCol
        rangeStart = startCol;
        const availableText = lineText.substring(startCol);
        const urlPartLength = Math.min(availableText.length, remainingUrl.length);
        rangeEnd = startCol + urlPartLength;
      } else {
        // Continuation lines: account for leading whitespace
        const leadingWhitespace = lineText.match(/^\s*/);
        rangeStart = leadingWhitespace ? leadingWhitespace[0].length : 0;
        const availableText = lineText.substring(rangeStart);

        // Find where the URL ends on this line
        let urlPartLength = Math.min(availableText.length, remainingUrl.length);

        // Check for URL-ending characters
        if (currentLine === endLine) {
          const endMatch = availableText.substring(0, urlPartLength).search(URL_END_CHARS_PATTERN);
          if (endMatch >= 0) {
            urlPartLength = endMatch;
          }
        }

        rangeEnd = rangeStart + urlPartLength;
      }

      ranges.push({ start: rangeStart, end: rangeEnd });
      remainingUrl = remainingUrl.substring(rangeEnd - rangeStart);
      currentLine++;
    }
  }
}

/**
 * LinkHighlighter handles the DOM manipulation to create clickable links
 */
class LinkHighlighter {
  private lines: NodeListOf<Element>;
  private url: string;

  constructor(lines: NodeListOf<Element>, url: string) {
    this.lines = lines;
    this.url = url;
  }

  createLinks(startLine: number, endLine: number, startCol: number): void {
    let remainingUrl = this.url;

    for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
      const line = this.lines[lineIdx];
      const lineText = line.textContent || '';

      let colStart: number;
      let colEnd: number;

      if (lineIdx === startLine) {
        colStart = startCol;
        const lineUrlPart = lineText.substring(startCol);
        colEnd = startCol + Math.min(lineUrlPart.length, remainingUrl.length);
      } else {
        // Handle wrapped URLs
        const leadingWhitespace = lineText.match(/^\s*/);
        colStart = leadingWhitespace ? leadingWhitespace[0].length : 0;

        const availableText = lineText.substring(colStart);
        const urlPartLength = Math.min(availableText.length, remainingUrl.length);

        // Check for URL-ending characters
        const endMatch = availableText.match(/[\s<>"'`]/);
        const actualLength = endMatch
          ? Math.min(endMatch.index ?? urlPartLength, urlPartLength)
          : urlPartLength;

        colEnd = colStart + actualLength;
      }

      if (colStart < colEnd) {
        this.wrapTextInLink(line, colStart, colEnd);
        remainingUrl = remainingUrl.substring(colEnd - colStart);
      }

      if (remainingUrl.length === 0) break;
    }
  }

  private wrapTextInLink(lineElement: Element, startCol: number, endCol: number): void {
    // First pass: collect all text nodes and their positions
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null);
    const textNodeData: Array<{ node: Text; start: number; end: number }> = [];
    let currentPos = 0;
    let node = walker.nextNode();

    while (node) {
      const textNode = node as Text;
      const nodeText = textNode.textContent || '';
      const nodeStart = currentPos;
      const nodeEnd = currentPos + nodeText.length;

      // Only collect nodes that overlap with our range
      if (nodeEnd > startCol && nodeStart < endCol) {
        textNodeData.push({ node: textNode, start: nodeStart, end: nodeEnd });
      }

      currentPos = nodeEnd;
      node = walker.nextNode();
    }

    // Second pass: process all relevant text nodes in reverse order
    // (to avoid invalidating positions when modifying the DOM)
    for (let i = textNodeData.length - 1; i >= 0; i--) {
      const { node: textNode, start: nodeStart } = textNodeData[i];
      const nodeText = textNode.textContent || '';

      const linkStart = Math.max(0, startCol - nodeStart);
      const linkEnd = Math.min(nodeText.length, endCol - nodeStart);

      if (linkStart < linkEnd) {
        this.wrapTextNode(textNode, linkStart, linkEnd);
      }
    }
  }

  private wrapTextNode(textNode: Text, start: number, end: number): void {
    const parent = textNode.parentNode;
    if (!parent) return;

    // Don't wrap if already inside a link
    if (this.isInsideLink(parent as Element)) return;

    const nodeText = textNode.textContent || '';
    const beforeText = nodeText.substring(0, start);
    const linkText = nodeText.substring(start, end);
    const afterText = nodeText.substring(end);

    // Create the link element
    const linkElement = this.createLinkElement(linkText);

    // Replace the text node
    const fragment = document.createDocumentFragment();

    if (beforeText) {
      fragment.appendChild(document.createTextNode(beforeText));
    }

    fragment.appendChild(linkElement);

    if (afterText) {
      fragment.appendChild(document.createTextNode(afterText));
    }

    parent.replaceChild(fragment, textNode);
  }

  private createLinkElement(text: string): HTMLAnchorElement {
    const link = document.createElement('a');
    link.className = TERMINAL_LINK_CLASS;
    link.href = this.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.color = '#4fc3f7';
    link.style.textDecoration = 'underline';
    link.style.cursor = 'pointer';
    link.textContent = text;

    // Add hover effects
    link.addEventListener('mouseenter', () => {
      link.style.backgroundColor = 'rgba(79, 195, 247, 0.2)';
    });

    link.addEventListener('mouseleave', () => {
      link.style.backgroundColor = '';
    });

    return link;
  }

  private isInsideLink(element: Element): boolean {
    let current: Element | null = element;
    while (current && current !== document.body) {
      if (current.tagName === 'A' && current.classList.contains(TERMINAL_LINK_CLASS)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }
}

// Export as default for backwards compatibility
export const UrlHighlighter = {
  processLinks,
};
