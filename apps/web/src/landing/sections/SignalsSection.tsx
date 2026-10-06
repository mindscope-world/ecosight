import { DemoTag, Eyebrow, Reveal, Section } from '../ui';

// Example figures, shown to illustrate the kind of signal the product reports.
// They are not measurements. The section says so, and so does every card.
const CARDS: { city: string; rows: [label: string, value: string][] }[] = [
  { city: 'Nairobi', rows: [['Startup activity', '↑ 18%'], ['VC activity', '↑ 24%'], ['New startups', '+47']] },
  { city: 'Lagos', rows: [['FinTech activity', 'HIGH'], ['New funding rounds', '+12']] },
  { city: 'Kigali', rows: [['Accelerator activity', '↑ 31%']] },
];

export function SignalsSection() {
  return (
    <Section id="signals" tone="midnight">
      <Reveal className="flex flex-wrap items-center gap-3">
        <Eyebrow className="text-accent">Ecosystem signals</Eyebrow>
        <DemoTag />
      </Reveal>
      <Reveal>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Know when a place starts to move.
        </h2>
        <p className="mt-4 max-w-xl text-lg text-slate">
          Signals are computed from counted activity: records added, rounds announced, investors active. The
          cards below are examples of the format, not readings.
        </p>
      </Reveal>
      <ul className="-mx-5 mt-10 flex snap-x gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
        {CARDS.map((card, index) => (
          <li key={card.city} className="w-72 shrink-0 snap-start md:w-auto">
            <Reveal delay={index * 0.08} className="h-full">
              <div className="h-full rounded-xl border border-line bg-bg p-5 transition-transform duration-200 hover:-translate-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xl font-semibold">{card.city}</span>
                  <DemoTag />
                </div>
                <dl className="mt-5 space-y-3">
                  {card.rows.map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-sm text-slate">{label}</dt>
                      <dd className="font-mono text-lg tabular-nums text-accent">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
