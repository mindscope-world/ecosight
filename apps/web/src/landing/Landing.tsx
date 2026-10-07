import { MotionConfig } from 'motion/react';
import { useLandingData } from './data';
import { EcosystemLayers } from './sections/EcosystemLayers';
import { FinalCTA } from './sections/FinalCTA';
import { Footer } from './sections/Footer';
import { GlobalSection } from './sections/GlobalSection';
import { Hero } from './sections/Hero';
import { IntelligenceSection } from './sections/IntelligenceSection';
import { InteractiveMapPreview } from './sections/InteractiveMapPreview';
import { Navbar } from './sections/Navbar';
import { ProblemSection } from './sections/ProblemSection';
import { SignalsSection } from './sections/SignalsSection';
import { TrustBar } from './sections/TrustBar';
import { UseCases } from './sections/UseCases';

/**
 * The page tells one story in order: the ecosystem is scattered across lists,
 * ecoSight puts it on a map, every record becomes a point, the connections
 * between points show, and what was hidden can be found.
 */
export function Landing() {
  const data = useLandingData();
  return (
    // People who ask their system for less motion get the page without it.
    <MotionConfig reducedMotion="user">
      <Navbar />
      <main>
        <Hero data={data} />
        <TrustBar />
        <ProblemSection data={data} />
        <EcosystemLayers data={data} />
        <InteractiveMapPreview data={data} />
        <UseCases data={data} />
        <IntelligenceSection />
        <SignalsSection />
        <GlobalSection data={data} />
        <FinalCTA />
      </main>
      <Footer />
    </MotionConfig>
  );
}
