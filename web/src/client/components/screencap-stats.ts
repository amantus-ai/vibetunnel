import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

interface StreamStats {
  codec: string;
  codecImplementation: string;
  resolution: string;
  fps: number;
  bitrate: number;
  latency: number;
  packetsLost: number;
  packetLossRate: number;
  jitter: number;
  timestamp: number;
}

@customElement('screencap-stats')
export class ScreencapStats extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .stats-panel {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: rgba(15, 15, 15, 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid #2a2a2a;
      border-radius: 0.75rem;
      padding: 1rem;
      min-width: 250px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      font-size: 0.875rem;
    }

    h4 {
      margin: 0 0 0.75rem 0;
      font-size: 1rem;
      font-weight: 600;
      color: #e4e4e4;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.375rem 0;
      border-bottom: 1px solid rgba(42, 42, 42, 0.5);
    }

    .stat-row:last-child {
      border-bottom: none;
    }

    .stat-label {
      color: #a3a3a3;
      font-weight: 500;
    }

    .stat-value {
      color: #e4e4e4;
      font-variant-numeric: tabular-nums;
    }

    .stat-value.codec-h264,
    .stat-value.codec-h265 {
      color: #10B981;
    }

    .stat-value.codec-vp8,
    .stat-value.codec-vp9 {
      color: #3B82F6;
    }

    .stat-value.codec-av1 {
      color: #8B5CF6;
    }

    .stat-value.latency-good {
      color: #10B981;
    }

    .stat-value.latency-warning {
      color: #F59E0B;
    }

    .stat-value.latency-bad {
      color: #EF4444;
    }

    .loading-message {
      color: #a3a3a3;
      text-align: center;
      padding: 1rem;
    }

    .loading-message div:first-child {
      margin-bottom: 0.5rem;
    }

    .loading-message div:last-child {
      font-size: 0.75rem;
    }

    .quality-indicator {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }

    .quality-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    .quality-excellent .quality-dot {
      background: #10B981;
    }

    .quality-good .quality-dot {
      background: #3B82F6;
    }

    .quality-fair .quality-dot {
      background: #F59E0B;
    }

    .quality-poor .quality-dot {
      background: #EF4444;
    }
  `;

  @property({ type: Object }) stats: StreamStats | null = null;
  @property({ type: Number }) frameCounter = 0;

  private formatBitrate(bitrate: number): string {
    if (bitrate >= 1000000) {
      return `${(bitrate / 1000000).toFixed(1)} Mbps`;
    } else if (bitrate >= 1000) {
      return `${(bitrate / 1000).toFixed(0)} Kbps`;
    }
    return `${bitrate} bps`;
  }

  private getCodecClass(): string {
    if (!this.stats) return '';
    const codec = this.stats.codec.toLowerCase();
    if (codec.includes('h264')) return 'codec-h264';
    if (codec.includes('h265') || codec.includes('hevc')) return 'codec-h265';
    if (codec.includes('vp8')) return 'codec-vp8';
    if (codec.includes('vp9')) return 'codec-vp9';
    if (codec.includes('av1')) return 'codec-av1';
    return '';
  }

  private getLatencyClass(): string {
    if (!this.stats) return '';
    if (this.stats.latency < 50) return 'latency-good';
    if (this.stats.latency < 150) return 'latency-warning';
    return 'latency-bad';
  }

  private getQualityIndicator() {
    if (!this.stats) return html``;

    // Determine quality based on multiple factors
    const { latency, packetLossRate, bitrate } = this.stats;

    let score = 100;

    // Latency impact
    if (latency > 200) score -= 30;
    else if (latency > 100) score -= 15;
    else if (latency > 50) score -= 5;

    // Packet loss impact
    if (packetLossRate > 5) score -= 40;
    else if (packetLossRate > 2) score -= 20;
    else if (packetLossRate > 0.5) score -= 10;

    // Bitrate impact
    if (bitrate < 500000) score -= 20;
    else if (bitrate < 1000000) score -= 10;

    return html`
      <span class="quality-indicator ${this.getQualityClass(score)}">
        <span class="quality-dot"></span>
        ${this.getQualityLabel(score)}
      </span>
    `;
  }

  private getQualityClass(score: number): string {
    if (score >= 90) return 'quality-excellent';
    if (score >= 70) return 'quality-good';
    if (score >= 50) return 'quality-fair';
    return 'quality-poor';
  }

  private getQualityLabel(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Poor';
  }

  render() {
    return html`
      <div class="stats-panel">
        <h4>📊 Stream Statistics</h4>
        ${
          this.stats
            ? html`
          <div class="stat-row">
            <span class="stat-label">Codec:</span>
            <span class="stat-value ${this.getCodecClass()}">${this.stats.codec}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Hardware:</span>
            <span class="stat-value">${this.stats.codecImplementation}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Resolution:</span>
            <span class="stat-value">${this.stats.resolution} @ ${this.stats.fps} FPS</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Bitrate:</span>
            <span class="stat-value">${this.formatBitrate(this.stats.bitrate)}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Latency:</span>
            <span class="stat-value ${this.getLatencyClass()}">${this.stats.latency}ms</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Packet Loss:</span>
            <span class="stat-value">${this.stats.packetLossRate.toFixed(2)}%</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Quality:</span>
            <span class="stat-value">${this.getQualityIndicator()}</span>
          </div>
        `
            : html`
          <div class="loading-message">
            <div>Collecting statistics...</div>
            <div>
              ${this.frameCounter > 0 ? `Frames: ${this.frameCounter}` : ''}
            </div>
          </div>
        `
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'screencap-stats': ScreencapStats;
  }
}
