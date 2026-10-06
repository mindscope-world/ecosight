import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { formatMonth, formatUsd } from '../../lib/format';
import type { LandingData } from '../data';
import { hubPoints, KINDS } from '../demo';
import { MapCanvas } from '../MapCanvas';
import { ButtonLink, CountUp, DemoTag, Eyebrow, LiveTag, MAP_URL } from '../ui';

const COLORS = Object.fromEntries(KINDS.map((kind) => [kind.id, kind.color]));
const HUBS = hubPoints();

function Card({ children, className, delay }: { children: ReactNode; className: string; delay: number }) {
  return (
    <motion.div
      className={`absolute w-52 rounded-lg border border-line bg-midnight/85 p-3.5 shadow-2xl shadow-black/60 backdrop-blur-sm ${className}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The cards over the map show the product's real figures when they are loaded,
 * and marked examples when they are not. They are never a mix of the two.
 */
function HeroCards({ data }: { data: LandingData }) {
  const { stats, offices } = data;
  const mapped = new Set(offices?.features.map((feature) => feature.properties.org_id)).size;
  const topSector = stats?.top_sectors[0];
  const latest = stats?.recent_rounds.find((round) => round.announced_on);
  const city = offices?.features[0]?.properties.city;

  if (!stats || !mapped || !topSector) {
    return (
      <>
        <Card className="left-[56%] top-[16%] hidden lg:block" delay={0.9}>
          <div className="flex items-center justify-between"><Eyebrow className="text-slate">Nairobi</Eyebrow><DemoTag /></div>
          <div className="mt-2 text-2xl font-semibold">1,248</div>
          <div className="text-sm text-slate">ecosystem entities</div>
          <div className="mt-1.5 text-sm text-good">+18.4% activity</div>
        </Card>
        <Card className="right-[4%] top-[42%] hidden lg:block" delay={1.1}>
          <div className="flex items-center justify-between"><Eyebrow className="text-slate">Fintech</Eyebrow><DemoTag /></div>
          <div className="mt-2 text-sm"><span className="text-lg font-semibold">342</span> startups</div>
          <div className="text-sm"><span className="text-lg font-semibold">86</span> investors</div>
        </Card>
      </>
    );
  }
  return (
    <>
      <Card className="left-[56%] top-[16%] hidden lg:block" delay={0.9}>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-slate">{city}</Eyebrow>
          <LiveTag>Live</LiveTag>
        </div>
        <div className="mt-2 text-2xl font-semibold"><CountUp value={mapped} /></div>
        <div className="text-sm text-slate">organisations on the map</div>
        <div className="mt-1.5 text-sm text-ink">
          <CountUp value={stats.rounds} /> funding rounds · {formatUsd(stats.raised_usd)}
        </div>
      </Card>
      <Card className="right-[4%] top-[42%] hidden lg:block" delay={1.1}>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-slate">{topSector.sector}</Eyebrow>
          <LiveTag>Live</LiveTag>
        </div>
        <div className="mt-2 text-sm"><span className="text-lg font-semibold"><CountUp value={topSector.count} /></span> organisations</div>
        <div className="text-sm text-slate">the largest sector on the map</div>
      </Card>
      {latest && (
        <Card className="bottom-[13%] left-[60%] hidden lg:block" delay={1.3}>
          <Eyebrow className="text-slate">Recent activity</Eyebrow>
          <div className="mt-2 text-sm font-medium">
            <span className="capitalize">{latest.stage ?? 'Funding round'}</span> · {city}
          </div>
          <div className="text-sm text-slate">
            {latest.name}, {formatMonth(latest.announced_on!.slice(0, 7), true)}
          </div>
        </Card>
      )}
    </>
  );
}

export function Hero({ data }: { data: LandingData }) {
  return (
    <section className="relative isolate overflow-hidden bg-bg">
      {/* The map is the hero: it fills the section and the words sit on it. */}
      <motion.div
        className="absolute inset-0 -z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, delay: 0.2 }}
      >
        <MapCanvas
          className="h-full w-full"
          label="World map with clusters of ecosystem activity around major innovation hubs"
          options={{ center: [-42, 16], zoom: 1.5, labels: false, drift: true, colors: COLORS }}
          points={data.points}
          hubs={HUBS}
        />
        {/* Darkens the left, where the words are, and fades the map into the next section. */}
        <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-bg via-bg/60 via-35% to-transparent to-60%" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-bg to-transparent" />
        <HeroCards data={data} />
      </motion.div>

      <div className="mx-auto flex min-h-[92vh] max-w-6xl flex-col justify-center px-5 pb-24 pt-28 sm:px-8">
        <motion.div
          className="max-w-xl"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <Eyebrow className="text-accent">The global innovation map</Eyebrow>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
            See where
            <br />
            innovation happens.
          </h1>
          <p className="mt-5 text-xl text-ink/90">The living map of startups, capital, talent, and opportunity.</p>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-slate">
            Discover startups, investors, accelerators, events, and ecosystem activity wherever innovation is
            happening. Explore the relationships between companies, capital, programs, and places in one
            interactive map.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href={MAP_URL}>Explore the Map</ButtonLink>
            <ButtonLink href="#how" variant="secondary">See How It Works</ButtonLink>
          </div>
        </motion.div>
        <p className="mt-10 text-xs text-slate/80">
          {data.live
            ? 'Nairobi shows records from the live map. Points elsewhere are illustrative.'
            : 'Points on this map are illustrative.'}
        </p>
      </div>
    </section>
  );
}
