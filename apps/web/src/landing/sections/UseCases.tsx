import type { ReactNode } from 'react';
import type { LandingData } from '../data';
import { hubPoints } from '../demo';
import { ButtonLink, Eyebrow, MAP_URL, Reveal, Section } from '../ui';
import { cityView, pointsNote, SectionMap } from './SectionMap';

const HUBS = hubPoints();
const AFRICA = { center: [20, 2] as [number, number], zoom: 2.3 };
const EAST_AFRICA = { center: [35.5, -1.5] as [number, number], zoom: 4.3 };

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

export function FounderSection({ data }: { data: LandingData }) {
  return (
    <UseCase
      id="founders"
      audience="For founders"
      heading="Find the people who can move your company forward."
      text="Discover investors active in your sector and stage. Find accelerators, grants, events, talent, and ecosystem partners near you."
      cta="Explore opportunities"
      href={`${MAP_URL}#v=1&p=discover`}
      visual={
        <SectionMap
          label={`Map of investors, programs and events in ${data.city?.name ?? 'one city'}`}
          view={cityView(data)}
          points={data.points}
          kinds={['investor', 'program', 'event']}
          labels
        />
      }
      caption={`${data.city?.name ?? 'One city'}: its investors, programs and events. ${pointsNote(data)}`}
    />
  );
}

export function InvestorSection({ data }: { data: LandingData }) {
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
        <SectionMap label="Map of startups and investors across Africa" view={AFRICA} points={data.points} hubs={HUBS} kinds={['startup', 'investor']} />
      }
      caption={`Startups and investors by city, with the largest hubs ringed. ${pointsNote(data)}`}
    />
  );
}

export function EcosystemBuilderSection({ data }: { data: LandingData }) {
  return (
    <UseCase
      id="builders"
      audience="For ecosystem builders"
      heading="See where support exists — and where it doesn’t."
      text="Map the organizations, programs, funding, and infrastructure supporting entrepreneurship. Identify gaps and opportunities for intervention."
      cta="Explore ecosystem gaps"
      href={`${MAP_URL}#v=1&l=startups,accelerators,density,accelerator-density`}
      visual={
        <SectionMap label="Map of startups and support programs in East Africa" view={EAST_AFRICA} points={data.points} kinds={['startup', 'program']} />
      }
      caption={`East Africa: startups, and the programs that support them. A city with one and not the other is a gap. ${pointsNote(data)}`}
    />
  );
}

export function UseCases({ data }: { data: LandingData }) {
  return (
    <Section tone="light">
      <div className="divide-y divide-slate/20">
        <FounderSection data={data} />
        <InvestorSection data={data} />
        <EcosystemBuilderSection data={data} />
      </div>
    </Section>
  );
}
