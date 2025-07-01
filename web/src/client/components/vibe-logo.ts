import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';

@customElement('vibe-logo')
export class VibeLogo extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @state() private frame = 0;
  private animationInterval: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.startAnimation();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopAnimation();
  }

  private startAnimation() {
    this.animationInterval = window.setInterval(() => {
      this.frame = (this.frame + 1) % 12; // 12 frames for smooth animation
      this.requestUpdate();
    }, 200); // Change frame every 200ms
  }

  private stopAnimation() {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }
  }

  private getLogoFrame(): string {
    const frames = [
      '░░░▒▒▓▓█ VibeTunnel █▓▓▒▒░░░',
      '░░▒▒▓▓█░ VibeTunnel ░█▓▓▒▒░░',
      '░▒▒▓▓█░░ VibeTunnel ░░█▓▓▒▒░',
      '▒▒▓▓█░░░ VibeTunnel ░░░█▓▓▒▒',
      '▒▓▓█░░░░ VibeTunnel ░░░░█▓▓▒',
      '▓▓█░░░░░ VibeTunnel ░░░░░█▓▓',
      '▓█░░░░░░ VibeTunnel ░░░░░░█▓',
      '█░░░░░░░ VibeTunnel ░░░░░░░█',
      '░░░░░░░█ VibeTunnel █░░░░░░░',
      '░░░░░░█▓ VibeTunnel ▓█░░░░░░',
      '░░░░░█▓▓ VibeTunnel ▓▓█░░░░░',
      '░░░░█▓▓▒ VibeTunnel ▒▓▓█░░░░',
    ];

    return frames[this.frame];
  }

  private getRainbowColors() {
    return [
      '#ff0000',
      '#ff4500',
      '#ff8c00',
      '#ffd700',
      '#9acd32',
      '#00ff00',
      '#00ffff',
      '#0080ff',
      '#8000ff',
      '#ff00ff',
      '#ff1493',
      '#ff69b4',
      '#ffc0cb',
      '#ffb6c1',
      '#ffa0b4',
      '#ff8fa3',
    ];
  }

  render() {
    const frame = this.getLogoFrame();
    const colors = this.getRainbowColors();

    // Parse the frame to apply rainbow colors
    const parts = frame.split(' VibeTunnel ');
    const leftPart = parts[0];
    const rightPart = parts[1];

    const coloredLeft = leftPart
      .split('')
      .map((char, i) =>
        char === ' ' ? ' ' : html`<span style="color: ${colors[i % colors.length]};">${char}</span>`
      );

    const coloredRight = rightPart.split('').map((char, i) =>
      char === ' '
        ? ' '
        : html`<span style="color: ${colors[(leftPart.length - 1 - i) % colors.length]};"
              >${char}</span
            >`
    );

    return html`
      <div class="font-mono text-sm select-none leading-tight text-center">
        <pre
          class="whitespace-pre"
        >${coloredLeft} <span class="text-primary">VibeTunnel</span> ${coloredRight}</pre>
      </div>
    `;
  }
}
