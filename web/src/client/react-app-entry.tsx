import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './react/App';
import './styles/main.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
