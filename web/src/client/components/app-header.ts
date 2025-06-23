/**
 * App Header Component
 *
 * Conditionally renders either a compact sidebar header or full-width header
 * based on the showSplitView property.
 *
 * @fires create-session - When create button is clicked
 * @fires hide-exited-change - When hide/show exited toggle is clicked (detail: boolean)
 * @fires kill-all-sessions - When kill all button is clicked
 * @fires clean-exited-sessions - When clean exited button is clicked
 * @fires open-file-browser - When browse button is clicked
 */
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Session } from './session-list.js';
import './terminal-icon.js';
import './notification-status.js';
import './sidebar-header.js';
import './full-header.js';

@customElement('app-header')
export class AppHeader extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) sessions: Session[] = [];
  @property({ type: Boolean }) hideExited = true;
  @property({ type: Boolean }) showSplitView = false;

  private forwardEvent = (e: Event) => {
    // Forward events from child components to parent
    this.dispatchEvent(
      new CustomEvent(e.type, {
        detail: (e as CustomEvent).detail,
        bubbles: true,
      })
    );
  };

  render() {
    return this.showSplitView ? this.renderSidebarHeader() : this.renderFullHeader();
  }

  private renderSidebarHeader() {
    return html`
      <sidebar-header
        .sessions=${this.sessions}
        .hideExited=${this.hideExited}
        @create-session=${this.forwardEvent}
        @hide-exited-change=${this.forwardEvent}
        @kill-all-sessions=${this.forwardEvent}
        @clean-exited-sessions=${this.forwardEvent}
      ></sidebar-header>
    `;
  }

  private renderFullHeader() {
    return html`
      <full-header
        .sessions=${this.sessions}
        .hideExited=${this.hideExited}
        @create-session=${this.forwardEvent}
        @hide-exited-change=${this.forwardEvent}
        @kill-all-sessions=${this.forwardEvent}
        @clean-exited-sessions=${this.forwardEvent}
      ></full-header>
    `;
  }
}
