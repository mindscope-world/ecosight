# Extraction labelled set

`labelled.jsonl` is the hand-labelled set of news items that extraction accuracy is
measured on. The target is 200 items; it does not exist until the researchers add
the first ones. `labelled.example.jsonl` holds four invented items that show the
format and keep the harness tests running. Do not report accuracy from it.

## Format

One JSON object per line:

| Key | Meaning |
|-----|---------|
| `id` | Short unique id, for example `techcabal-2026-0412` |
| `url` | Where the item was published |
| `title` | Headline as published |
| `text` | Body text as stored by the crawler |
| `is_funding_announcement` | `true` if the item reports one named company raising money |
| `expected.company` | Company name without descriptions such as "Kenyan fintech" |
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
