import { html, css, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('glowing-app-icon')
export class GlowingAppIcon extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
      position: relative;
    }

    .icon-container {
      position: relative;
      cursor: pointer;
      transition: transform 0.2s ease;
    }

    .icon-container:hover {
      transform: scale(1.05);
    }

    .icon-container:active {
      transform: scale(0.98);
    }

    .app-icon {
      width: var(--size, 128px);
      height: var(--size, 128px);
      border-radius: 27.2%;
      position: relative;
      z-index: 2;
      transition: all 0.3s ease;
    }

    .glow {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: var(--size, 128px);
      height: var(--size, 128px);
      border-radius: 27.2%;
      opacity: var(--glow-opacity, 0.3);
      filter: blur(var(--glow-blur, 20px));
      z-index: 1;
      pointer-events: none;
      animation: breathing 3s ease-in-out infinite;
    }

    .floating {
      animation: float 3s ease-in-out infinite;
    }

    @keyframes breathing {
      0%, 100% { 
        transform: translate(-50%, -50%) scale(1.15);
        opacity: 0.2;
      }
      50% { 
        transform: translate(-50%, -50%) scale(1.25);
        opacity: 0.4;
      }
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }

    /* Light theme adjustments */
    :host-context(.light) .glow {
      opacity: 0.2;
      filter: blur(15px);
    }

    :host-context(.light) .app-icon {
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
    }

    /* Dark theme adjustments */
    :host-context(.dark) .app-icon {
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    }
  `;

  @property({ type: Number })
  size = 128;

  @property({ type: Boolean })
  enableFloating = true;

  @property({ type: Boolean })
  enableInteraction = true;

  @property({ type: Number })
  glowIntensity = 0.3;

  @state()
  private iconSrc = '';

  override connectedCallback() {
    super.connectedCallback();
    // Use the app icon from the public directory
    this.iconSrc = '/icon_512x512.png';
    this.style.setProperty('--size', `${this.size}px`);
    this.style.setProperty('--glow-opacity', `${this.glowIntensity}`);
    this.style.setProperty('--glow-blur', `${this.size * 0.15}px`);
  }

  private handleClick(): void {
    if (this.enableInteraction) {
      this.dispatchEvent(new CustomEvent('icon-click', {
        bubbles: true,
        composed: true
      }));
    }
  }

  override render() {
    return html`
      <div 
        class="icon-container ${this.enableFloating ? 'floating' : ''}"
        @click=${this.handleClick}
      >
        <img 
          src=${this.iconSrc} 
          alt="VibeTunnel"
          class="app-icon"
        />
        <img 
          src=${this.iconSrc} 
          alt=""
          class="glow"
          aria-hidden="true"
        />
      </div>
    `;
  }
}