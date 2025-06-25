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

  // Track which line positions have already been processed to avoid double-processing
  const processedRanges: Map<number, Array<{start: number, end: number}>> = new Map();

  for (let i = 0; i < lines.length; i++) {
    let lineText = getLineText(lines[i]);
    let searchOffset = 0;

    // First, check if this line might be a continuation of a URL from the previous line
    if (i > 0) {
      const prevLineText = getLineText(lines[i - 1]);
      
      // Check for various incomplete URL patterns at the end of previous line
      let incompleteUrlMatch = null;
      let potentialUrlStart = -1;
      
      // Pattern 1: Complete protocol with partial URL (https://exam)
      incompleteUrlMatch = prevLineText.match(/(https?:\/\/|file:\/\/)([^\s]*?)$/);
      if (incompleteUrlMatch) {
        potentialUrlStart = incompleteUrlMatch.index!;
      }
      
      // Pattern 2: Partial protocol at end of line (ht, htt, http, https, https:, https:/)
      if (!incompleteUrlMatch) {
        const partialProtocolMatch = prevLineText.match(/(^|\s)(h|ht|htt|http|https|https:|https:\/|f|fi|fil|file|file:|file:\/)$/);
        if (partialProtocolMatch && lineText.match(/^(ttps?:\/\/|tps?:\/\/|ps?:\/\/|s?:\/\/|:\/\/|\/\/|\/|ile:\/\/|le:\/\/|e:\/\/)/)) {
          potentialUrlStart = partialProtocolMatch.index! + (partialProtocolMatch[1] ? 1 : 0);
          incompleteUrlMatch = partialProtocolMatch;
        }
      }
      
      if (incompleteUrlMatch && potentialUrlStart >= 0) {
        // Get the partial URL from the end of previous line
        const partialUrl = prevLineText.substring(potentialUrlStart);
        
        // Build the complete URL starting from previous line
        let fullUrl = partialUrl;
        let endLine = i;
        
        // Continue building from current line
        for (let j = i; j < lines.length; j++) {
          const currentLineText = getLineText(lines[j]);
          let remainingText = currentLineText;
          
          if (j > i && remainingText.match(/^\s/)) {
            endLine = j - 1;
            break;
          }
          
          const whitespaceMatch = remainingText.match(/\s/);
          if (whitespaceMatch) {
            fullUrl += remainingText.substring(0, whitespaceMatch.index);
            endLine = j;
            break;
          } else {
            fullUrl += remainingText;
            endLine = j;
            if (j === lines.length - 1) break;
          }
        }
        
        fullUrl = cleanUrl(fullUrl);
        
        // Only create links if it's a valid URL and hasn't been processed
        if (fullUrl.length > 7 && isValidUrl(fullUrl)) {
          // Check if this URL was already processed
          let alreadyProcessed = false;
          for (let lineIdx = i - 1; lineIdx <= endLine; lineIdx++) {
            const ranges = processedRanges.get(lineIdx) || [];
            if (lineIdx === i - 1) {
              if (ranges.some(r => r.start <= potentialUrlStart && r.end > potentialUrlStart)) {
                alreadyProcessed = true;
                break;
              }
            } else {
              if (ranges.some(r => r.start === 0)) {
                alreadyProcessed = true;
                break;
              }
            }
          }
          
          if (!alreadyProcessed) {
            createUrlLinks(lines, fullUrl, i - 1, endLine, potentialUrlStart);
            
            // Track processed ranges
            for (let lineIdx = i - 1; lineIdx <= endLine; lineIdx++) {
              if (!processedRanges.has(lineIdx)) {
                processedRanges.set(lineIdx, []);
              }
              
              if (lineIdx === i - 1) {
                processedRanges.get(lineIdx)!.push({ start: potentialUrlStart, end: prevLineText.length });
              } else if (lineIdx === endLine) {
                // For the last line, only mark the URL portion as processed
                const lastLineText = getLineText(lines[lineIdx]);
                const urlEndPos = lastLineText.indexOf(' ');
                processedRanges.get(lineIdx)!.push({ 
                  start: 0, 
                  end: urlEndPos > 0 ? urlEndPos : lastLineText.length 
                });
              } else {
                processedRanges.get(lineIdx)!.push({ start: 0, end: getLineText(lines[lineIdx]).length });
              }
            }
          }
        }
      }
    }

    // Look for ALL URLs in this line (not just the first one)
    while (true) {
      const urlMatch = lineText.substring(searchOffset).match(/(https?:\/\/|file:\/\/)/);
      if (!urlMatch || urlMatch.index === undefined) break;
      
      const urlStart = searchOffset + urlMatch.index;
      
      // Check if this position was already processed (e.g., as part of a multi-line URL)
      const lineRanges = processedRanges.get(i) || [];
      const alreadyProcessed = lineRanges.some(range => 
        urlStart >= range.start && urlStart < range.end
      );
      
      if (alreadyProcessed) {
        searchOffset = urlStart + 1;
        continue;
      }
      
      let fullUrl = '';
      let endLine = i;

      // Build the URL by scanning from the http part until we hit whitespace or invalid URL characters
      for (let j = i; j < lines.length; j++) {
        let remainingText = '';

        if (j === i) {
          // Current line: start from http position
          remainingText = lineText.substring(urlStart);
        } else {
          // Subsequent lines: take the whole line content without trimming first
          // This handles URLs that wrap mid-word on mobile devices
          const nextLineText = getLineText(lines[j]);

          // If the line starts with whitespace, the URL has ended
          if (nextLineText.match(/^\s/)) {
            endLine = j - 1;
            break;
          }

          // For wrapped URLs, we need to consider the entire line content
          // But we still need to stop at the first whitespace within the line
          remainingText = nextLineText;
        }

        // Stop if line is completely empty
        if (remainingText === '') {
          endLine = j - 1; // URL ended on previous line
          break;
        }

        // Find first whitespace character in this line's text
        const whitespaceMatch = remainingText.match(/\s/);
        if (whitespaceMatch) {
          // Found whitespace, URL ends here
          const urlPart = remainingText.substring(0, whitespaceMatch.index);
          fullUrl += urlPart;
          endLine = j;
          break;
        } else {
          // No whitespace found, but check if this looks like a URL continuation
          // URLs can contain many characters, but certain characters indicate the URL has ended
          // Updated regex to be more permissive with URL characters
          const urlEndMatch = remainingText.match(/[^\w\-._~:/?#[\]@!$&'()*+,;=%\{\}|\\^`]/);
          if (urlEndMatch && urlEndMatch.index !== undefined && urlEndMatch.index > 0) {
            // Found a character that likely ends the URL
            const urlPart = remainingText.substring(0, urlEndMatch.index);
            fullUrl += urlPart;
            endLine = j;
            break;
          } else if (urlEndMatch && urlEndMatch.index === 0) {
            // URL ended at the beginning of this line
            endLine = j - 1;
            break;
          } else {
            // Take the whole line - likely a wrapped URL continuation
            fullUrl += remainingText;
            endLine = j;

            // If this is the last line, we're done
            if (j === lines.length - 1) break;
          }
        }
      }

      // Clean up the URL by removing common terminal artifacts
      fullUrl = cleanUrl(fullUrl);

      // Now create links for this URL across the lines it spans
      if (fullUrl.length > 7 && isValidUrl(fullUrl)) {
        // More than just "http://" and looks like a valid URL
        createUrlLinks(lines, fullUrl, i, endLine, urlStart);
        
        // Track processed ranges to avoid double-processing
        for (let lineIdx = i; lineIdx <= endLine; lineIdx++) {
          if (!processedRanges.has(lineIdx)) {
            processedRanges.set(lineIdx, []);
          }
          
          if (lineIdx === i) {
            // First line: from urlStart to end of URL part on this line
            const endPos = lineIdx === endLine ? urlStart + fullUrl.length : getLineText(lines[lineIdx]).length;
            processedRanges.get(lineIdx)!.push({ start: urlStart, end: endPos });
          } else {
            // Other lines: entire line is part of URL (approximately)
            processedRanges.get(lineIdx)!.push({ start: 0, end: getLineText(lines[lineIdx]).length });
          }
        }
      }
      
      // Move search offset forward to look for more URLs in the same line
      searchOffset = urlStart + Math.max(fullUrl.length, 1);
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
      // Subsequent lines: handle both trimmed and non-trimmed cases for wrapped URLs
      let startColForLine = 0;
      let availableText = lineText;

      // If the line starts with whitespace, the URL continuation starts after the whitespace
      const leadingWhitespace = lineText.match(/^\s*/);
      if (leadingWhitespace && leadingWhitespace[0].length > 0) {
        startColForLine = leadingWhitespace[0].length;
        availableText = lineText.substring(startColForLine);
      }

      // For mobile wrapped URLs, we need to be more careful about what part of the line contains the URL
      const urlPartLength = Math.min(availableText.length, remainingUrl.length);

      if (urlPartLength > 0) {
        // Find where whitespace or URL-ending characters appear in the available text
        // Be more careful about what ends a URL - don't include characters that are commonly in URLs
        const endMatch = availableText.match(/[\s<>"'`]/);
        const actualUrlLength = endMatch
          ? Math.min(endMatch.index || urlPartLength, urlPartLength)
          : urlPartLength;

        if (actualUrlLength > 0) {
          createClickableInLine(
            line,
            fullUrl,
            'url',
            startColForLine,
            startColForLine + actualUrlLength
          );
          remainingUrl = remainingUrl.substring(actualUrlLength);
        }
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

/**
 * Clean up a URL by removing common terminal artifacts and trailing punctuation
 * @param url - The raw URL string
 * @returns The cleaned URL
 */
function cleanUrl(url: string): string {
  // Remove common trailing punctuation that's not part of URLs
  // But be careful with parentheses - they might be part of the URL
  let cleaned = url;
  
  // First, try to balance parentheses
  const openParens = (cleaned.match(/\(/g) || []).length;
  const closeParens = (cleaned.match(/\)/g) || []).length;
  
  // If we have more closing parens than opening, remove trailing ones
  if (closeParens > openParens) {
    cleaned = cleaned.replace(/\)+$/, (match) => {
      const toRemove = closeParens - openParens;
      return match.substring(toRemove);
    });
  }
  
  // Remove other common trailing punctuation
  cleaned = cleaned.replace(/[.,;:!?]+$/, '');
  
  return cleaned;
}

/**
 * Check if a string looks like a valid URL
 * @param url - The URL string to validate
 * @returns True if the URL appears valid
 */
function isValidUrl(url: string): boolean {
  try {
    // Basic validation: must start with http(s):// or file://, and have valid path
    // Allow localhost, IP addresses, and domains with TLDs
    if (!url.match(/^(https?:\/\/(localhost|[\d.]+|\[[\da-fA-F:]+\]|.+\..+)(:\d+)?.*|file:\/\/.+)/)) {
      return false;
    }

    // Check for obvious non-URL characters that might indicate terminal artifacts
    if (url.includes('\n') || url.includes('\r') || url.includes('\t')) {
      return false;
    }

    // Try to parse it as a URL
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Re-export as object for backwards compatibility
export const UrlHighlighter = {
  processLinks,
};
