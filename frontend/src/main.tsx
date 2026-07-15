import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './app/scrollbar-autohide';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

