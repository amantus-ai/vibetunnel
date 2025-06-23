import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { cardStyles, animationStyles } from './styles';

@customElement('vt-card')
export class VTCard extends LitElement {
  static override styles = [
    cardStyles,
    animationStyles,
    css`
      :host {
        display: block;
      }

      .card {
        position: relative;
        overflow: hidden;
      }

      .card.hoverable {
        cursor: pointer;
        transition: all var(--transition-slow);
      }

      .card.hoverable:hover {
        transform: translateY(-4px);
        box-shadow: var(--shadow-xl);
      }

      .card.animate {
        opacity: 0;
        animation: fadeInUp var(--transition-slow) forwards;
      }

      .card.animate[data-delay="100"] {
        animation-delay: 100ms;
      }

      .card.animate[data-delay="200"] {
        animation-delay: 200ms;
      }

      .card.animate[data-delay="300"] {
        animation-delay: 300ms;
      }

      .card.animate[data-delay="400"] {
        animation-delay: 400ms;
      }

      .card.animate[data-delay="500"] {
        animation-delay: 500ms;
      }
    `
  ];

  @property({ type: Boolean })
  hoverable = false;

  @property({ type: Boolean })
  animateIn = false;

  @property({ type: Number })
  delay = 0;

  override render() {
    const classes = {
      'card': true,
      'hoverable': this.hoverable,
      'animate': this.animateIn
    };

    return html`
      <div 
        class=${classMap(classes)}
        data-delay=${this.delay}
        role=${this.hoverable ? 'button' : 'article'}
        tabindex=${this.hoverable ? '0' : '-1'}
      >
        <slot></slot>
      </div>
    `;
  }
}