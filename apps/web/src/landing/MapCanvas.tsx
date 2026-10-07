import type { FeatureCollection, LineString, Point } from 'geojson';
import { useEffect, useRef } from 'react';
import type { PreviewMap, PreviewOptions } from '../map/previewMap';

/**
 * A preview map in a box. The map library is large, so it is fetched only when
 * the box is about to scroll into view, and its motion stops while off screen.
 */
export function MapCanvas({
  options,
  points,
  hubs,
  lines,
  kinds,
  view,
  className = '',
  label,
}: {
  options: PreviewOptions;
  points: FeatureCollection<Point>;
  hubs?: FeatureCollection<Point>;
  lines?: FeatureCollection<LineString>;
  kinds?: string[] | null;
  /** When this changes the map travels there. */
  view?: { center: [number, number]; zoom: number };
  className?: string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<PreviewMap | null>(null);
  const latest = useRef({ points, hubs, lines, kinds, view });
  latest.current = { points, hubs, lines, kinds, view };
  const first = useRef(options);

  useEffect(() => {
    const element = box.current!;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting && !map.current && !cancelled) {
          void import('../map/previewMap').then(({ PreviewMap }) => {
            if (cancelled || map.current) return;
            const created = new PreviewMap(element, first.current);
            created.setPoints(latest.current.points);
            if (latest.current.hubs) created.setHubs(latest.current.hubs);
            if (latest.current.lines) created.setLines(latest.current.lines);
            created.setKinds(latest.current.kinds ?? null);
            // The place to look at may have become known between the first render and now.
            if (latest.current.view) created.jumpTo(latest.current.view.center, latest.current.view.zoom);
            map.current = created;
          });
        }
        map.current?.setActive(entry.isIntersecting);
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      map.current?.destroy();
      map.current = null;
    };
  }, []);

  useEffect(() => map.current?.setPoints(points), [points]);
  useEffect(() => {
    if (hubs) map.current?.setHubs(hubs);
  }, [hubs]);
  useEffect(() => map.current?.setKinds(kinds ?? null), [kinds]);
  useEffect(() => {
    if (view) map.current?.flyTo(view.center, view.zoom);
  }, [view]);

  return <div ref={box} role="img" aria-label={label} className={className} />;
}
