// @vitest-environment happy-dom
import { expect, fixture, html } from '@open-wc/testing';
import { vi } from 'vitest';
import { DEFAULT_QUICK_START_COMMANDS, type QuickStartCommand } from '../../types/config.js';
import './quick-start-editor.js';
import type { QuickStartEditor } from './quick-start-editor.js';

describe('QuickStartEditor', () => {
  let element: QuickStartEditor;

  const defaultCommands: QuickStartCommand[] = [
    { name: '✨ claude', command: 'claude' },
    { command: 'zsh' },
    { name: '▶️ pnpm run dev', command: 'pnpm run dev' },
  ];

  beforeEach(async () => {
    element = await fixture<QuickStartEditor>(html`
      <quick-start-editor .commands=${defaultCommands}></quick-start-editor>
    `);
  });

  describe('Initial state', () => {
    it('should render edit button when not editing', () => {
      const button = element.querySelector('#quick-start-edit-button');
      expect(button).to.exist;
      expect(button?.textContent).to.include('Edit');
    });

    it('should not show editor UI when not editing', () => {
      const editor = element.querySelector('.space-y-2');
      expect(editor).to.not.exist;
    });
  });

  describe('Edit mode', () => {
    beforeEach(async () => {
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;
    });

    it('should show editor UI when editing', () => {
      const editor = element.querySelector('.space-y-2');
      expect(editor).to.exist;
    });

    it('should display all commands', () => {
      const commandInputs = element.querySelectorAll('input[data-command-input]');
      expect(commandInputs).to.have.length(3);
      expect((commandInputs[0] as HTMLInputElement).value).to.equal('claude');
      expect((commandInputs[1] as HTMLInputElement).value).to.equal('zsh');
      expect((commandInputs[2] as HTMLInputElement).value).to.equal('pnpm run dev');
    });

    it('should display command names', () => {
      const nameInputs = element.querySelectorAll('input[placeholder="Display name (optional)"]');
      expect(nameInputs).to.have.length(3);
      expect((nameInputs[0] as HTMLInputElement).value).to.equal('✨ claude');
      expect((nameInputs[1] as HTMLInputElement).value).to.equal('');
      expect((nameInputs[2] as HTMLInputElement).value).to.equal('▶️ pnpm run dev');
    });

    it('should show save and cancel buttons', () => {
      const saveButton = element.querySelector('#quick-start-save-button');
      const cancelButton = element.querySelector('#quick-start-cancel-button');
      expect(saveButton).to.exist;
      expect(cancelButton).to.exist;
    });
  });

  describe('Adding commands', () => {
    beforeEach(async () => {
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;
    });

    it('should add new command when add button is clicked', async () => {
      const addButton = element.querySelector(
        '#quick-start-add-command-button'
      ) as HTMLButtonElement;
      expect(addButton).to.exist;
      addButton.click();
      await element.updateComplete;

      const commandInputs = element.querySelectorAll('input[data-command-input]');
      expect(commandInputs).to.have.length(4);
      expect((commandInputs[3] as HTMLInputElement).value).to.equal('');
    });

    it('should focus new command input', async () => {
      const addButton = element.querySelector(
        '#quick-start-add-command-button'
      ) as HTMLButtonElement;
      expect(addButton).to.exist;
      addButton.click();
      await element.updateComplete;

      // Wait for setTimeout in handleAddCommand
      await new Promise((resolve) => setTimeout(resolve, 50));

      const commandInputs = element.querySelectorAll('input[data-command-input]');
      const lastInput = commandInputs[commandInputs.length - 1] as HTMLInputElement;
      expect(document.activeElement).to.equal(lastInput);
    });
  });

  describe('Editing commands', () => {
    beforeEach(async () => {
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;
    });

    it('should update command value on input', async () => {
      const commandInput = element.querySelector('input[data-command-input]') as HTMLInputElement;
      commandInput.value = 'bash';
      commandInput.dispatchEvent(new Event('input'));
      await element.updateComplete;

      expect(element.editableCommands[0].command).to.equal('bash');
    });

    it('should update name value on input', async () => {
      const nameInput = element.querySelector(
        'input[placeholder="Display name (optional)"]'
      ) as HTMLInputElement;
      nameInput.value = '🚀 bash';
      nameInput.dispatchEvent(new Event('input'));
      await element.updateComplete;

      expect(element.editableCommands[0].name).to.equal('🚀 bash');
    });

    it('should set name to undefined when cleared', async () => {
      const nameInput = element.querySelector(
        'input[placeholder="Display name (optional)"]'
      ) as HTMLInputElement;
      nameInput.value = '';
      nameInput.dispatchEvent(new Event('input'));
      await element.updateComplete;

      expect(element.editableCommands[0].name).to.be.undefined;
    });
  });

  describe('Removing commands', () => {
    beforeEach(async () => {
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;
    });

    it('should remove command when remove button is clicked', async () => {
      const removeButton = element.querySelector(
        '#quick-start-remove-command-1'
      ) as HTMLButtonElement;
      expect(removeButton).to.exist;

      removeButton.click();
      await element.updateComplete;

      const commandInputs = element.querySelectorAll('input[data-command-input]');
      expect(commandInputs).to.have.length(2);
      expect((commandInputs[0] as HTMLInputElement).value).to.equal('claude');
      expect((commandInputs[1] as HTMLInputElement).value).to.equal('pnpm run dev');
    });
  });

  describe('Saving changes', () => {
    let changedListener: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      changedListener = vi.fn();
      element.addEventListener('quick-start-changed', changedListener);

      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;
    });

    it('should emit quick-start-changed event with valid commands', async () => {
      const saveButton = element.querySelector('#quick-start-save-button') as HTMLButtonElement;
      expect(saveButton).to.exist;
      saveButton.click();
      await element.updateComplete;

      expect(changedListener.mock.calls.length).to.equal(1);
      const event = changedListener.mock.calls[0][0] as CustomEvent<QuickStartCommand[]>;
      expect(event.detail).to.deep.equal(defaultCommands);
    });

    it('should filter out empty commands when saving', async () => {
      // Add an empty command
      const addButton = element.querySelector(
        '#quick-start-add-command-button'
      ) as HTMLButtonElement;
      expect(addButton).to.exist;
      addButton.click();
      await element.updateComplete;

      const saveButton = element.querySelector('#quick-start-save-button') as HTMLButtonElement;
      expect(saveButton).to.exist;
      saveButton.click();
      await element.updateComplete;

      expect(changedListener.mock.calls.length).to.equal(1);
      const event = changedListener.mock.calls[0][0] as CustomEvent<QuickStartCommand[]>;
      expect(event.detail).to.have.length(3); // Empty command filtered out
    });

    it('should exit edit mode after saving', async () => {
      const saveButton = element.querySelector('#quick-start-save-button') as HTMLButtonElement;
      expect(saveButton).to.exist;
      saveButton.click();
      await element.updateComplete;

      expect(element.editing).to.be.false;
      const editButtonAfterSave = element.querySelector('#quick-start-edit-button');
      expect(editButtonAfterSave).to.exist;
    });
  });

  describe('Canceling changes', () => {
    beforeEach(async () => {
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;
    });

    it('should revert changes when cancel is clicked', async () => {
      // Make a change
      const commandInput = element.querySelector('input[data-command-input]') as HTMLInputElement;
      commandInput.value = 'bash';
      commandInput.dispatchEvent(new Event('input'));
      await element.updateComplete;

      // Cancel
      const cancelButton = element.querySelector('#quick-start-cancel-button') as HTMLButtonElement;
      expect(cancelButton).to.exist;
      cancelButton.click();
      await element.updateComplete;

      // Re-enter edit mode to check
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;

      const firstCommand = element.querySelector('input[data-command-input]') as HTMLInputElement;
      expect(firstCommand.value).to.equal('claude'); // Reverted to original
    });

    it('should emit cancel event', async () => {
      const cancelListener = vi.fn();
      element.addEventListener('cancel', cancelListener);

      const cancelButton = element.querySelector('#quick-start-cancel-button') as HTMLButtonElement;
      expect(cancelButton).to.exist;
      cancelButton.click();
      await element.updateComplete;

      expect(cancelListener.mock.calls.length).to.equal(1);
    });

    it('should exit edit mode after canceling', async () => {
      const cancelButton = element.querySelector('#quick-start-cancel-button') as HTMLButtonElement;
      expect(cancelButton).to.exist;
      cancelButton.click();
      await element.updateComplete;

      expect(element.editing).to.be.false;
      const editButtonAfterCancel = element.querySelector('#quick-start-edit-button');
      expect(editButtonAfterCancel).to.exist;
    });
  });

  describe('Drag and drop', () => {
    beforeEach(async () => {
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;
    });

    it('should have draggable elements', () => {
      const draggableElements = element.querySelectorAll('[draggable="true"]');
      expect(draggableElements).to.have.length(3);
    });

    it('should handle drag start', () => {
      const draggableElement = element.querySelector('[draggable="true"]') as HTMLElement;
      const dragStartEvent = new DragEvent('dragstart', {
        dataTransfer: new DataTransfer(),
      });

      draggableElement.dispatchEvent(dragStartEvent);
      expect(element.draggedIndex).to.equal(0);
    });

    it('should handle drag end', () => {
      element.draggedIndex = 0;
      const draggableElement = element.querySelector('[draggable="true"]') as HTMLElement;
      draggableElement.classList.add('opacity-50');

      const dragEndEvent = new DragEvent('dragend');
      draggableElement.dispatchEvent(dragEndEvent);

      expect(element.draggedIndex).to.be.null;
      expect(draggableElement.classList.contains('opacity-50')).to.be.false;
    });

    it('should reorder items on drop', async () => {
      // Simulate dragging item at index 0 to index 2
      element.draggedIndex = 0;

      const dropTarget = element.querySelectorAll('[draggable="true"]')[2] as HTMLElement;
      const dropEvent = new DragEvent('drop', {
        dataTransfer: new DataTransfer(),
      });
      dropEvent.preventDefault = vi.fn();

      dropTarget.dispatchEvent(dropEvent);
      await element.updateComplete;

      // Check new order - dragging item 0 to position 2 means:
      // Original: [claude, zsh, pnpm run dev]
      // After removing claude: [zsh, pnpm run dev]
      // Insert at adjusted index 1: [zsh, claude, pnpm run dev]
      const commandInputs = element.querySelectorAll('input[data-command-input]');
      expect((commandInputs[0] as HTMLInputElement).value).to.equal('zsh');
      expect((commandInputs[1] as HTMLInputElement).value).to.equal('claude');
      expect((commandInputs[2] as HTMLInputElement).value).to.equal('pnpm run dev');
    });
  });

  describe('Props updates', () => {
    it('should update editableCommands when commands prop changes', async () => {
      const newCommands: QuickStartCommand[] = [{ command: 'python3' }, { command: 'node' }];

      element.commands = newCommands;
      await element.updateComplete;

      // Enter edit mode to check
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;

      const commandInputs = element.querySelectorAll('input[data-command-input]');
      expect(commandInputs).to.have.length(2);
      expect((commandInputs[0] as HTMLInputElement).value).to.equal('python3');
      expect((commandInputs[1] as HTMLInputElement).value).to.equal('node');
    });
  });

  describe('Reset to Defaults', () => {
    beforeEach(async () => {
      // Set up with modified commands
      const modifiedCommands: QuickStartCommand[] = [
        { command: 'python3' },
        { name: 'Node', command: 'node' },
      ];
      element.commands = modifiedCommands;
      await element.updateComplete;

      // Enter edit mode
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;
    });

    it('should show Reset to Defaults button in edit mode', () => {
      const resetButton = element.querySelector('#quick-start-reset-button');
      expect(resetButton).to.exist;
    });

    it('should reset commands to defaults when clicked', async () => {
      const resetButton = element.querySelector('#quick-start-reset-button') as HTMLButtonElement;

      resetButton.click();
      await element.updateComplete;

      // Check that commands are reset
      const commandInputs = element.querySelectorAll('input[data-command-input]');
      expect(commandInputs).to.have.length(DEFAULT_QUICK_START_COMMANDS.length);

      // Verify default values
      expect((commandInputs[0] as HTMLInputElement).value).to.equal(
        DEFAULT_QUICK_START_COMMANDS[0].command
      );
      expect((commandInputs[1] as HTMLInputElement).value).to.equal(
        DEFAULT_QUICK_START_COMMANDS[1].command
      );
      expect((commandInputs[2] as HTMLInputElement).value).to.equal(
        DEFAULT_QUICK_START_COMMANDS[2].command
      );
    });

    it('should reset command names to defaults', async () => {
      const resetButton = element.querySelector('#quick-start-reset-button') as HTMLButtonElement;

      resetButton.click();
      await element.updateComplete;

      const nameInputs = element.querySelectorAll('input[placeholder="Display name (optional)"]');
      expect((nameInputs[0] as HTMLInputElement).value).to.equal(
        DEFAULT_QUICK_START_COMMANDS[0].name || ''
      );
      expect((nameInputs[1] as HTMLInputElement).value).to.equal(
        DEFAULT_QUICK_START_COMMANDS[1].name || ''
      );
      expect((nameInputs[2] as HTMLInputElement).value).to.equal(
        DEFAULT_QUICK_START_COMMANDS[2].name || ''
      );
    });

    it('should maintain edit mode after reset', async () => {
      const resetButton = element.querySelector('#quick-start-reset-button') as HTMLButtonElement;

      resetButton.click();
      await element.updateComplete;

      // Should still be in edit mode
      expect(element.editing).to.be.true;

      // Save and Cancel buttons should still be visible
      const saveButton = element.querySelector('#quick-start-save-button');
      const cancelButton = element.querySelector('#quick-start-cancel-button');
      expect(saveButton).to.exist;
      expect(cancelButton).to.exist;
    });

    it('should position Reset to Defaults button correctly', () => {
      const resetButton = element.querySelector('#quick-start-reset-button') as HTMLButtonElement;
      const addButton = element.querySelector(
        '#quick-start-add-command-button'
      ) as HTMLButtonElement;

      expect(resetButton).to.exist;
      expect(addButton).to.exist;

      // Check button styling
      expect(resetButton.classList.contains('text-primary')).to.be.true;
      expect(resetButton.classList.contains('hover:text-primary-hover')).to.be.true;
    });

    it('should emit quick-start-changed event when saving after reset', async () => {
      const changedListener = vi.fn();
      element.addEventListener('quick-start-changed', changedListener);

      // Reset to defaults
      const resetButton = element.querySelector('#quick-start-reset-button') as HTMLButtonElement;
      resetButton.click();
      await element.updateComplete;

      // Save
      const saveButton = element.querySelector('#quick-start-save-button') as HTMLButtonElement;
      saveButton.click();
      await element.updateComplete;

      expect(changedListener.mock.calls.length).to.equal(1);
      const event = changedListener.mock.calls[0][0] as CustomEvent<QuickStartCommand[]>;
      expect(event.detail).to.deep.equal(DEFAULT_QUICK_START_COMMANDS);
    });

    it('should cancel reset changes when cancel is clicked', async () => {
      // Reset to defaults
      const resetButton = element.querySelector('#quick-start-reset-button') as HTMLButtonElement;
      resetButton.click();
      await element.updateComplete;

      // Cancel
      const cancelButton = element.querySelector('#quick-start-cancel-button') as HTMLButtonElement;
      cancelButton.click();
      await element.updateComplete;

      // Re-enter edit mode to check
      const editButton = element.querySelector('#quick-start-edit-button') as HTMLButtonElement;
      editButton.click();
      await element.updateComplete;

      // Should have original modified commands, not defaults
      const commandInputs = element.querySelectorAll('input[data-command-input]');
      expect(commandInputs).to.have.length(2);
      expect((commandInputs[0] as HTMLInputElement).value).to.equal('python3');
      expect((commandInputs[1] as HTMLInputElement).value).to.equal('node');
    });
  });
});
