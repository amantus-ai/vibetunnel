/**
 * URL Highlighter utility for DOM terminal
 *
 * Handles detection and highlighting of URLs in terminal content,
 * including multi-line URLs that span across terminal lines.
 */

/**
 * Process all lines in a container and highlight any URLs found
 * @param container - The DOM container containing terminal lines
 */
export function processLinks(container: HTMLElement): void {
  // Get all terminal lines
  const lines = container.querySelectorAll('.terminal-line');
  if (lines.length === 0) return;

  for (let i = 0; i < lines.length; i++) {
    const lineText = getLineText(lines[i]);

    // Look for http(s):// in this line
    const httpMatch = lineText.match(/(https?:\/\/)/);
    if (httpMatch && httpMatch.index !== undefined) {
      const urlStart = httpMatch.index;
      let fullUrl = '';
      let endLine = i;

      // Build the URL by scanning from the http part until we hit whitespace
      for (let j = i; j < lines.length; j++) {
        let remainingText = '';

        if (j === i) {
          // Current line: start from http position
          remainingText = lineText.substring(urlStart);
        } else {
          // Subsequent lines: take the whole trimmed line
          remainingText = getLineText(lines[j]).trim();
        }

        // Stop if line is empty (after trimming)
        if (remainingText === '') {
          endLine = j - 1; // URL ended on previous line
          break;
        }

        // Find first whitespace character in this line's text
        const whitespaceMatch = remainingText.match(/\s/);
        if (whitespaceMatch) {
          // Found whitespace, URL ends here
          fullUrl += remainingText.substring(0, whitespaceMatch.index);
          endLine = j;
          break;
        } else {
          // No whitespace, take the whole line
          fullUrl += remainingText;
          endLine = j;

          // If this is the last line, we're done
          if (j === lines.length - 1) break;
        }
      }

      // Now create links for this URL across the lines it spans
      if (fullUrl.length > 7) {
        // More than just "http://"
        createUrlLinks(lines, fullUrl, i, endLine, urlStart);
      }
    }
  }
}

function createUrlLinks(
  lines: NodeListOf<Element>,
  fullUrl: string,
  startLine: number,
  endLine: number,
  startCol: number
): void {
  let remainingUrl = fullUrl;

  for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
    const line = lines[lineIdx];
    const lineText = getLineText(line);

    if (lineIdx === startLine) {
      // First line: URL starts at startCol
      const lineUrlPart = lineText.substring(startCol);
      const urlPartLength = Math.min(lineUrlPart.length, remainingUrl.length);

      createClickableInLine(line, fullUrl, 'url', startCol, startCol + urlPartLength);
      remainingUrl = remainingUrl.substring(urlPartLength);
    } else {
      // Subsequent lines: take from start of trimmed content
      const trimmedLine = lineText.trim();
      const urlPartLength = Math.min(trimmedLine.length, remainingUrl.length);

      if (urlPartLength > 0) {
        const startColForLine = lineText.indexOf(trimmedLine);
        createClickableInLine(
          line,
          fullUrl,
          'url',
          startColForLine,
          startColForLine + urlPartLength
        );
        remainingUrl = remainingUrl.substring(urlPartLength);
      }
    }

    if (remainingUrl.length === 0) break;
  }
}

function getLineText(lineElement: Element): string {
  // Get the text content, preserving spaces but removing HTML tags
  const textContent = lineElement.textContent || '';
  return textContent;
}

function createClickableInLine(
  lineElement: Element,
  url: string,
  _type: 'url',
  startCol: number,
  endCol: number
): void {
  if (startCol >= endCol) return;

  // We need to work with the actual DOM structure, not just text
  const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null);

  const textNodes: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  let currentPos = 0;
  let foundStart = false;
  let foundEnd = false;

  for (const textNode of textNodes) {
    const nodeText = textNode.textContent || '';
    const nodeStart = currentPos;
    const nodeEnd = currentPos + nodeText.length;

    // Check if this text node contains part of our link
    if (!foundEnd && nodeEnd > startCol && nodeStart < endCol) {
      const linkStart = Math.max(0, startCol - nodeStart);
      const linkEnd = Math.min(nodeText.length, endCol - nodeStart);

      if (linkStart < linkEnd) {
        wrapTextInClickable(textNode, linkStart, linkEnd, url, !foundStart, nodeEnd >= endCol);
        foundStart = true;
        if (nodeEnd >= endCol) {
          foundEnd = true;
          break;
        }
      }
    }

    currentPos = nodeEnd;
  }
}

function wrapTextInClickable(
  textNode: Text,
  start: number,
  end: number,
  url: string,
  _isFirst: boolean,
  _isLast: boolean
): void {
  const parent = textNode.parentNode;
  if (!parent) return;

  const nodeText = textNode.textContent || '';
  const beforeText = nodeText.substring(0, start);
  const linkText = nodeText.substring(start, end);
  const afterText = nodeText.substring(end);

  // Create the link element
  const linkElement = document.createElement('a');
  linkElement.className = 'terminal-link';
  linkElement.href = url;
  linkElement.target = '_blank';
  linkElement.rel = 'noopener noreferrer';
  linkElement.style.color = '#4fc3f7';
  linkElement.style.textDecoration = 'underline';
  linkElement.style.cursor = 'pointer';
  linkElement.textContent = linkText;

  // Add hover effects
  linkElement.addEventListener('mouseenter', () => {
    linkElement.style.backgroundColor = 'rgba(79, 195, 247, 0.2)';
  });

  linkElement.addEventListener('mouseleave', () => {
    linkElement.style.backgroundColor = '';
  });

  // Replace the text node with the new structure
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

// Re-export as object for backwards compatibility
export const UrlHighlighter = {
  processLinks,
};
