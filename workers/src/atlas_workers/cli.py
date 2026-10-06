"""Command line for the pipeline steps: `atlas crawl`, `atlas extract`, `atlas eval`."""

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from . import config
from .extract import Document, Extractor, verify


def make_extractor(name: str) -> Extractor:
    if name == "rules":
        from .extract.rules import RuleExtractor

        return RuleExtractor()
    from .extract.llm import LlmExtractor

    return LlmExtractor()


def cmd_crawl(args: argparse.Namespace) -> int:
    import psycopg

    from .crawl import crawl_feed, make_client
    from .sources import SOURCES
    from .store import LocalStorage, RawStore

    wanted = [s for s in SOURCES if not args.source or s.id in args.source]
    failed = 0
    with psycopg.connect(config.database_url()) as conn, make_client() as client:
        store = RawStore(conn, LocalStorage(config.raw_store_dir()))
        for source in wanted:
            # One source failing must not stop the others.
            try:
                result = crawl_feed(source, store, client)
                print(f"{result.source}: {result.entries} entries, {result.new} new")
            except Exception as error:
                failed += 1
                print(f"{source.id}: failed: {error}", file=sys.stderr)
    return 1 if failed else 0


def cmd_extract(args: argparse.Namespace) -> int:
    raw = json.loads(Path(args.document).read_text())
    document = Document(raw["url"], raw["title"], raw["text"])
    result = verify(make_extractor(args.extractor).extract(document), document)
    print(json.dumps(asdict(result), indent=2, ensure_ascii=False))
    return 0


def cmd_eval(args: argparse.Namespace) -> int:
    from .evaluate import evaluate, load_labelled

    items = load_labelled(Path(args.labelled))
    if not items:
        print(f"{args.labelled} has no labelled items", file=sys.stderr)
        return 1
    report = evaluate(make_extractor(args.extractor), items)
    print(json.dumps(report.as_dict(), indent=2) if args.json else report.as_text())
    if args.failures:
        print("\n" + "\n".join(report.failures))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="atlas")
    commands = parser.add_subparsers(required=True)

    crawl = commands.add_parser("crawl", help="fetch news feeds into the raw document store")
    crawl.add_argument("--source", action="append", help="source id; repeat for several (default: all)")
    crawl.set_defaults(run=cmd_crawl)

    extractors = {"choices": ["rules", "llm"], "default": "rules"}
    extract = commands.add_parser("extract", help="extract one stored document (a JSON file)")
    extract.add_argument("document")
    extract.add_argument("--extractor", **extractors)
    extract.set_defaults(run=cmd_extract)

    evaluate = commands.add_parser("eval", help="score an extractor on the labelled set")
    evaluate.add_argument("--labelled", default=str(config.REPO_ROOT / "eval" / "labelled.jsonl"))
    evaluate.add_argument("--extractor", **extractors)
    evaluate.add_argument("--json", action="store_true", help="print the report as JSON")
    evaluate.add_argument("--failures", action="store_true", help="list each wrong field")
    evaluate.set_defaults(run=cmd_eval)

    args = parser.parse_args()
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
