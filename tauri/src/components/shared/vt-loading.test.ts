import { html, fixture, expect } from '@open-wc/testing';
import { VTLoading } from './vt-loading';
import './vt-loading';

describe('VTLoading', () => {
  it('should render loading state by default', async () => {
    const el = await fixture<VTLoading>(html`
      <vt-loading></vt-loading>
    `);

    expect(el.state).to.equal('loading');
    const loading = el.shadowRoot!.querySelector('.loading');
    expect(loading).to.exist;
  });

  it('should render custom loading message', async () => {
    const el = await fixture<VTLoading>(html`
      <vt-loading message="Processing..."></vt-loading>
    `);

    expect(el.shadowRoot!.textContent).to.include('Processing...');
  });

  it('should render error state', async () => {
    const el = await fixture<VTLoading>(html`
      <vt-loading state="error" message="Something went wrong"></vt-loading>
    `);

    const error = el.shadowRoot!.querySelector('.error');
    expect(error).to.exist;
    expect(el.shadowRoot!.textContent).to.include('Something went wrong');
  });

  it('should render error details when provided', async () => {
    const el = await fixture<VTLoading>(html`
      <vt-loading 
        state="error" 
        message="Error occurred"
        errorDetails="Network timeout"
      ></vt-loading>
    `);

    expect(el.shadowRoot!.textContent).to.include('Network timeout');
  });

  it('should render empty state', async () => {
    const el = await fixture<VTLoading>(html`
      <vt-loading state="empty" message="No items found"></vt-loading>
    `);

    const empty = el.shadowRoot!.querySelector('.empty-state');
    expect(empty).to.exist;
    expect(el.shadowRoot!.textContent).to.include('No items found');
  });

  it('should render empty action button', async () => {
    let actionClicked = false;
    const el = await fixture<VTLoading>(html`
      <vt-loading 
        state="empty" 
        .emptyAction=${{ label: 'Add Item', handler: () => { actionClicked = true; } }}
      ></vt-loading>
    `);

    const button = el.shadowRoot!.querySelector('vt-button');
    expect(button).to.exist;
    expect(button!.textContent?.trim()).to.equal('Add Item');
  });

  it('should render slotted content for error action', async () => {
    const el = await fixture<VTLoading>(html`
      <vt-loading state="error">
        <button slot="error-action">Retry</button>
      </vt-loading>
    `);

    const slot = el.shadowRoot!.querySelector('slot[name="error-action"]');
    expect(slot).to.exist;
  });

  it('should use custom empty icon', async () => {
    const customIcon = '<svg><circle cx="12" cy="12" r="10"/></svg>';
    const el = await fixture<VTLoading>(html`
      <vt-loading state="empty" emptyIcon=${customIcon}></vt-loading>
    `);

    const iconDiv = el.shadowRoot!.querySelector('.empty-state-icon');
    expect(iconDiv!.innerHTML).to.include('circle');
  });
});