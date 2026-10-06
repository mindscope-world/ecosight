import { ButtonLink, MAP_URL, REPO_URL, Reveal } from '../ui';

export function FinalCTA() {
  return (
    <section className="border-t border-line bg-midnight text-ink">
      <Reveal className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8 lg:py-32">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          The ecosystem is moving.
          <br />
          See where it&rsquo;s going.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate">
          Explore the map and discover the companies, capital, people, and opportunities shaping the next
          generation of innovation.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href={MAP_URL}>Explore ecoSight</ButtonLink>
          {/* There are no accounts yet, so joining means contributing to the open project. */}
          <ButtonLink href={REPO_URL} variant="secondary" external>Join the ecosystem</ButtonLink>
        </div>
      </Reveal>
    </section>
  );
}
