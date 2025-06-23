import { LitElement, html, css } from 'lit';
import { customElement, property, state, queryAssignedElements } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { buttonStyles } from './styles';

@customElement('vt-stepper')
export class VTStepper extends LitElement {
  static override styles = [
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .stepper-container {
        display: flex;
        flex-direction: column;
        gap: 32px;
      }

      .stepper-header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 0 20px;
      }

      .step-indicator {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--bg-hover);
        transition: all var(--transition-base);
        cursor: pointer;
      }

      .step-indicator.active {
        background: var(--accent);
        transform: scale(1.2);
      }

      .step-indicator.completed {
        background: var(--success);
      }

      .stepper-content {
        min-height: 300px;
        position: relative;
        overflow: hidden;
      }

      .step-content {
        display: none;
        animation: fadeIn var(--transition-slow);
      }

      .step-content.active {
        display: block;
      }

      .stepper-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 0;
      }

      .step-info {
        color: var(--text-secondary);
        font-size: 14px;
      }

      .nav-buttons {
        display: flex;
        gap: 12px;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateX(20px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `
  ];

  @property({ type: Number })
  currentStep = 0;

  @property({ type: Number })
  totalSteps = 0;

  @property({ type: Boolean })
  canGoNext = true;

  @property({ type: Boolean })
  canGoPrevious = true;

  @queryAssignedElements({ slot: 'step' })
  private _steps!: HTMLElement[];

  @state()
  private _completedSteps = new Set<number>();

  override firstUpdated() {
    this._updateStepVisibility();
    this.totalSteps = this._steps.length;
  }

  private _updateStepVisibility() {
    this._steps.forEach((step, index) => {
      step.style.display = index === this.currentStep ? 'block' : 'none';
      step.classList.toggle('active', index === this.currentStep);
    });
  }

  private _goToStep(stepIndex: number) {
    if (stepIndex < 0 || stepIndex >= this._steps.length) return;
    
    const oldStep = this.currentStep;
    this.currentStep = stepIndex;
    this._updateStepVisibility();
    
    this.dispatchEvent(new CustomEvent('step-change', {
      detail: { 
        previousStep: oldStep, 
        currentStep: this.currentStep,
        totalSteps: this.totalSteps
      },
      bubbles: true,
      composed: true
    }));
  }

  private _handlePrevious() {
    if (this.currentStep > 0 && this.canGoPrevious) {
      this._goToStep(this.currentStep - 1);
    }
  }

  private _handleNext() {
    if (this.currentStep < this._steps.length - 1 && this.canGoNext) {
      this._completedSteps.add(this.currentStep);
      this._goToStep(this.currentStep + 1);
    } else if (this.currentStep === this._steps.length - 1) {
      this._completedSteps.add(this.currentStep);
      this.dispatchEvent(new CustomEvent('complete', {
        bubbles: true,
        composed: true
      }));
    }
  }

  override render() {
    const isLastStep = this.currentStep === this._steps.length - 1;
    const isFirstStep = this.currentStep === 0;

    return html`
      <div class="stepper-container">
        <div class="stepper-header">
          ${Array.from({ length: this.totalSteps }, (_, index) => {
            const classes = {
              'step-indicator': true,
              'active': index === this.currentStep,
              'completed': this._completedSteps.has(index)
            };
            return html`
              <div 
                class=${classMap(classes)}
                @click=${() => this._goToStep(index)}
                role="button"
                tabindex="0"
                aria-label=${`Step ${index + 1}`}
                aria-current=${index === this.currentStep ? 'step' : 'false'}
              ></div>
            `;
          })}
        </div>

        <div class="stepper-content">
          <slot name="step" @slotchange=${this._handleSlotChange}></slot>
        </div>

        <div class="stepper-footer">
          <div class="step-info">
            Step ${this.currentStep + 1} of ${this.totalSteps}
          </div>
          <div class="nav-buttons">
            <vt-button
              variant="ghost"
              size="sm"
              ?disabled=${isFirstStep || !this.canGoPrevious}
              @click=${this._handlePrevious}
            >
              Previous
            </vt-button>
            <vt-button
              variant="primary"
              size="sm"
              ?disabled=${!this.canGoNext && !isLastStep}
              @click=${this._handleNext}
            >
              ${isLastStep ? 'Complete' : 'Next'}
            </vt-button>
          </div>
        </div>
      </div>
    `;
  }

  private _handleSlotChange() {
    this.totalSteps = this._steps.length;
    this._updateStepVisibility();
  }
}