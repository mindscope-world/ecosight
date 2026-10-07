import { createRoot } from 'react-dom/client';
import { GraphPage } from './GraphPage';
import '../styles.css';
import { keepFresh } from '../lib/freshness';

keepFresh();
createRoot(document.getElementById('root')!).render(<GraphPage />);
