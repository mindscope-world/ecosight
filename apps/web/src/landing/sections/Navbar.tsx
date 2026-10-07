import { ArrowRight, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MAP_URL } from '../ui';

const LINKS = [
  { label: 'Explore', href: '#explore' },
  { label: 'Ecosystems', href: `${MAP_URL}#v=1&p=ecosystems` },
  { label: 'Startups', href: `${MAP_URL}#v=1&p=startups` },
  { label: 'Investors', href: `${MAP_URL}#v=1&p=investors` },
  { label: 'Connections', href: `${import.meta.env.BASE_URL}graph/` },
  { label: 'Dashboard', href: `${import.meta.env.BASE_URL}dashboard/` },
  { label: 'Insights', href: '#signals' },
];

export function Wordmark() {
  return (
    <a href={import.meta.env.BASE_URL} className="flex items-center gap-2" aria-label="ecoSight home">
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-7 w-auto" />
      <span className="text-[17px] font-semibold tracking-tight text-ink">
        eco<span className="text-accent2">Sight</span>
      </span>
    </a>
  );
}

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > 12);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
        scrolled || open ? 'border-b border-line bg-bg/85 backdrop-blur-md' : 'border-b border-transparent'
      }`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          {LINKS.map((link) => (
            <a key={link.label} href={link.href} className="text-sm text-slate transition-colors hover:text-ink">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <a href={`${MAP_URL}?signin`} className="hidden text-sm text-slate transition-colors hover:text-ink sm:inline">
            Sign in
          </a>
          <a
            href={MAP_URL}
            className="group hidden h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-semibold text-bg transition-colors hover:bg-white sm:inline-flex"
          >
            Explore the Map
            <ArrowRight size={15} aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </a>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-md text-ink md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Main" className="border-t border-line px-5 pb-4 md:hidden">
          {LINKS.map((link) => (
            <a key={link.label} href={link.href} className="block py-2.5 text-ink" onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href={MAP_URL} className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-semibold text-bg">
            Explore the Map <ArrowRight size={15} aria-hidden="true" />
          </a>
        </nav>
      )}
    </header>
  );
}
