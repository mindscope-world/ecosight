import { ArrowRight } from 'lucide-react';
import { motion, useInView } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const MAP_URL = `${import.meta.env.BASE_URL}map/`;
export const REPO_URL = 'https://github.com/mindscope-world/ecosight';

/** Uppercase label with wide tracking, used above headings and on data. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${className}`}>{children}</span>
  );
}

/** Marks figures that are examples and not readings of real data. */
export function DemoTag({ children = 'Demo data' }: { children?: ReactNode }) {
  return (
    <span className="rounded-sm border border-warn/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-warn">
      {children}
    </span>
  );
}

export function LiveTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-good">
      <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Content that rises into place the first time it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  tone = 'dark',
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'text';
  /** The surface the button sits on. */
  tone?: 'dark' | 'light';
  external?: boolean;
}) {
  const styles = {
    primary: 'h-11 rounded-md bg-accent px-5 font-semibold text-bg hover:bg-white',
    secondary:
      tone === 'dark'
        ? 'h-11 rounded-md border border-line px-5 font-medium text-ink hover:border-slate'
        : 'h-11 rounded-md border border-slate/40 px-5 font-medium text-bg hover:border-bg',
    text: tone === 'dark' ? 'font-semibold text-accent hover:text-white' : 'font-semibold text-link hover:text-bg',
  }[variant];
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`group inline-flex items-center gap-2 whitespace-nowrap text-sm transition-colors duration-200 ${styles}`}
    >
      {children}
      {variant !== 'secondary' && (
        <ArrowRight size={16} aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1" />
      )}
    </a>
  );
}

/** A whole number that counts up from zero when it first appears. */
export function CountUp({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const node = useRef<HTMLSpanElement>(null);
  const seen = useInView(node, { once: true });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const started = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - started) / 900);
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [seen, value]);
  return (
    <span ref={node} className="tabular-nums">
      {prefix}
      {shown.toLocaleString()}
      {suffix}
    </span>
  );
}

/** A section with the page's standard width and vertical rhythm. */
export function Section({
  id,
  tone,
  children,
  className = '',
}: {
  id?: string;
  tone: 'dark' | 'midnight' | 'light' | 'white';
  children: ReactNode;
  className?: string;
}) {
  const surface = {
    dark: 'bg-bg text-ink',
    midnight: 'bg-midnight text-ink',
    light: 'bg-paper text-bg',
    white: 'bg-snow text-bg',
  }[tone];
  return (
    <section id={id} className={`${surface} ${className}`}>
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">{children}</div>
    </section>
  );
}
