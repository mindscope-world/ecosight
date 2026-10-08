# Extraction labelled set

`labelled.jsonl` is the hand-labelled set of news items that extraction accuracy is
measured on. The target is 200 items; the first 50 were labelled on Oct 8, 2026.
`labelled.example.jsonl` holds four invented items that show the format and keep the
harness tests running. Do not report accuracy from it.

**`labelled.jsonl` is not in git, and must not be added.** It holds the publishers'
article text, which is not ours to republish, and the repository is public. Keep your
own copy; a fresh clone will not have it.

## The first 50

Taken from TechCabal's funding feeds and Disrupt Africa's general feed, June to October
2026: 29 reports of one company raising money and 21 that are not. The 21 are mostly
traps chosen on purpose: market summaries, newsletters, an acquisition, a fund raising
its own fund, an investor backing two companies at once, a launch story that mentions an
earlier round. That is more than the quarter asked for below, because false alarms were
the model's weakness on its first trial.

How the first 50 were labelled, where the text leaves room:

- Debt counts as raising money: a loan facility, commercial paper or a securitisation is
  a funding announcement with stage `debt`.
- A round that mixes equity and debt with no stage named has no `stage`.
- The amount is the one in the headline's currency. Where a report gives a local amount
  and its dollar equivalent, the dollar figure is the label.
- Investors are those named as taking part in the round, written as the text first
  writes them, without an abbreviation in brackets. A funder said to have given money
  separately from the round is left out.
- Three candidates were left out as too unclear to label: a round that is part equity
  and part bank debt, a "secondary investment", and a round stated only in dinars.

The labels are one person's reading and have not been checked by a second.

## Format

One JSON object per line:

| Key | Meaning |
|-----|---------|
| `id` | Short unique id, for example `techcabal-2026-0412` |
| `url` | Where the item was published |
| `title` | Headline as published |
| `text` | Body text as stored by the crawler |
| `is_funding_announcement` | `true` if the item reports one named company raising money |
| `expected.company` | Company name without descriptions such as "Kenyan fintech". A list when the report uses more than one name for it; any of them counts |
| `note` | Optional. For an item that is not a funding announcement, what it is instead |
| `expected.amount` | Plain number in the stated currency |
| `expected.currency` | ISO 4217 code |
| `expected.stage` | One of: pre-seed, seed, pre-series a, series a to d, debt, grant |
| `expected.investors` | Every named investor |

Leave a key out of `expected` when the item does not state it. Include items that
are not funding announcements: about a quarter of the set, so false positives are
measured too.

## Labelling from crawled items

`uv run atlas crawl` (from `workers/`) stores each feed entry under `data/raw/` as
JSON with `url`, `title` and `text`. Copy those three into a new line, then add
`id`, `is_funding_announcement` and `expected` by reading the item.

## Running

```sh
cd workers
uv run atlas eval                      # rule-based baseline on eval/labelled.jsonl
uv run atlas eval --extractor llm      # model on Groq, needs GROQ_API_KEY
uv run atlas eval --failures           # list each wrong field
```

Paste the report into any pull request that changes a prompt, a model or a rule.
