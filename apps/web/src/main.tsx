import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializeTheme } from './components/chrome/lib/theme';
import './index.css';

const rootElement = document.getElementById('root');
if (rootElement == null) throw new Error('Root element not found');

initializeTheme();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
