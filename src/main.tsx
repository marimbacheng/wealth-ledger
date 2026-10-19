import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 在畫面出現前就套用使用者選的外觀，避免先閃一下另一種顏色
try {
  const t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  const u = localStorage.getItem('updown-v2');
  document.documentElement.dataset.updown = u === 'tw' ? 'tw' : 'us';
} catch {
  /* 讀不到偏好就用預設 */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
