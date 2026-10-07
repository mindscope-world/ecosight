import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { keepFresh } from './lib/freshness';

keepFresh();
createRoot(document.getElementById('root')!).render(<App />);
