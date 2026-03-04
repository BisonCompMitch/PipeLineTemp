import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

const hostname = window.location.hostname.toLowerCase();
const useHashRouter =
  hostname.endsWith('github.io') || hostname === 'pipeline.scottsdaleutah.com';
const Router = useHashRouter ? HashRouter : BrowserRouter;

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
