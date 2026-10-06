import type { ReactNode } from 'react';
import { ButtonLink, Eyebrow, MAP_URL, Reveal, Section } from '../ui';
import { Schematic } from './Schematic';

function UseCase({
  id,
  audience,
  heading,
  text,
  cta,
  href,
  visual,
  caption,
  flip = false,
}: {
  id: string;
  audience: string;
  heading: string;
  text: string;
  cta: string;
  href: string;
  visual: ReactNode;
  caption: string;
  flip?: boolean;
}) {
  return (
    <div id={id} className="grid items-center gap-8 py-10 lg:grid-cols-2 lg:gap-16 lg:py-14">
      <Reveal className={flip ? 'lg:order-2' : ''}>
        <Eyebrow className="text-link">{audience}</Eyebrow>
        <h3 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{heading}</h3>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-bg/70">{text}</p>
        <div className="mt-6">
          <ButtonLink href={href} variant="text" tone="light">{cta}</ButtonLink>
        </div>
      </Reveal>
      <Reveal delay={0.1}>
        {visual}
        <p className="mt-2 text-xs text-slate">{caption}</p>
      </Reveal>
    </div>
  );
}

export function FounderSection() {
  return (
    <UseCase
      id="founders"
      audience="For founders"
      heading="Find the people who can move your company forward."
      text="Discover investors active in your sector and stage. Find accelerators, grants, events, talent, and ecosystem partners near you."
      cta="Explore opportunities"
      href={`${MAP_URL}#v=1&p=discover`}
      visual={<Schematic seed={11} count={70} clusters={[[0.5, 0.5, 0.42], [0.3, 0.3, 0.2]]} highlight={['investor', 'program', 'event']} />}
      caption="Schematic: a city with its investor, program and event layers lit."
    />
  );
}

export function InvestorSection() {
  return (
    <UseCase
      id="investors"
      flip
      audience="For investors"
      heading="See deal flow before it becomes a spreadsheet."
      text="Discover emerging ecosystems, identify underserved markets, track portfolio footprints, and understand where startup activity is accelerating."
      cta="Explore market intelligence"
      href={`${MAP_URL}#v=1&p=ecosystems`}
      visual={
        <Schematic
          seed={23}
          count={140}
          clusters={[[0.22, 0.35, 0.22], [0.52, 0.6, 0.28], [0.8, 0.3, 0.2], [0.72, 0.75, 0.14]]}
          highlight={['startup', 'investor']}
          heat={[[0.52, 0.6, 0.16, '#22d3ee'], [0.22, 0.35, 0.1, '#3b82f6']]}
        />
      }
      caption="Schematic: city clusters, with capital activity shaded behind them."
    />
  );
}

export function EcosystemBuilderSection() {
  return (
    <UseCase
      id="builders"
      audience="For ecosystem builders"
      heading="See where support exists — and where it doesn’t."
      text="Map the organizations, programs, funding, and infrastructure supporting entrepreneurship. Identify gaps and opportunities for intervention."
      cta="Explore ecosystem gaps"
      href={`${MAP_URL}#v=1&l=startups,accelerators,density,accelerator-density`}
      visual={
        <Schematic
          seed={41}
          count={150}
          clusters={[[0.28, 0.45, 0.3], [0.72, 0.5, 0.3]]}
          highlight={['startup', 'program']}
          heat={[[0.28, 0.45, 0.2, '#22d3ee'], [0.72, 0.5, 0.2, '#f59e0b']]}
        />
      }
      caption="Schematic: two dense areas of startups. One has programs beside them; the amber one does not."
    />
  );
}

export function UseCases() {
  return (
    <Section tone="light">
      <div className="divide-y divide-slate/20">
        <FounderSection />
        <InvestorSection />
        <EcosystemBuilderSection />
      </div>
    </Section>
  );
}
