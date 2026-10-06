import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';
import './landing.css';

// The map used to live at this address. A share link made then carries its state
// after the #, so it is sent on to the map with that state intact.
if (/^#(v=|c=|l=|s=|e=)/.test(location.hash)) {
  location.replace(`${import.meta.env.BASE_URL}map/${location.hash}`);
} else {
  createRoot(document.getElementById('root')!).render(<Landing />);
}
