import { useEffect } from 'react';
import { formatMonth, formatUsd } from '../lib/format';
import { WINDOWS, type Window } from '../lib/timeline';
import { Chip } from './ui';

const STEP_MS = 800;

/**
 * Replays funding rounds month by month. The slider moves the end of a window of 1, 3 or 12 months;
 * the map shows the rounds inside it. Rounds with no month on record cannot be placed, and say so.
 */
export function TimeSlider({
  months,
  index,
  onIndex,
  window,
  onWindow,
  playing,
  onPlaying,
  shown,
  raised,
  unplaced,
  phone,
}: {
  /** Every month the slider covers, oldest first. */
  months: string[];
  index: number;
  onIndex: (index: number) => void;
  window: Window;
  onWindow: (window: Window) => void;
  playing: boolean;
  onPlaying: (playing: boolean) => void;
  /** Rounds inside the window, and the dollars they raised where amounts are stated. */
  shown: number;
  raised: number;
  /** Rounds that have no month to place them on. */
  unplaced: number;
  phone: boolean;
}) {
  const last = months.length - 1;
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      onPlaying(false);
      return;
    }
    const timer = setTimeout(() => onIndex(index + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, index, last, onIndex, onPlaying]);

  const end = months[index]!;
  return (
    <div
      className={`absolute left-1/2 z-10 w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-line bg-panel/95 px-3 py-2 shadow-lg shadow-black/50 ${phone ? 'bottom-24' : 'bottom-9'}`}
      role="group"
      aria-label="Funding rounds over time"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-accent hover:bg-bg"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => {
            // Playing from the end starts again from the first month.
            if (!playing && index >= last) onIndex(0);
            onPlaying(!playing);
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
            <path d={playing ? 'M2 1h3v10H2zM7 1h3v10H7z' : 'M2 1l9 5-9 5z'} />
          </svg>
        </button>
        <input
          type="range"
          aria-label="Month"
          aria-valuetext={formatMonth(end, true)}
          className="min-w-0 flex-1 accent-cyan-400"
          min={0}
          max={last}
          value={index}
          disabled={last < 1}
          onChange={(event) => {
            onPlaying(false);
            onIndex(event.target.valueAsNumber);
          }}
        />
        <span className="w-[4.5rem] shrink-0 text-right text-sm font-medium tabular-nums text-ink">{formatMonth(end, true)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-mute" aria-live="polite">
        <span>
          <span className="font-medium tabular-nums text-ink">{shown}</span> round{shown === 1 ? '' : 's'}
          {raised > 0 && <> · {formatUsd(raised)}</>} in the {window === 1 ? 'month' : `${window} months`} to {formatMonth(end, true)}
          {unplaced > 0 && <> · {unplaced} with no month on record not shown</>}
        </span>
        <span className="flex gap-1">
          {WINDOWS.map((value) => (
            <Chip key={value} active={window === value} onClick={() => onWindow(value)} title={`Show the ${value} months up to the one chosen`}>
              {value === 1 ? '1 mo' : `${value} mo`}
            </Chip>
          ))}
        </span>
      </div>
    </div>
  );
}
