import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRefactored } from './react/AppRefactored';
import './styles/main.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <AppRefactored />
  </React.StrictMode>
);
