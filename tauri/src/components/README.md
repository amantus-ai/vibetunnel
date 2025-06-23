# VibeTunnel Lit Components

This directory contains all the Lit Web Components used in the VibeTunnel Tauri application.

## Architecture

### Base Components (`base/`)
- `tauri-base.js` - Base class with common Tauri functionality that all components extend

### Shared Components (`shared/`)
- `vt-button.js` - Reusable button component with variants
- `vt-card.js` - Card container component
- `vt-loading.js` - Loading, error, and empty states
- `vt-stepper.js` - Step-by-step navigation component
- `styles.js` - Shared CSS styles and utilities

### App Components
- `app-main.js` - Main application dashboard
- `settings-app.js` - Settings window with tabs
- `welcome-app.js` - Welcome/onboarding flow
- `session-detail-app.js` - Terminal session details viewer
- `server-console-app.js` - Server logs console

## Benefits of Using Lit

1. **Small bundle size** - Lit is only ~5KB gzipped
2. **Web standards** - Built on Web Components
3. **Reactive properties** - Automatic re-rendering on property changes
4. **Declarative templates** - Easy to read and maintain
5. **Code reuse** - Components are easily shared across pages

## Development

To build the components:

```bash
npm run build
```

To develop with hot reload:

```bash
npm run dev
```

## Component Usage

All components are ES modules and can be imported directly:

```javascript
import './components/app-main.js';
```

Or use the barrel export:

```javascript
import { AppMain, VTButton, sharedStyles } from './components/index.js';
```

## Styling

Components use Shadow DOM for style encapsulation. Shared styles are available in `shared/styles.js` and include:

- CSS custom properties for theming
- Utility classes
- Common component styles (buttons, cards, forms)
- Loading and animation helpers

Theme variables automatically adapt to light/dark mode preferences.