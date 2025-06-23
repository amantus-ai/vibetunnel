# Virtual Terminal Output Component

A high-performance virtual scrolling component for terminal output in Lit applications.

## Features

- **Virtual Scrolling**: Only renders visible lines for optimal performance with thousands of lines
- **Auto-scroll**: Automatically scrolls to bottom as new content arrives
- **Smooth Scrolling**: Uses requestAnimationFrame for butter-smooth auto-scrolling
- **Type Support**: Different line types (stdout, stderr, system) with color coding
- **Memory Management**: Configurable max lines limit to prevent memory issues
- **Responsive**: Automatically recalculates visible lines on resize

## Usage

```typescript
import './terminal/virtual-terminal-output';

// In your component
@customElement('my-terminal')
export class MyTerminal extends LitElement {
  @state()
  private _terminalOutput: TerminalLine[] = [];

  override render() {
    return html`
      <virtual-terminal-output
        .lines=${this._terminalOutput}
        .maxLines=${10000}
        .autoScroll=${true}
      ></virtual-terminal-output>
    `;
  }

  // Add output
  private addOutput(content: string, type?: 'stdout' | 'stderr' | 'system') {
    const output = this.shadowRoot?.querySelector('virtual-terminal-output');
    output?.appendLine(content, type);
  }
}
```

## Integration with Session Detail

To integrate with the session-detail-app component:

```typescript
// In session-detail-app.ts
import './terminal/virtual-terminal-output';

// Replace the terminal output section with:
<virtual-terminal-output
  .lines=${this._terminalLines}
  .maxLines=${5000}
  .autoScroll=${true}
  @terminal-command=${this._handleTerminalCommand}
></virtual-terminal-output>
```

## Performance Tips

1. **Line Height**: Keep line height consistent for optimal virtual scrolling
2. **Max Lines**: Set a reasonable limit based on your use case
3. **Overscan**: The component renders 10 extra lines outside viewport for smooth scrolling
4. **Debouncing**: Scroll events are debounced to prevent excessive recalculations

## Styling

The component uses CSS custom properties for theming:

```css
virtual-terminal-output {
  --terminal-bg: #1e1e1e;
  --terminal-fg: #d4d4d4;
  --terminal-error: #f48771;
  --terminal-system: #6a9955;
  --font-mono: 'SF Mono', Monaco, Consolas, monospace;
}
```

## API

### Properties

- `lines: TerminalLine[]` - Array of terminal lines to display
- `maxLines: number` - Maximum number of lines to keep (default: 10000)
- `autoScroll: boolean` - Auto-scroll to bottom on new content (default: true)
- `lineHeight: number` - Height of each line in pixels (default: 21)

### Methods

- `appendLine(content: string, type?: 'stdout' | 'stderr' | 'system')` - Add a new line
- `clear()` - Clear all lines
- `scrollToTop()` - Scroll to the beginning
- `scrollToBottom()` - Scroll to the end
- `scrollToLine(index: number)` - Scroll to a specific line

## Example: Real-time Terminal Output

```typescript
// WebSocket integration example
private _connectToTerminal() {
  const ws = new WebSocket('ws://localhost:5173/terminal');
  
  ws.onmessage = (event) => {
    const output = this.shadowRoot?.querySelector('virtual-terminal-output');
    const data = JSON.parse(event.data);
    
    output?.appendLine(data.content, data.type);
  };
}
```