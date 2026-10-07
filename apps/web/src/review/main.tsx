import { createRoot } from 'react-dom/client';
import { ReviewPage } from './ReviewPage';
import '../styles.css';
import { keepFresh } from '../lib/freshness';

keepFresh();
createRoot(document.getElementById('root')!).render(<ReviewPage />);
