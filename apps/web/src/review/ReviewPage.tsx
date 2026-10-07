import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AccessError,
  ApiError,
  fetchMe,
  fetchReview,
  settleReview,
  storedAccessKey,
  type Me,
  type OrgLink,
  type ReviewItem,
  type ReviewList,
} from '../api';
import { hasSession, SIGN_IN_AVAILABLE, signInProblem, signOut } from '../auth';
import { AccessGate } from '../components/AccessGate';
import { canReview, SignInForm } from '../components/Account';
import { SiteNav } from '../components/SiteNav';
import { MicroLabel, ShapeIcon } from '../components/ui';
import { layerForTypes, TYPE_LABELS } from '../entities';
import { NodePicker, type Picked } from '../graph/NodePicker';
import { KIND_LABELS } from '../graph/style';
import { countryName, formatDate } from '../lib/format';

type Tab = 'pending' | 'settled';

const button = 'h-8 rounded border px-3 text-xs font-semibold disabled:opacity-40';

function Link({ url }: { url: string | null }) {
  if (!url || !/^https?:\/\//i.test(url)) return <span className="text-mute">No link recorded</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent2 underline">
      {new URL(url).hostname}
    </a>
  );
}

/** One side of a proposed relationship: the record its name finds, or a way to choose one. */
function Side({
  name,
  match,
  chosen,
  onChoose,
  editable,
}: {
  name: string | null;
  match: OrgLink | null;
  chosen: Picked | null;
  onChoose: (picked: Picked | null) => void;
  editable: boolean;
}) {
  const layer = match ? layerForTypes(match.types) : undefined;
  if (match)
    return (
      <div className="flex items-center gap-2 font-medium">
        {layer && <ShapeIcon shape={layer.shape} color={layer.color} size={11} />}
        {match.name}
      </div>
    );
  return (
    <div>
      <div className="font-medium">
        {name ?? 'Not named'} <span className="ml-1 text-[11px] font-normal text-warn">not on record</span>
      </div>
      {editable && (
        <div className="mt-1.5 max-w-sm">
          <NodePicker label="It means" value={chosen} onPick={onChoose} placeholder="choose the record…" />
        </div>
      )}
    </div>
  );
}

function Card({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const [from, setFrom] = useState<Picked | null>(null);
  const [to, setTo] = useState<Picked | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = item.status === 'pending';
  const org = item.organisation;
  const proposal = item.proposal;
  const layer = org ? layerForTypes(org.types) : undefined;

  const act = (action: 'approve' | 'reject' | 'reopen') => {
    setBusy(true);
    setProblem(null);
    // The picker hands back a graph node id; the API wants the record's own.
    const idOf = (picked: Picked | null) => picked?.id.replace(/^org:/, '');
    settleReview(item.id, action, action === 'approve' ? { from_id: idOf(from), to_id: idOf(to) } : action === 'reject' ? { note: note.trim() || undefined } : {})
      .then(onDone)
      .catch((error) => {
        setProblem(error instanceof ApiError && error.detail ? error.detail : 'That did not work. Try again.');
        setBusy(false);
      });
  };

  const ready = !proposal || ((proposal.from_match || from) && (proposal.to_match || to));
  let body: ReactNode;
  if (org) {
    body = (
      <>
        <div className="flex items-center gap-2 text-[11px] text-mute">
          {layer && <ShapeIcon shape={layer.shape} color={layer.color} />}
          {org.types.map((type) => TYPE_LABELS[type] ?? type).join(' · ')}
          {org.city && <span>· {[org.city, org.country && countryName(org.country)].filter(Boolean).join(', ')}</span>}
        </div>
        <h2 className="m-0 mt-1 text-base font-semibold leading-tight">{org.name}</h2>
        {org.sectors.length > 0 && <div className="text-accent">{org.sectors.join(' / ')}</div>}
        {org.description && <p className="m-0 mt-1.5 max-w-3xl leading-snug">{org.description}</p>}
        <div className="mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-mute">
          {org.website_domain && <Link url={`https://${org.website_domain}`} />}
          <span>
            {org.sources} source{org.sources === 1 ? '' : 's'} on record
          </span>
        </div>
      </>
    );
  } else if (proposal) {
    const kind = proposal.kind && proposal.kind in KIND_LABELS ? KIND_LABELS[proposal.kind as keyof typeof KIND_LABELS] : (proposal.kind ?? 'Unknown relation');
    body = (
      <>
        <div className="text-[11px] text-mute">Proposed relationship</div>
        <div className="mt-1.5 space-y-1">
          <Side name={proposal.from} match={proposal.from_match} chosen={from} onChoose={setFrom} editable={pending} />
          <div className="text-accent">{kind.toLowerCase()}</div>
          <Side name={proposal.to} match={proposal.to_match} chosen={to} onChoose={setTo} editable={pending} />
        </div>
        {proposal.label && <p className="m-0 mt-1.5">{proposal.label}</p>}
        {proposal.quote && <p className="m-0 mt-1.5 max-w-3xl leading-snug text-mute">“{proposal.quote}”</p>}
        <div className="mt-1 text-[11px]">
          <Link url={proposal.source_url} />
        </div>
      </>
    );
  } else body = <p className="m-0 text-mute">This kind of item cannot be shown here yet.</p>;

  return (
    <li className="rounded border border-line bg-panel p-4">
      {body}
      <div className="mt-3 border-t border-line pt-3 text-[11px] text-mute">
        {item.reason && (
          <div>
            <span className="text-warn">Held because:</span> {item.reason}
          </div>
        )}
        <div>
          From {item.source ?? 'an unknown import'}, {formatDate(item.created_at)}
          {item.reviewed_by && item.reviewed_at && (
            <>
              {' · '}
              <span className={item.status === 'approved' ? 'text-good' : 'text-warn'}>{item.status}</span> by {item.reviewed_by},{' '}
              {formatDate(item.reviewed_at)}
            </>
          )}
        </div>
        {item.note && <div>Reviewer’s note: {item.note}</div>}
      </div>
      {problem && (
        <p className="m-0 mt-2 text-sm text-warn" role="alert">
          {problem}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pending && !rejecting && (
          <>
            <button type="button" disabled={busy || !ready} className={`${button} border-accent bg-accent text-bg`} onClick={() => act('approve')}>
              Approve and publish
            </button>
            <button type="button" disabled={busy} className={`${button} border-line hover:bg-raised`} onClick={() => setRejecting(true)}>
              Reject
            </button>
            {!ready && <span className="text-[11px] text-mute">Choose the record for the name that is not on record, or reject.</span>}
          </>
        )}
        {pending && rejecting && (
          <>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Why it is rejected</span>
              <input
                autoFocus
                value={note}
                maxLength={500}
                placeholder="Why (optional)"
                onChange={(event) => setNote(event.target.value)}
                className="h-8 w-full rounded border border-line bg-bg px-2 text-xs placeholder:text-mute"
              />
            </label>
            <button type="button" disabled={busy} className={`${button} border-warn text-warn`} onClick={() => act('reject')}>
              Confirm rejection
            </button>
            <button type="button" disabled={busy} className={`${button} border-line`} onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </>
        )}
        {/* An approved relationship has become a record of its own and is not undone from here yet. */}
        {!pending && !(item.status === 'approved' && item.kind !== 'organisation') && (
          <button type="button" disabled={busy} className={`${button} border-line hover:bg-raised`} onClick={() => act('reopen')}>
            Reopen
          </button>
        )}
      </div>
    </li>
  );
}

export function ReviewPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('pending');
  const [list, setList] = useState<ReviewList | null>(null);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch((error) => (error instanceof AccessError ? setLocked(true) : setFailed(true)));
  }, []);

  const allowed = canReview(me);
  const load = useCallback(() => {
    if (!allowed) return;
    fetchReview(tab)
      .then((answer) => {
        setList(answer);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [allowed, tab]);
  useEffect(() => {
    setList(null);
    load();
  }, [load]);

  if (locked) return <AccessGate rejected={storedAccessKey() !== ''} />;

  let content: ReactNode;
  if (failed) content = <p role="alert" className="mt-4 text-warn">The review queue could not be loaded.</p>;
  else if (!me) content = <p className="mt-4 text-mute">Checking who you are…</p>;
  else if (!allowed)
    content = (
      <div className="mt-4 max-w-sm rounded-lg border border-line bg-panel p-5">
        <p className="m-0 mb-3 text-sm">
          {!me.email
            ? 'The review queue is for reviewers. Sign in with a reviewer’s address to use it.'
            : me.role
              ? `You are signed in as ${me.email}, which is a ${me.role}, not a reviewer.`
              : `You are signed in as ${me.email}. That address is not on the list of users, so it has no access of its own. Ask the admin to add it, or sign out and use an address that is on the list.`}
        </p>
        {signInProblem && (
          <p className="m-0 mb-3 text-sm text-warn" role="alert">
            The sign-in link did not work: {signInProblem}
          </p>
        )}
        {me.email && hasSession() && (
          <button type="button" className="h-10 w-full rounded border border-line text-sm hover:bg-raised" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
        {!me.email && (SIGN_IN_AVAILABLE ? <SignInForm /> : <p className="m-0 text-sm text-mute">Sign-in is not set up in this copy.</p>)}
      </div>
    );
  else {
    const groups: [string, ReviewItem[]][] = [
      ['Organisations', list?.items.filter((item) => item.kind === 'organisation') ?? []],
      ['Relationships', list?.items.filter((item) => item.kind === 'relationship') ?? []],
      ['Other', list?.items.filter((item) => item.kind === 'other') ?? []],
    ];
    content = (
      <>
        <div role="tablist" aria-label="Review queue" className="mt-3 flex gap-1 border-b border-line">
          {(
            [
              ['pending', 'Waiting', list?.pending],
              ['settled', 'Settled by reviewers', list?.settled],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex h-9 items-center gap-2 border-b-2 px-2.5 ${tab === id ? 'border-accent text-ink' : 'border-transparent text-mute hover:text-ink'}`}
            >
              {label}
              <span className="text-[11px] tabular-nums text-mute">{count ?? ''}</span>
            </button>
          ))}
        </div>
        {!list && <p className="mt-4 text-mute">Loading…</p>}
        {list && list.items.length === 0 && (
          <p className="mt-4 text-mute">{tab === 'pending' ? 'Nothing is waiting for review.' : 'No decisions have been made here yet.'}</p>
        )}
        {groups.map(
          ([title, items]) =>
            items.length > 0 && (
              <section key={title} className="mt-5" aria-label={title}>
                <MicroLabel>
                  {title} · {items.length}
                </MicroLabel>
                <ul className="mt-2 space-y-2">
                  {items.map((item) => (
                    <Card key={`${item.id}-${item.status}`} item={item} onDone={load} />
                  ))}
                </ul>
              </section>
            ),
        )}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SiteNav current="review" />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-4 py-4">
          <h1 className="m-0 text-lg font-semibold">Review queue</h1>
          <p className="m-0 mt-0.5 max-w-3xl text-mute">
            What the importers would not publish by their own rules. Approving publishes it; rejecting keeps it out. Each
            decision is recorded with who made it, and can be reopened.
          </p>
          {content}
        </div>
      </main>
    </div>
  );
}
