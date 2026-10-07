import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessError,
  EDGE_KINDS,
  expandNode,
  fetchCoInvestment,
  fetchGraphOverview,
  fetchMostConnected,
  fetchNeighbourhood,
  fetchOrg,
  fetchPath,
  storedAccessKey,
  type CoInvestment,
  type EdgeKind,
  type GraphAnswer,
  type GraphEdge,
  type GraphNode,
} from '../api';
import { AccessGate } from '../components/AccessGate';
import { ActionLink, EntityDetails, type Detail } from '../components/EntityDetails';
import { SiteNav } from '../components/SiteNav';
import { Icon, MicroLabel, Section, ShapeIcon, useMediaQuery } from '../components/ui';
import { DEMO_DATA } from '../config';
import { formatPartialDate, formatUsd } from '../lib/format';
import { mapUrlFor } from '../pages';
import { GraphCanvas } from './GraphCanvas';
import { layout, type Point } from './layout';
import { NodePicker, type Picked } from './NodePicker';
import { DEFAULT_KINDS, KIND_LABELS, KIND_LINES, nodeMark } from './style';

/**
 * Share-link state in the address: #v=1&n=<start node>&k=<kinds>&s=<selected>&x=<expanded>...
 * No n means the whole network. Unknown parts are dropped, never guessed at.
 */
interface GraphState {
  start: string | null;
  kinds: EdgeKind[];
  selected: string | null;
  expanded: string[];
}

function decodeState(hash: string): GraphState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const version = params.get('v');
  if (version !== null && version !== '1') return { start: null, kinds: DEFAULT_KINDS, selected: null, expanded: [] };
  const kinds = (params.get('k') ?? '').split(',').filter((kind): kind is EdgeKind => (EDGE_KINDS as readonly string[]).includes(kind));
  return {
    start: params.get('n'),
    kinds: kinds.length ? EDGE_KINDS.filter((kind) => kinds.includes(kind)) : DEFAULT_KINDS,
    selected: params.get('s'),
    expanded: params.getAll('x').slice(0, 20),
  };
}

function encodeState(state: GraphState): string {
  const parts = ['v=1'];
  if (state.start) parts.push(`n=${encodeURIComponent(state.start)}`);
  if (state.kinds.join() !== DEFAULT_KINDS.join()) parts.push(`k=${state.kinds.join(',')}`);
  if (state.selected) parts.push(`s=${encodeURIComponent(state.selected)}`);
  for (const id of state.expanded.slice(0, 20)) parts.push(`x=${encodeURIComponent(id)}`);
  return parts.join('&');
}

const initial = decodeState(location.hash);

interface Graph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}
const EMPTY: Graph = { nodes: new Map(), edges: new Map() };

function merged(graph: Graph, more: GraphAnswer): Graph {
  const nodes = new Map(graph.nodes);
  const edges = new Map(graph.edges);
  // A node already on screen keeps its place in the list; its facts are refreshed.
  for (const node of more.nodes) nodes.set(node.id, node);
  for (const edge of more.edges) edges.set(edge.id, edge);
  return { nodes, edges };
}

type PathResult =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'found'; names: string[] }
  | { status: 'none'; searchedAll: boolean };

function NodeButton({ node, onClick, aside }: { node: Pick<GraphNode, 'kind' | 'types' | 'name'>; onClick: () => void; aside?: ReactNode }) {
  const mark = nodeMark(node);
  return (
    <button type="button" className="flex h-6 w-full items-center gap-2 text-left hover:text-accent" onClick={onClick}>
      <ShapeIcon shape={mark.shape} color={mark.color} size={11} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {aside !== undefined && <span className="text-[11px] tabular-nums text-mute">{aside}</span>}
    </button>
  );
}

function LineSample({ kind }: { kind: EdgeKind }) {
  const line = KIND_LINES[kind];
  return (
    <svg width="22" height="8" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="4" x2="21" y2="4" stroke={line.color} strokeWidth={line.width + 0.6} strokeDasharray={line.dash} />
    </svg>
  );
}

export function GraphPage() {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [kinds, setKinds] = useState<EdgeKind[]>(initial.kinds);
  const [start, setStart] = useState<string | null>(initial.start);
  const [graph, setGraph] = useState<Graph>(EMPTY);
  const [positions, setPositions] = useState<Map<string, Point>>(new Map());
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [truncated, setTruncated] = useState(false);
  const [locked, setLocked] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const [top, setTop] = useState<GraphNode[]>([]);
  const [detail, setDetail] = useState<Detail>({ status: 'loading' });
  const [ties, setTies] = useState<CoInvestment | null>(null);
  const [pathFrom, setPathFrom] = useState<Picked | null>(null);
  const [pathTo, setPathTo] = useState<Picked | null>(null);
  const [path, setPath] = useState<PathResult>({ status: 'idle' });
  const [sheet, setSheet] = useState<'controls' | 'details' | null>(null);
  // Expansions named in a share link, replayed once after the first load.
  const replay = useRef(initial.expanded);

  const refuse = (error: unknown) => {
    if (error instanceof AccessError) setLocked(true);
  };

  // The graph is loaded afresh whenever the starting point or the kinds of link change.
  useEffect(() => {
    const controller = new AbortController();
    const again = replay.current;
    replay.current = [];
    setStatus('loading');
    (async () => {
      const first = start
        ? await fetchNeighbourhood(start, kinds, controller.signal)
        : await fetchGraphOverview(kinds, controller.signal);
      let next = merged(EMPTY, first);
      const done: string[] = [];
      for (const id of again) {
        if (!next.nodes.has(id)) continue;
        next = merged(next, await expandNode(id, [...next.nodes.keys()], kinds, controller.signal));
        done.push(id);
      }
      setGraph(next);
      setPositions(layout([...next.nodes.keys()], [...next.edges.values()], new Map(), false));
      setTruncated(Boolean(first.truncated));
      setExpanded(done);
      setHighlight(new Set());
      setPath({ status: 'idle' });
      setSelected((now) => (now && (next.nodes.has(now) || next.edges.has(now)) ? now : start));
      setFitKey((key) => key + 1);
      setStatus('ready');
    })().catch((error) => {
      if (controller.signal.aborted) return;
      refuse(error);
      // The API answers 404 for a starting point that is not published.
      setStatus(start && /responded 404/.test(String(error)) ? 'missing' : 'error');
    });
    return () => controller.abort();
  }, [start, kinds]);

  useEffect(() => {
    const controller = new AbortController();
    fetchMostConnected(controller.signal)
      .then((answer) => setTop(answer.organisations))
      .catch(refuse);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    history.replaceState(null, '', '#' + encodeState({ start, kinds, selected, expanded }));
  }, [start, kinds, selected, expanded]);

  // How many neighbours each node still has off screen: its degree less those drawn.
  const nodes = useMemo(() => {
    const drawn = new Map<string, Set<string>>();
    const link = (a: string, b: string) => (drawn.get(a) ?? drawn.set(a, new Set()).get(a)!).add(b);
    for (const edge of graph.edges.values()) {
      link(edge.source, edge.target);
      link(edge.target, edge.source);
    }
    return [...graph.nodes.values()].map((node) => ({
      ...node,
      hidden: Math.max(0, node.degree - (drawn.get(node.id)?.size ?? 0)),
    }));
  }, [graph]);
  const edges = useMemo(() => [...graph.edges.values()], [graph]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const selectedNode = selected ? byId.get(selected) : undefined;
  const selectedEdge = selected ? graph.edges.get(selected) : undefined;
  const selectedOrg = selectedNode?.kind === 'organisation' ? selectedNode.ref : null;

  useEffect(() => {
    setTies(null);
    if (!selectedOrg) return;
    const controller = new AbortController();
    setDetail({ status: 'loading' });
    fetchOrg(selectedOrg, controller.signal)
      .then((org) => setDetail({ status: 'org', org }))
      .catch(() => {
        if (!controller.signal.aborted) setDetail({ status: 'error' });
      });
    fetchCoInvestment(selectedOrg, controller.signal)
      .then(setTies)
      .catch(() => {});
    return () => controller.abort();
  }, [selectedOrg]);

  const addToGraph = (more: GraphAnswer) => {
    const next = merged(graph, more);
    setGraph(next);
    setPositions(layout([...next.nodes.keys()], [...next.edges.values()], positions, true));
    return next;
  };

  const expand = (id: string) => {
    if (!graph.nodes.has(id)) return;
    expandNode(id, [...graph.nodes.keys()], kinds)
      .then((more) => {
        addToGraph(more);
        setExpanded((now) => (now.includes(id) ? now : [...now, id]));
        setSelected(id);
      })
      .catch(refuse);
  };

  /** Start again from one node, or from the whole network. */
  const restart = (id: string | null) => {
    setStart(id);
    setSelected(id);
    if (id === start) setFitKey((key) => key + 1);
    setSheet(id ? 'details' : null);
  };

  const pick = (id: string | null) => {
    setSelected(id);
    if (!desktop) setSheet(id ? 'details' : null);
  };

  const toggleKind = (kind: EdgeKind) => {
    const next = EDGE_KINDS.filter((item) => (item === kind ? !kinds.includes(item) : kinds.includes(item)));
    // With nothing to follow there is no graph, so the last kind stays on.
    if (next.length) setKinds(next);
  };

  const from = pathFrom ?? (selectedNode?.kind === 'organisation' ? { id: selectedNode.id, name: selectedNode.name } : null);
  const findPath = () => {
    if (!from || !pathTo) return;
    setPath({ status: 'loading' });
    fetchPath(from.id, pathTo.id, kinds)
      .then((found) => {
        if (!found.found) {
          setHighlight(new Set());
          setPath({ status: 'none', searchedAll: found.searched_all });
          return;
        }
        addToGraph(found);
        setHighlight(new Set([...found.nodes.map((node) => node.id), ...found.edges.map((edge) => edge.id)]));
        setPath({ status: 'found', names: found.nodes.map((node) => node.name) });
        setSelected(null);
        setFitKey((key) => key + 1);
      })
      .catch((error) => {
        refuse(error);
        setPath({ status: 'error' });
      });
  };

  if (locked) return <AccessGate rejected={storedAccessKey() !== ''} />;

  const kindCounts = new Map<EdgeKind, number>();
  for (const edge of edges) kindCounts.set(edge.kind, (kindCounts.get(edge.kind) ?? 0) + 1);
  const listed = [...nodes].sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name));
  const widerKinds = !kinds.includes('located_in') || !kinds.includes('in_sector');

  const controls = (
    <>
      <Section id="graph-start" title="Start">
        <NodePicker label="Start from" value={null} onPick={(picked) => picked && restart(picked.id)} />
        <button
          type="button"
          disabled={start === null}
          className="mt-2 h-7 w-full rounded border border-line text-xs hover:bg-raised disabled:text-mute/60"
          onClick={() => restart(null)}
        >
          Show the whole network
        </button>
      </Section>
      <Section id="graph-kinds" title="Relationships">
        <ul className="space-y-1">
          {EDGE_KINDS.map((kind) => (
            <li key={kind}>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggleKind(kind)} className="accent-[var(--color-accent)]" />
                <LineSample kind={kind} />
                <span className="flex-1">{KIND_LABELS[kind]}</span>
                <span className="text-[11px] tabular-nums text-mute">{kindCounts.get(kind) ?? 0}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-mute">
          People, places and sectors are off to begin with: almost everything is linked through a shared city or sector.
        </p>
      </Section>
      <Section id="graph-path" title="Find a path">
        <div className="space-y-1.5">
          <NodePicker label="From" value={from} onPick={setPathFrom} />
          <NodePicker label="To" value={pathTo} onPick={setPathTo} />
          <button
            type="button"
            disabled={!from || !pathTo || path.status === 'loading'}
            className="h-7 w-full rounded bg-accent text-xs font-semibold text-bg disabled:opacity-40"
            onClick={findPath}
          >
            Find the shortest chain
          </button>
        </div>
        <div aria-live="polite" className="mt-2 text-[11px] leading-snug">
          {path.status === 'found' && (
            <p className="m-0">
              <span className="text-good">{path.names.length - 1} link{path.names.length === 2 ? '' : 's'}:</span> {path.names.join(' → ')}
            </p>
          )}
          {path.status === 'none' && (
            <p className="m-0 text-mute">
              No connection on record{path.searchedAll ? '' : ' within six links'}.
              {widerKinds && ' Turning on places or sectors links organisations through a shared city or sector.'}
            </p>
          )}
          {path.status === 'error' && <p className="m-0 text-warn">The path could not be looked up.</p>}
        </div>
      </Section>
      <Section id="graph-top" title="Most connected">
        {top.length === 0 && <p className="m-0 text-mute">No connections on record yet.</p>}
        {top.map((node) => (
          <NodeButton key={node.id} node={node} aside={node.degree} onClick={() => restart(node.id)} />
        ))}
      </Section>
      <Section id="graph-list" title="In view" aside={`${nodes.length}`}>
        {listed.slice(0, 120).map((node) => (
          <NodeButton key={node.id} node={node} aside={node.degree} onClick={() => pick(node.id)} />
        ))}
        {listed.length > 120 && <p className="m-0 mt-1 text-[11px] text-mute">And {listed.length - 120} more with fewer connections.</p>}
      </Section>
    </>
  );

  const buttonClass = 'flex h-7 items-center rounded border border-line px-2 text-xs hover:border-accent hover:text-accent';
  const nodeActions = (node: GraphNode) => (
    <>
      {node.hidden > 0 && (
        <button type="button" className={buttonClass} onClick={() => expand(node.id)}>
          Show {node.hidden} more connection{node.hidden === 1 ? '' : 's'}
        </button>
      )}
      {start !== node.id && (
        <button type="button" className={buttonClass} onClick={() => restart(node.id)}>
          Centre the graph here
        </button>
      )}
      {node.kind === 'organisation' && node.ref && <ActionLink href={mapUrlFor(node.ref)}>Show on map</ActionLink>}
    </>
  );

  const tieList = (title: string, rows: CoInvestment['co_investors'], through: string) =>
    rows.length > 0 && (
      <section className="border-t border-line px-3 py-2.5">
        <MicroLabel>
          {title} · {rows.length}
        </MicroLabel>
        <ul className="mt-1.5">
          {rows.map((row) => (
            <li key={row.organisation.id}>
              <NodeButton node={row.organisation} aside={row.shared.length} onClick={() => (byId.has(row.organisation.id) ? pick(row.organisation.id) : restart(row.organisation.id))} />
              <div className="-mt-0.5 mb-1 pl-[19px] text-[11px] leading-snug text-mute">
                {through} {row.shared.map((item) => item.name).join(', ')}
              </div>
            </li>
          ))}
        </ul>
      </section>
    );

  let details: ReactNode;
  if (selectedEdge) {
    const source = byId.get(selectedEdge.source);
    const target = byId.get(selectedEdge.target);
    details = (
      <div aria-live="polite">
        <div className="flex h-8 items-center justify-between px-3">
          <MicroLabel>Selected link</MicroLabel>
          <button type="button" aria-label="Close details" className="text-mute hover:text-ink" onClick={() => pick(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 text-[11px] text-mute">
            <LineSample kind={selectedEdge.kind} />
            {KIND_LABELS[selectedEdge.kind]}
          </div>
          <div className="mt-1.5">
            {source && <NodeButton node={source} onClick={() => pick(source.id)} />}
            <div className="pl-[19px] text-[11px] text-mute">{KIND_LABELS[selectedEdge.kind].toLowerCase()}</div>
            {target && <NodeButton node={target} onClick={() => pick(target.id)} />}
          </div>
          {selectedEdge.label && <p className="m-0 mt-2">{selectedEdge.label}</p>}
        </div>
        {selectedEdge.evidence.length > 0 && (
          <section className="border-t border-line px-3 py-2.5">
            <MicroLabel>Source</MicroLabel>
            <ul className="mt-1.5 space-y-2">
              {selectedEdge.evidence.map((item, index) => (
                <li key={index}>
                  {item.quote && <p className="m-0 leading-snug">“{item.quote}”</p>}
                  {item.source_url && /^https?:\/\//i.test(item.source_url) ? (
                    <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent2 underline">
                      {new URL(item.source_url).hostname}
                    </a>
                  ) : (
                    <span className="text-[11px] text-mute">No link recorded</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {selectedEdge.rounds.length > 0 && (
          <section className="border-t border-line px-3 py-2.5">
            <MicroLabel>Rounds · {selectedEdge.rounds.length}</MicroLabel>
            <ul className="mt-1.5 space-y-2">
              {selectedEdge.rounds.map((round) => (
                <li key={round.id}>
                  <div className="flex justify-between tabular-nums">
                    <span>
                      {round.stage ?? 'Round'}
                      {round.is_lead && <span className="ml-1.5 text-[11px] text-accent">lead</span>}
                    </span>
                    <span>{round.amount_usd != null ? formatUsd(round.amount_usd) : 'undisclosed'}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-mute">
                    <span>{round.announced_on ? formatPartialDate(round.announced_on, round.announced_precision) : 'Date not recorded'}</span>
                    {round.source_url && /^https?:\/\//i.test(round.source_url) ? (
                      <a href={round.source_url} target="_blank" rel="noopener noreferrer" className="text-accent2 underline">
                        {new URL(round.source_url).hostname}
                      </a>
                    ) : (
                      <span>No link recorded</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  } else if (selectedNode?.kind === 'organisation') {
    details = (
      <>
        <EntityDetails
          detail={detail}
          onClose={() => pick(null)}
          onSelect={(selection) => {
            const id = `${selection.kind === 'event' ? 'event' : 'org'}:${selection.id}`;
            if (byId.has(id)) pick(id);
            else if (selection.kind === 'org') restart(id);
          }}
          actions={() => nodeActions(selectedNode)}
        />
        {selectedNode.degree === 0 && <p className="m-0 border-t border-line px-3 py-2.5 text-mute">No connections on record for the kinds of link switched on.</p>}
        {ties && tieList('Invests alongside', ties.co_investors, 'Both back')}
        {ties && tieList('Shares an investor with', ties.shared_investors, 'Both backed by')}
      </>
    );
  } else if (selectedNode) {
    const mark = nodeMark(selectedNode);
    details = (
      <div aria-live="polite">
        <div className="flex h-8 items-center justify-between px-3">
          <MicroLabel>Selected</MicroLabel>
          <button type="button" aria-label="Close details" className="text-mute hover:text-ink" onClick={() => pick(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 text-[11px] text-mute">
            <ShapeIcon shape={mark.shape} color={mark.color} />
            {mark.label}
          </div>
          <h2 className="mb-0.5 mt-1 text-lg font-semibold leading-tight">{selectedNode.name}</h2>
          {selectedNode.detail && <div className="text-mute">{selectedNode.detail}</div>}
          {selectedNode.country && selectedNode.kind === 'place' && <div className="text-mute">{selectedNode.country}</div>}
          <div className="mt-2 tabular-nums">
            {selectedNode.degree} connection{selectedNode.degree === 1 ? '' : 's'}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{nodeActions(selectedNode)}</div>
        </div>
      </div>
    );
  } else {
    const present = new Map(nodes.map((node) => [nodeMark(node).label, nodeMark(node)]));
    details = (
      <>
        <Section id="graph-help" title="How to read this">
          <p className="m-0 leading-snug text-mute">
            Each mark is an organisation, drawn as on the map. A line is something on record between two of them. Click a
            mark for its details, double-click to bring in what it is connected to, and click a line to see what it stands
            for.
          </p>
        </Section>
        <Section id="graph-legend" title="Legend">
          <ul className="space-y-1">
            {[...present.values()].map((mark) => (
              <li key={mark.label} className="flex items-center gap-2">
                <ShapeIcon shape={mark.shape} color={mark.color} />
                {mark.label}
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-1">
            {kinds.map((kind) => (
              <li key={kind} className="flex items-center gap-2">
                <LineSample kind={kind} />
                {KIND_LABELS[kind]}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[11px] text-mute">A small +N beside a mark is how many of its connections are not drawn yet.</p>
        </Section>
      </>
    );
  }

  const message =
    status === 'loading'
      ? 'Loading the graph…'
      : status === 'error'
        ? 'The graph could not be loaded.'
        : status === 'missing'
          ? 'That starting point is not on record.'
          : nodes.length === 0
            ? 'No connections on record for these kinds of link.'
            : null;

  return (
    <div className="flex h-full flex-col">
      <SiteNav current="graph" />
      <div className="relative flex min-h-0 flex-1">
        {desktop && <aside className="w-64 shrink-0 overflow-y-auto border-r border-line bg-panel">{controls}</aside>}
        <main className="relative min-w-0 flex-1">
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            positions={positions}
            selected={selected}
            highlight={highlight}
            fitKey={fitKey}
            onSelect={pick}
            onExpand={expand}
            onMove={(id, point) => setPositions((now) => new Map(now).set(id, point))}
          />
          {message && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="pointer-events-auto rounded border border-line bg-panel px-4 py-3 text-center">
                <p className="m-0" role="status">
                  {message}
                </p>
                {status === 'missing' && (
                  <button type="button" className="mt-2 text-accent2 underline" onClick={() => restart(null)}>
                    Show the whole network
                  </button>
                )}
              </div>
            </div>
          )}
          {truncated && status === 'ready' && (
            <p className="absolute left-3 top-3 m-0 max-w-xs rounded border border-line bg-panel px-2.5 py-1.5 text-[11px] text-mute">
              There is more than fits on one screen: the best connected are shown. Start from one organisation, or switch
              off a kind of link, to see the rest.
            </p>
          )}
          {!desktop && (
            <div className="absolute left-3 top-3 flex gap-1.5">
              <button type="button" className="h-8 rounded border border-line bg-panel px-2.5 text-xs" onClick={() => setSheet('controls')}>
                Controls
              </button>
              <button type="button" className="h-8 rounded border border-line bg-panel px-2.5 text-xs" onClick={() => setSheet('details')}>
                Details
              </button>
            </div>
          )}
        </main>
        {desktop && <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-panel">{details}</aside>}
        {!desktop && sheet && (
          <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[62%] flex-col rounded-t-lg border-t border-line bg-panel shadow-2xl shadow-black">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
              <MicroLabel>{sheet === 'controls' ? 'Controls' : 'Details'}</MicroLabel>
              <button type="button" aria-label="Close" className="text-mute hover:text-ink" onClick={() => setSheet(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{sheet === 'controls' ? controls : details}</div>
          </div>
        )}
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-5 overflow-hidden border-t border-line bg-panel px-3 text-[11px]">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <MicroLabel>Data status</MicroLabel>
          <span className={`h-1.5 w-1.5 rounded-full ${status === 'error' ? 'bg-crit' : DEMO_DATA ? 'bg-warn' : 'bg-good'}`} aria-hidden="true" />
          <span>{status === 'error' ? 'Offline' : DEMO_DATA ? 'Demo data' : 'Live'}</span>
        </span>
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <MicroLabel>Nodes</MicroLabel>
          <span className="tabular-nums">{nodes.length}</span>
        </span>
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <MicroLabel>Relationships</MicroLabel>
          <span className="tabular-nums">{edges.length}</span>
        </span>
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <MicroLabel>View</MicroLabel>
          <span>{start ? `From ${byId.get(start)?.name ?? 'one record'}` : 'Whole network'}</span>
        </span>
      </footer>
    </div>
  );
}
