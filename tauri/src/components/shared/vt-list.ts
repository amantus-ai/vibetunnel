import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { classMap } from 'lit/directives/class-map.js';
import { RovingTabindex, announceToScreenReader } from '../../utils/accessibility';

export interface ListItem {
  id: string;
  label: string;
  value?: unknown;
  disabled?: boolean;
  icon?: string;
}

/**
 * Accessible list component with keyboard navigation and screen reader support
 */
@customElement('vt-list')
export class VTList extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .list-container {
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .list-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-primary);
      background: var(--bg-secondary);
    }

    .list-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }

    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      max-height: 400px;
    }

    .list-item {
      padding: 12px 16px;
      cursor: pointer;
      transition: background var(--transition-fast);
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--border-primary);
    }

    .list-item:last-child {
      border-bottom: none;
    }

    .list-item:hover:not(.disabled) {
      background: var(--bg-hover);
    }

    .list-item:focus {
      outline: none;
      background: var(--bg-active);
      box-shadow: inset 0 0 0 2px var(--accent);
    }

    .list-item.selected {
      background: var(--bg-active);
      color: var(--accent);
    }

    .list-item.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .list-item-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .list-item-label {
      flex: 1;
      font-size: 14px;
    }

    .list-item-check {
      width: 16px;
      height: 16px;
      color: var(--accent);
      opacity: 0;
      transition: opacity var(--transition-fast);
    }

    .list-item.selected .list-item-check {
      opacity: 1;
    }

    .list-empty {
      padding: 40px 16px;
      text-align: center;
      color: var(--text-tertiary);
      font-size: 14px;
    }

    .list-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border-primary);
      background: var(--bg-secondary);
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* Loading state */
    .list.loading {
      opacity: 0.6;
      pointer-events: none;
    }

    /* Compact variant */
    :host([variant="compact"]) .list-item {
      padding: 8px 12px;
    }

    /* Bordered variant */
    :host([variant="bordered"]) .list-item {
      margin: 4px 8px;
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-sm);
    }
  `;

  @property({ type: Array })
  items: ListItem[] = [];

  @property({ type: String })
  selectedId: string | null = null;

  @property({ type: Boolean })
  multiSelect = false;

  @property({ type: Array })
  selectedIds: string[] = [];

  @property({ type: String })
  title = '';

  @property({ type: String })
  emptyMessage = 'No items';

  @property({ type: Boolean })
  loading = false;

  @property({ type: String, reflect: true })
  variant: 'default' | 'compact' | 'bordered' = 'default';

  @query('.list')
  private _listElement!: HTMLUListElement;

  private _rovingTabindex?: RovingTabindex;

  override firstUpdated() {
    if (this._listElement) {
      this._rovingTabindex = new RovingTabindex(
        this._listElement,
        '.list-item:not(.disabled)'
      );
    }

    // Set ARIA attributes
    this.setAttribute('role', 'region');
    if (this.title) {
      this.setAttribute('aria-label', this.title);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._rovingTabindex?.destroy();
  }

  private _handleItemClick(item: ListItem) {
    if (item.disabled) return;

    if (this.multiSelect) {
      const index = this.selectedIds.indexOf(item.id);
      if (index > -1) {
        this.selectedIds = this.selectedIds.filter(id => id !== item.id);
      } else {
        this.selectedIds = [...this.selectedIds, item.id];
      }
      
      this.dispatchEvent(new CustomEvent('selection-change', {
        detail: { selectedIds: this.selectedIds },
        bubbles: true,
        composed: true
      }));
    } else {
      this.selectedId = item.id;
      
      this.dispatchEvent(new CustomEvent('item-select', {
        detail: { item, value: item.value },
        bubbles: true,
        composed: true
      }));
    }

    // Announce selection to screen readers
    const action = this.multiSelect 
      ? (this.selectedIds.includes(item.id) ? 'selected' : 'deselected')
      : 'selected';
    announceToScreenReader(`${item.label} ${action}`);
  }

  private _renderItem(item: ListItem) {
    const isSelected = this.multiSelect 
      ? this.selectedIds.includes(item.id)
      : this.selectedId === item.id;

    const classes = {
      'list-item': true,
      'selected': isSelected,
      'disabled': !!item.disabled
    };

    return html`
      <li
        class=${classMap(classes)}
        role="option"
        aria-selected=${isSelected}
        aria-disabled=${item.disabled || false}
        @click=${() => this._handleItemClick(item)}
        tabindex="-1"
      >
        ${item.icon ? html`
          <div class="list-item-icon" aria-hidden="true">
            ${item.icon}
          </div>
        ` : ''}
        
        <span class="list-item-label">${item.label}</span>
        
        <svg class="list-item-check" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M13.78 4.22a.75.75 0 010 1.06l-7 7a.75.75 0 01-1.06 0l-3-3a.75.75 0 111.06-1.06L6.5 10.94l6.47-6.47a.75.75 0 011.06 0z"/>
        </svg>
      </li>
    `;
  }

  override render() {
    const listClasses = {
      'list': true,
      'loading': this.loading
    };

    const selectedCount = this.multiSelect 
      ? this.selectedIds.length 
      : (this.selectedId ? 1 : 0);

    return html`
      <div class="list-container">
        ${this.title ? html`
          <div class="list-header">
            <h3 class="list-title">${this.title}</h3>
          </div>
        ` : ''}
        
        ${this.items.length > 0 ? html`
          <ul 
            class=${classMap(listClasses)}
            role="listbox"
            aria-multiselectable=${this.multiSelect}
            aria-label=${this.title || 'Select an item'}
          >
            ${repeat(
              this.items,
              item => item.id,
              item => this._renderItem(item)
            )}
          </ul>
        ` : html`
          <div class="list-empty" role="status">
            ${this.emptyMessage}
          </div>
        `}
        
        ${selectedCount > 0 ? html`
          <div class="list-footer" role="status" aria-live="polite">
            ${selectedCount} item${selectedCount === 1 ? '' : 's'} selected
          </div>
        ` : ''}
        
        <slot name="footer"></slot>
      </div>
    `;
  }
}