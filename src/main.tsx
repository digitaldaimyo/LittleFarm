import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, boot } from './ui/App';
import { store } from './ui/store';
import { loadLocal } from './persistence/storage';
import './styles.css';

async function main() {
  const { game, diagnostics } = await loadLocal();
  if (game) store.load(game, diagnostics);
  boot();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void main();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
