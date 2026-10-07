import { createRoot } from 'react-dom/client';
import { DataPage } from './DataPage';
import '../styles.css';
import { keepFresh } from '../lib/freshness';

keepFresh();
createRoot(document.getElementById('root')!).render(<DataPage />);
