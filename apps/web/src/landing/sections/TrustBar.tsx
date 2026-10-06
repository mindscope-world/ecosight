import { Eyebrow, Reveal } from '../ui';

const AUDIENCES = ['Founders', 'VCs', 'Accelerators', 'NGOs', 'Development funders', 'Ecosystem builders'];

export function TrustBar() {
  return (
    <section className="border-y border-line bg-midnight">
      <Reveal className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-10 sm:px-8">
        <p className="text-sm text-slate">Built for the people shaping the ecosystem.</p>
        <ul className="flex flex-wrap justify-center gap-x-9 gap-y-3">
          {AUDIENCES.map((audience) => (
            <li key={audience}>
              <Eyebrow className="text-ink/80">{audience}</Eyebrow>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
