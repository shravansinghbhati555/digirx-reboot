import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './app/scrollbar-autohide';
import { App } from './App';
import { registerServiceWorker } from './offline/bootstrap';

// Offline shell caching (B3). Production only — see bootstrap.ts.
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

