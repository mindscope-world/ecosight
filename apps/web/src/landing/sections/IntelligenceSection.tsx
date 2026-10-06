import { motion } from 'motion/react';
import { Reveal, Section } from '../ui';

const CHAIN = ['Startup', 'Investor', 'Portfolio', 'Accelerator', 'Event', 'City', 'Sector'];

/** The chain of relationships the map follows, drawn as linked nodes. */
export function IntelligenceSection() {
  return (
    <Section tone="white">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            A map that becomes smarter over time.
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-bg/70">
            ecoSight connects entities across geography, sector, funding, programs, and relationships to reveal
            patterns that are difficult to see in conventional databases.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <ol className="relative mx-auto flex max-w-sm flex-col gap-3" aria-label="How records connect">
            {CHAIN.map((node, index) => (
              <li key={node} className="relative flex items-center gap-4" style={{ marginLeft: `${(index % 3) * 2.2}rem` }}>
                <motion.span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-link/40 bg-white text-xs font-semibold text-link"
                  animate={{ boxShadow: ['0 0 0 0 rgba(29,78,216,0.25)', '0 0 0 10px rgba(29,78,216,0)'] }}
                  transition={{ duration: 2.4, repeat: Infinity, delay: index * 0.35 }}
                >
                  {String(index + 1).padStart(2, '0')}
                </motion.span>
                <span className="text-lg font-medium">{node}</span>
                {index < CHAIN.length - 1 && (
                  <span className="absolute left-5 top-10 h-3 w-px bg-link/30" aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </Section>
  );
}
