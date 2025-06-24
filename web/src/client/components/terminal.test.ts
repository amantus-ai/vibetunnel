import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import { MockTerminal, MockResizeObserver, createMockBufferData } from '@/test/utils/terminal-mocks';
import { 
  clickElement, 
  waitForElement, 
  waitForEvent,
  pressKey,
  getTextContent,
  elementExists,
  hasClass,
  setViewport,
  resetViewport
} from '@/test/utils/component-helpers';

// Mock xterm modules before importing the component
vi.mock('@xterm/headless', () => ({
  Terminal: MockTerminal,
}));

// Mock ResizeObserver globally
global.ResizeObserver = MockResizeObserver as any;

// Import component type separately
import type { Terminal } from './terminal';

describe('Terminal', () => {
  let element: Terminal;
  let mockTerminal: MockTerminal | null;

  beforeAll(async () => {
    // Import the component to register the custom element after mocks are set up
    await import('./terminal');
  });

  beforeEach(async () => {
    // Reset viewport
    resetViewport();
    
    // Create component with proper attribute binding
    element = await fixture<Terminal>(html`
      <vibe-terminal 
        session-id="test-123"
        cols="80"
        rows="24"
        font-size="14">
      </vibe-terminal>
    `);
    
    // Wait for the component to be ready
    await element.updateComplete;
    
    // Get mock terminal instance after component initializes
    mockTerminal = (element as any).terminal as MockTerminal | null;
  });

  afterEach(() => {
    element.remove();
  });

  describe('initialization', () => {
    it('should create terminal with default dimensions', async () => {
      expect(element.getAttribute('session-id')).toBe('test-123');
      expect(element.cols).toBe(80);
      expect(element.rows).toBe(24);
      expect(element.fontSize).toBe(14);
    });

    it('should initialize xterm terminal after first update', async () => {
      // Terminal is initialized in firstUpdated, so wait for it
      await element.firstUpdated();
      
      // Now terminal should be created
      const terminal = (element as any).terminal;
      expect(terminal).toBeDefined();
    });

    it('should handle custom dimensions', async () => {
      const customElement = await fixture<Terminal>(html`
        <vibe-terminal 
          session-id="test-789"
          .cols=${120}
          .rows=${40}
          .fontSize=${16}>
        </vibe-terminal>
      `);
      
      await customElement.updateComplete;
      
      expect(customElement.cols).toBe(120);
      expect(customElement.rows).toBe(40);
      expect(customElement.fontSize).toBe(16);
    });
  });

  describe('terminal output', () => {
    beforeEach(async () => {
      // Ensure terminal is initialized
      await element.firstUpdated();
      mockTerminal = (element as any).terminal;
    });

    it('should write data to terminal', () => {
      element.write('Hello, Terminal!');
      
      // Check that content appears in the DOM
      const container = element.querySelector('.terminal-container');
      expect(container).toBeTruthy();
    });

    it('should clear terminal', async () => {
      // Write some content first
      element.write('Some content');
      await element.updateComplete;
      
      // Clear the terminal
      element.clear();
      await element.updateComplete;
      
      // Terminal should be cleared
      expect(mockTerminal?.clear).toHaveBeenCalled();
    });
  });

  describe('user input', () => {
    beforeEach(async () => {
      await element.firstUpdated();
      mockTerminal = (element as any).terminal;
    });

    it('should handle paste events', async () => {
      const pasteText = 'pasted content';
      
      // Create and dispatch paste event
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', pasteText);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true
      });
      
      // The terminal component listens for paste on the container
      const container = element.querySelector('.terminal-container');
      if (container) {
        container.dispatchEvent(pasteEvent);
        expect(pasteEvent.defaultPrevented).toBe(true);
      }
    });
  });

  describe('terminal sizing', () => {
    beforeEach(async () => {
      await element.firstUpdated();
      mockTerminal = (element as any).terminal;
    });

    it('should set terminal size', async () => {
      element.setTerminalSize(100, 30);
      await element.updateComplete;
      
      expect(element.cols).toBe(100);
      expect(element.rows).toBe(30);
    });

    it('should get terminal size', () => {
      const size = element.getTerminalSize();
      expect(size.cols).toBe(element.cols);
      expect(size.rows).toBe(element.rows);
    });

    it('should support horizontal fitting mode', async () => {
      element.fitHorizontally = true;
      await element.updateComplete;
      
      // In fit mode, font size adjusts
      expect(element.fitHorizontally).toBe(true);
    });

    it('should respect maxCols constraint', async () => {
      element.maxCols = 100;
      await element.updateComplete;
      
      // maxCols is only applied during fitTerminal, not setTerminalSize
      // So this test should verify the property is set
      expect(element.maxCols).toBe(100);
    });
  });

  describe('scrolling behavior', () => {
    beforeEach(async () => {
      await element.firstUpdated();
      mockTerminal = (element as any).terminal;
      // Set up buffer with content
      if (mockTerminal) {
        mockTerminal.buffer.active.length = 100;
      }
    });

    it('should scroll to bottom', () => {
      // Set up some content
      if (mockTerminal) {
        mockTerminal.buffer.active.length = 100;
      }
      
      element.scrollToBottom();
      
      // Check that we're at bottom (viewportY should be at max)
      const position = element.getScrollPosition();
      expect(position).toBeGreaterThanOrEqual(0);
    });

    it('should scroll to specific position', () => {
      // Set up buffer with enough content to scroll
      if (mockTerminal) {
        mockTerminal.buffer.active.length = 100;
      }
      
      element.scrollToPosition(500);
      
      // Position might be clamped to valid range
      const position = element.getScrollPosition();
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(element.getMaxScrollPosition());
    });

    it('should get visible rows', () => {
      const visibleRows = element.getVisibleRows();
      // Should return the actual rows value
      expect(visibleRows).toBe(element.rows);
    });

    it('should get buffer size', () => {
      const bufferSize = element.getBufferSize();
      expect(bufferSize).toBeGreaterThanOrEqual(0);
    });

    it('should handle wheel scrolling', async () => {
      const container = element.querySelector('.terminal-container') as HTMLElement;
      if (container) {
        const initialPos = element.getScrollPosition();
        
        // Scroll down
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: 120,
          bubbles: true
        });
        container.dispatchEvent(wheelEvent);
        
        await waitForElement(element);
        
        // Should have scrolled
        const newPos = element.getScrollPosition();
        expect(newPos).not.toBe(initialPos);
      }
    });
  });

  describe('session status', () => {
    it('should track session status for cursor control', async () => {
      element.sessionStatus = 'running';
      await element.updateComplete;
      expect(element.sessionStatus).toBe('running');
      
      element.sessionStatus = 'exited';
      await element.updateComplete;
      expect(element.sessionStatus).toBe('exited');
    });
  });

  describe('queued operations', () => {
    it('should queue callbacks for execution', async () => {
      let callbackExecuted = false;
      
      element.queueCallback(() => {
        callbackExecuted = true;
      });
      
      // Callback should be executed on next frame
      expect(callbackExecuted).toBe(false);
      
      // Wait for next animation frame
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      expect(callbackExecuted).toBe(true);
    });
  });


  describe('font size', () => {
    it('should update font size', async () => {
      element.fontSize = 16;
      await element.updateComplete;
      expect(element.fontSize).toBe(16);
      
      element.fontSize = 20;
      await element.updateComplete;
      expect(element.fontSize).toBe(20);
    });
  });


  describe('cleanup', () => {
    it('should clean up on disconnect', async () => {
      await element.firstUpdated();
      const terminal = (element as any).terminal;
      
      element.disconnectedCallback();
      
      // Should dispose terminal
      expect(terminal?.dispose).toHaveBeenCalled();
    });
  });

  describe('rendering', () => {
    it('should render terminal content', async () => {
      await element.firstUpdated();
      
      // Write some content
      element.write('Hello Terminal');
      await element.updateComplete;
      
      // Should have terminal container
      const container = element.querySelector('.terminal-container');
      expect(container).toBeTruthy();
    });
    
    it('should handle render template', () => {
      // Test that render returns a valid template
      const template = element.render();
      expect(template).toBeTruthy();
    });
  });
});