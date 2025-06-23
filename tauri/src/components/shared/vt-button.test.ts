import { html, fixture, expect, elementUpdated } from '@open-wc/testing';
import { VTButton } from './vt-button';
import './vt-button';

describe('VTButton', () => {
  it('should render with default properties', async () => {
    const el = await fixture<VTButton>(html`
      <vt-button>Click me</vt-button>
    `);

    expect(el).to.exist;
    expect(el.variant).to.equal('primary');
    expect(el.size).to.equal('md');
    expect(el.disabled).to.be.false;
    expect(el.loading).to.be.false;
  });

  it('should render different variants', async () => {
    const el = await fixture<VTButton>(html`
      <vt-button variant="secondary">Secondary</vt-button>
    `);

    const button = el.shadowRoot!.querySelector('button');
    expect(button).to.have.class('btn-secondary');
  });

  it('should disable button when disabled prop is set', async () => {
    const el = await fixture<VTButton>(html`
      <vt-button disabled>Disabled</vt-button>
    `);

    const button = el.shadowRoot!.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).to.be.true;
  });

  it('should show loading spinner when loading', async () => {
    const el = await fixture<VTButton>(html`
      <vt-button loading>Loading</vt-button>
    `);

    const spinner = el.shadowRoot!.querySelector('.loading-spinner');
    expect(spinner).to.exist;
  });

  it('should handle click events', async () => {
    let clicked = false;
    const el = await fixture<VTButton>(html`
      <vt-button @click=${() => clicked = true}>Click me</vt-button>
    `);

    const button = el.shadowRoot!.querySelector('button') as HTMLButtonElement;
    button.click();
    
    expect(clicked).to.be.true;
  });

  it('should not trigger click when disabled', async () => {
    let clicked = false;
    const el = await fixture<VTButton>(html`
      <vt-button disabled @click=${() => clicked = true}>Disabled</vt-button>
    `);

    const button = el.shadowRoot!.querySelector('button') as HTMLButtonElement;
    button.click();
    
    expect(clicked).to.be.false;
  });

  it('should render as anchor when href is provided', async () => {
    const el = await fixture<VTButton>(html`
      <vt-button href="https://example.com">Link</vt-button>
    `);

    const anchor = el.shadowRoot!.querySelector('a');
    expect(anchor).to.exist;
    expect(anchor!.getAttribute('href')).to.equal('https://example.com');
  });

  it('should apply size classes correctly', async () => {
    const el = await fixture<VTButton>(html`
      <vt-button size="lg">Large Button</vt-button>
    `);

    const button = el.shadowRoot!.querySelector('button');
    expect(button).to.have.class('btn-lg');
  });

  it('should apply icon class when icon prop is true', async () => {
    const el = await fixture<VTButton>(html`
      <vt-button icon>
        <svg></svg>
      </vt-button>
    `);

    const button = el.shadowRoot!.querySelector('button');
    expect(button).to.have.class('btn-icon');
  });

  it('should have proper ARIA attributes', async () => {
    const el = await fixture<VTButton>(html`
      <vt-button loading>Loading</vt-button>
    `);

    const button = el.shadowRoot!.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-busy')).to.equal('true');
  });
});