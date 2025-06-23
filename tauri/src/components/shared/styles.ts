import { css } from 'lit';

export const sharedStyles = css`
  /* CSS Variables for theming */
  :host {
    /* Dark theme (default) */
    --bg-primary: #1c1c1e;
    --bg-secondary: #2d2d30;
    --bg-tertiary: rgba(15, 15, 15, 0.95);
    --bg-hover: rgba(255, 255, 255, 0.05);
    --bg-active: rgba(16, 185, 129, 0.1);
    --bg-card: rgba(255, 255, 255, 0.03);
    --bg-input: rgba(255, 255, 255, 0.05);
    --bg-input-hover: rgba(255, 255, 255, 0.08);
    
    --text-primary: #f5f5f7;
    --text-secondary: #98989d;
    --text-tertiary: rgba(255, 255, 255, 0.4);
    
    --border-primary: rgba(255, 255, 255, 0.1);
    --border-secondary: rgba(255, 255, 255, 0.12);
    
    --accent: #0a84ff;
    --accent-hover: #409cff;
    --accent-glow: rgba(10, 132, 255, 0.3);
    
    --success: #32d74b;
    --warning: #ff9f0a;
    --danger: #ff453a;
    --danger-hover: #ff6961;
    
    --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
    --font-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
    
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
    --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.15);
    --shadow-lg: 0 10px 20px rgba(0, 0, 0, 0.2);
    --shadow-xl: 0 20px 40px rgba(0, 0, 0, 0.3);
    
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    
    --transition-fast: 0.15s ease;
    --transition-base: 0.2s ease;
    --transition-slow: 0.3s ease;
  }

  /* Light theme */
  :host-context(.light) {
    --bg-primary: #ffffff;
    --bg-secondary: #f5f5f7;
    --bg-tertiary: rgba(243, 244, 246, 0.95);
    --bg-hover: rgba(0, 0, 0, 0.05);
    --bg-active: rgba(16, 185, 129, 0.1);
    --bg-card: rgba(0, 0, 0, 0.02);
    --bg-input: rgba(0, 0, 0, 0.05);
    --bg-input-hover: rgba(0, 0, 0, 0.08);
    
    --text-primary: #1d1d1f;
    --text-secondary: #86868b;
    --text-tertiary: #9ca3af;
    
    --border-primary: rgba(0, 0, 0, 0.1);
    --border-secondary: rgba(0, 0, 0, 0.12);
    
    --accent: #007aff;
    --accent-hover: #0051d5;
    --accent-glow: rgba(0, 122, 255, 0.3);
    
    --success: #34c759;
    --warning: #ff9500;
    --danger: #ff3b30;
    --danger-hover: #ff6961;
  }
`;

export const buttonStyles = css`
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 20px;
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    text-decoration: none;
    cursor: pointer;
    transition: all var(--transition-base);
    user-select: none;
    -webkit-user-select: none;
    position: relative;
    overflow: hidden;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn:not(:disabled):active {
    transform: scale(0.98);
  }

  /* Primary button */
  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:not(:disabled):hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  /* Secondary button */
  .btn-secondary {
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--accent);
  }

  .btn-secondary:not(:disabled):hover {
    background: var(--accent);
    color: white;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  /* Ghost button */
  .btn-ghost {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .btn-ghost:not(:disabled):hover {
    background: var(--bg-input-hover);
  }

  /* Danger button */
  .btn-danger {
    background: var(--danger);
    color: white;
  }

  .btn-danger:not(:disabled):hover {
    background: var(--danger-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(255, 69, 58, 0.3);
  }

  /* Size variants */
  .btn-sm {
    padding: 6px 12px;
    font-size: 12px;
  }

  .btn-lg {
    padding: 14px 28px;
    font-size: 16px;
  }

  /* Icon button */
  .btn-icon {
    padding: 8px;
    width: 36px;
    height: 36px;
  }

  .btn-icon.btn-sm {
    width: 28px;
    height: 28px;
    padding: 6px;
  }

  .btn-icon.btn-lg {
    width: 44px;
    height: 44px;
    padding: 10px;
  }
`;

export const cardStyles = css`
  .card {
    background: var(--bg-card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    padding: 24px;
    transition: all var(--transition-slow);
  }

  .card:hover {
    border-color: var(--border-secondary);
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
  }

  .card-header {
    margin-bottom: 16px;
  }

  .card-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .card-subtitle {
    font-size: 14px;
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .card-body {
    color: var(--text-secondary);
  }

  .card-footer {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--border-primary);
  }
`;

export const formStyles = css`
  .form-group {
    margin-bottom: 20px;
  }

  .form-label {
    display: block;
    font-weight: 500;
    margin-bottom: 8px;
    font-size: 14px;
    color: var(--text-primary);
    letter-spacing: 0.1px;
  }

  .form-help {
    display: block;
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 4px;
    line-height: 1.5;
  }

  .form-input,
  .form-select,
  .form-textarea {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    font-size: 14px;
    font-family: var(--font-sans);
    background: var(--bg-input);
    color: var(--text-primary);
    transition: all var(--transition-base);
    -webkit-appearance: none;
    appearance: none;
    outline: none;
  }

  .form-input::placeholder,
  .form-textarea::placeholder {
    color: var(--text-tertiary);
  }

  .form-input:hover,
  .form-select:hover,
  .form-textarea:hover {
    background: var(--bg-input-hover);
    border-color: var(--border-secondary);
  }

  .form-input:focus,
  .form-select:focus,
  .form-textarea:focus {
    background: var(--bg-input-hover);
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }

  .form-select {
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2398989d' d='M10.293 3.293L6 7.586 1.707 3.293A1 1 0 00.293 4.707l5 5a1 1 0 001.414 0l5-5a1 1 0 10-1.414-1.414z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
  }

  .form-textarea {
    min-height: 100px;
    resize: vertical;
  }
`;

export const loadingStyles = css`
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: var(--text-secondary);
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-primary);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-right: 12px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error {
    text-align: center;
    padding: 40px;
    color: var(--danger);
  }

  .error-icon {
    width: 48px;
    height: 48px;
    margin-bottom: 16px;
    fill: currentColor;
  }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-tertiary);
  }

  .empty-state-icon {
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .empty-state-title {
    font-size: 18px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .empty-state-text {
    font-size: 14px;
    color: var(--text-tertiary);
  }
`;

export const animationStyles = css`
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fadeInDown {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @keyframes scaleIn {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .animate-fade-in {
    animation: fadeIn var(--transition-slow);
  }

  .animate-fade-in-up {
    animation: fadeInUp var(--transition-slow);
  }

  .animate-fade-in-down {
    animation: fadeInDown var(--transition-slow);
  }

  .animate-slide-in {
    animation: slideIn var(--transition-slow);
  }

  .animate-scale-in {
    animation: scaleIn var(--transition-base);
  }
`;

export const utilityStyles = css`
  /* Spacing */
  .mt-1 { margin-top: 4px; }
  .mt-2 { margin-top: 8px; }
  .mt-3 { margin-top: 16px; }
  .mt-4 { margin-top: 24px; }
  .mt-5 { margin-top: 32px; }
  
  .mb-1 { margin-bottom: 4px; }
  .mb-2 { margin-bottom: 8px; }
  .mb-3 { margin-bottom: 16px; }
  .mb-4 { margin-bottom: 24px; }
  .mb-5 { margin-bottom: 32px; }
  
  .gap-1 { gap: 4px; }
  .gap-2 { gap: 8px; }
  .gap-3 { gap: 16px; }
  .gap-4 { gap: 24px; }
  
  /* Layout */
  .flex { display: flex; }
  .inline-flex { display: inline-flex; }
  .flex-col { flex-direction: column; }
  .items-center { align-items: center; }
  .justify-center { justify-content: center; }
  .justify-between { justify-content: space-between; }
  .flex-wrap { flex-wrap: wrap; }
  .flex-1 { flex: 1; }
  
  /* Text */
  .text-center { text-align: center; }
  .text-sm { font-size: 12px; }
  .text-base { font-size: 14px; }
  .text-lg { font-size: 16px; }
  .text-xl { font-size: 18px; }
  .text-2xl { font-size: 24px; }
  .text-3xl { font-size: 32px; }
  
  .font-mono { font-family: var(--font-mono); }
  .font-medium { font-weight: 500; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  
  /* Colors */
  .text-primary { color: var(--text-primary); }
  .text-secondary { color: var(--text-secondary); }
  .text-tertiary { color: var(--text-tertiary); }
  .text-accent { color: var(--accent); }
  .text-success { color: var(--success); }
  .text-warning { color: var(--warning); }
  .text-danger { color: var(--danger); }
  
  /* Visibility */
  .hidden { display: none; }
  .invisible { visibility: hidden; }
  
  /* Interaction */
  .cursor-pointer { cursor: pointer; }
  .select-none { user-select: none; -webkit-user-select: none; }
`;

export default css`
  ${sharedStyles}
  ${buttonStyles}
  ${cardStyles}
  ${formStyles}
  ${loadingStyles}
  ${animationStyles}
  ${utilityStyles}
`;