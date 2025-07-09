import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '../components/monaco-editor.js';
import { Z_INDEX } from '../utils/constants.js';

@customElement('monaco-editor-test')
export class MonacoEditorTest extends LitElement {
  createRenderRoot() {
    return this;
  }

  @state() private mode: 'normal' | 'diff' = 'diff';
  @state() private readOnly = false;
  @state() private showModeToggle = true;
  @state() private language = 'typescript';
  @state() private content = '';
  @state() private originalContent = '';
  @state() private modifiedContent = '';
  @state() private savedContent = '';

  private sampleCode = {
    typescript: `// TypeScript Example
interface User {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

class UserService {
  private users: User[] = [];

  async getUser(id: number): Promise<User | undefined> {
    return this.users.find(user => user.id === id);
  }

  async createUser(user: Omit<User, 'id'>): Promise<User> {
    const newUser: User = {
      ...user,
      id: this.users.length + 1
    };
    this.users.push(newUser);
    return newUser;
  }
}

export default UserService;`,
    javascript: `// JavaScript Example
class Calculator {
  constructor() {
    this.result = 0;
  }

  add(a, b) {
    this.result = a + b;
    return this.result;
  }

  subtract(a, b) {
    this.result = a - b;
    return this.result;
  }

  multiply(a, b) {
    this.result = a * b;
    return this.result;
  }

  divide(a, b) {
    if (b === 0) {
      throw new Error('Division by zero');
    }
    this.result = a / b;
    return this.result;
  }
}

module.exports = Calculator;`,
    python: `# Python Example
import asyncio
from typing import List, Optional

class TaskManager:
    def __init__(self):
        self.tasks: List[asyncio.Task] = []
        self.results: List[any] = []
    
    async def add_task(self, coro):
        """Add a coroutine as a task"""
        task = asyncio.create_task(coro)
        self.tasks.append(task)
        return task
    
    async def wait_all(self) -> List[any]:
        """Wait for all tasks to complete"""
        if not self.tasks:
            return []
        
        self.results = await asyncio.gather(*self.tasks)
        return self.results
    
    def cancel_all(self):
        """Cancel all pending tasks"""
        for task in self.tasks:
            if not task.done():
                task.cancel()

# Example usage
async def main():
    manager = TaskManager()
    await manager.add_task(asyncio.sleep(1))
    await manager.wait_all()`,
    json: `{
  "name": "monaco-editor-test",
  "version": "1.0.0",
  "description": "Monaco Editor test component",
  "dependencies": {
    "monaco-editor": "^0.52.2",
    "lit": "^3.3.0"
  },
  "scripts": {
    "test": "echo 'Error: no test specified' && exit 1",
    "build": "tsc && vite build",
    "dev": "vite"
  },
  "keywords": ["monaco", "editor", "test"],
  "author": "VibeTunnel Team",
  "license": "MIT"
}`,
  };

  connectedCallback() {
    super.connectedCallback();
    this.loadSampleContent();
  }

  private loadSampleContent() {
    const baseContent =
      this.sampleCode[this.language as keyof typeof this.sampleCode] || this.sampleCode.typescript;

    // For normal mode
    this.content = baseContent;

    // Always set diff content so it's ready when switching modes
    this.originalContent = baseContent;
    this.modifiedContent = `${baseContent}\n\n// Modified by user\nconsole.log("Changes made!");`;
  }

  private handleModeChange(newMode: 'normal' | 'diff') {
    this.mode = newMode;
    this.loadSampleContent();
  }

  private handleLanguageChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.language = select.value;
    this.loadSampleContent();
  }

  private handleSave(e: CustomEvent) {
    this.savedContent = e.detail.content;
    console.log('Content saved:', this.savedContent);
    alert('Content saved! Check console for details.');
  }

  private handleContentChanged(e: CustomEvent) {
    console.log('Content changed:', e.detail.content);
  }

  render() {
    return html`
      <div class="h-screen flex flex-col bg-background text-foreground">
        <div class="bg-surface border-b border-gray-800 p-4">
          <h1 class="text-2xl font-bold text-emerald-400 mb-4">Monaco Editor Test</h1>
          <div class="flex gap-3 flex-wrap items-center">
            <span class="text-sm text-gray-400">Mode:</span>
            <button
              class="${
                this.mode === 'normal'
                  ? 'bg-emerald-500 text-background'
                  : 'bg-gray-800 hover:bg-gray-700 text-foreground'
              } px-3 py-1.5 border ${
                this.mode === 'normal'
                  ? 'border-emerald-500'
                  : 'border-gray-700 hover:border-emerald-400'
              } rounded text-sm transition-colors"
              @click=${() => this.handleModeChange('normal')}
            >
              Normal
            </button>
            <button
              class="${
                this.mode === 'diff'
                  ? 'bg-emerald-500 text-background'
                  : 'bg-gray-800 hover:bg-gray-700 text-foreground'
              } px-3 py-1.5 border ${
                this.mode === 'diff'
                  ? 'border-emerald-500'
                  : 'border-gray-700 hover:border-emerald-400'
              } rounded text-sm transition-colors"
              @click=${() => this.handleModeChange('diff')}
            >
              Diff
            </button>

            <span class="text-sm text-gray-400 ml-4">Language:</span>
            <select
              @change=${this.handleLanguageChange}
              .value=${this.language}
              class="px-3 py-1.5 bg-gray-800 text-foreground border border-gray-700 hover:border-emerald-400 rounded text-sm cursor-pointer focus:outline-none focus:border-emerald-400"
            >
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="json">JSON</option>
            </select>

            <label class="flex items-center gap-2 ml-4 text-sm cursor-pointer">
              <input
                type="checkbox"
                .checked=${this.readOnly}
                @change=${(e: Event) => {
                  this.readOnly = (e.target as HTMLInputElement).checked;
                }}
                class="w-4 h-4 rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-400 focus:ring-offset-0"
              />
              <span>Read Only</span>
            </label>

            ${
              this.mode === 'diff'
                ? html`
                  <label class="flex items-center gap-2 ml-4 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      .checked=${this.showModeToggle}
                      @change=${(e: Event) => {
                        this.showModeToggle = (e.target as HTMLInputElement).checked;
                      }}
                      class="w-4 h-4 rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-400 focus:ring-offset-0"
                    />
                    <span>Show Mode Toggle</span>
                  </label>
                `
                : ''
            }
          </div>
        </div>

        <div class="flex-1 relative overflow-hidden border border-gray-800 m-4 rounded-lg">
          <div
            class="absolute top-4 right-4 bg-black/80 border border-gray-800 rounded px-3 py-1.5 text-xs"
            style="z-index: ${Z_INDEX.TERMINAL_OVERLAY};"
          >
            <div>Mode: <code class="text-emerald-400">${this.mode}</code></div>
            <div>Language: <code class="text-emerald-400">${this.language}</code></div>
            <div>Read Only: <code class="text-emerald-400">${this.readOnly}</code></div>
          </div>

          <monaco-editor
            .mode=${this.mode}
            .content=${this.content}
            .originalContent=${this.originalContent}
            .modifiedContent=${this.modifiedContent}
            .language=${this.language}
            .readOnly=${this.readOnly}
            .showModeToggle=${this.showModeToggle}
            @save=${this.handleSave}
            @content-changed=${this.handleContentChanged}
            style="width: 100%; height: 100%;"
          ></monaco-editor>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'monaco-editor-test': MonacoEditorTest;
  }
}
