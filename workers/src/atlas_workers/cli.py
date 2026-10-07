"""Command line for the pipeline steps: `atlas crawl`, `atlas extract`, `atlas eval`, `atlas import-orgs`."""

import argparse
import json
import sys
from dataclasses import asdict
from datetime import date
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


def cmd_import(args: argparse.Namespace) -> int:
    from .geocode import Geocoder
    import psycopg

    from .importer import apply, build_report, locate, match_existing, read_dataset, read_register

    path = Path(args.dataset)
    mapping = json.loads(Path(args.mapping).read_text()) if args.mapping else {}
    # A mapping file is either the columns alone, or columns with the curator's notes beside them:
    # other names, a status for one row, and values for one row that the dataset does not state plainly.
    columns = mapping.get("columns", mapping) or None
    # A dataset that cites its sources by ID names the file listing them, which sits beside it.
    listed = mapping.get("source_register")
    register = read_register(path.parent / listed["file"], listed["id"], listed["url"]) if listed else None
    records = read_dataset(
        path,
        columns,
        args.publish_all,
        mapping.get("aliases"),
        mapping.get("statuses"),
        mapping.get("overrides"),
        register,
    )
    # Checked on a dry run too, so the report shows what would be skipped.
    try:
        with psycopg.connect(config.database_url(), connect_timeout=5) as conn:
            match_existing(conn, records, path.stem)
    except psycopg.OperationalError:
        if args.apply:
            raise
        print("Database not reachable: existing records were not checked.", file=sys.stderr)
    geocoder = Geocoder(config.geocode_cache())
    for record in records:
        locate(record, geocoder)
    report = build_report(records, path.name)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report)
    published = sum(record.publish for record in records)
    print(f"{len(records)} rows read, {published} to publish, {len(records) - published} drafts")
    print(f"{geocoder.requests} geocoding requests made; report written to {report_path}")
    if not args.apply:
        print("Dry run: nothing was written to the database. Add --apply to load.")
        return 0

    with psycopg.connect(config.database_url()) as conn:
        apply(conn, records, path.stem, args.snapshot, args.replace_sample)
    print("Loaded.")
    return 0


def cmd_rounds(args: argparse.Namespace) -> int:
    import psycopg

    from .rounds import apply, check_against_database, read_file, summarise

    doc, rounds, problems = read_file(Path(args.file))
    with psycopg.connect(config.database_url()) as conn:
        orgs, more = check_against_database(conn, doc["dataset"], rounds)
        problems += more
        if problems:
            print("\n".join(problems), file=sys.stderr)
            print(f"{len(problems)} problem(s); nothing loaded.", file=sys.stderr)
            return 1
        print(summarise(doc, rounds))
        if not args.apply:
            print("\nDry run: nothing was written to the database. Add --apply to load.")
            return 0
        apply(conn, doc, rounds, orgs)
    print("\nLoaded.")
    return 0


def cmd_locations(args: argparse.Namespace) -> int:
    import psycopg

    from .geocode import Geocoder
    from .locations import apply, read_file, resolve, summarise

    path = Path(args.file)
    doc, placements = read_file(path)
    key = f"{path.stem}/locations"
    with psycopg.connect(config.database_url()) as conn:
        resolve(conn, placements, Geocoder(config.geocode_cache()), key)
        print(summarise(placements))
        if not args.apply:
            print("\nDry run: nothing was written to the database. Add --apply to load.")
            return 0
        apply(conn, doc, placements, key)
    print("\nLoaded.")
    return 0


def cmd_links(args: argparse.Namespace) -> int:
    import psycopg

    from .links import apply, read_file, resolve, summarise

    path = Path(args.file)
    links = read_file(path)
    with psycopg.connect(config.database_url()) as conn:
        resolve(conn, links)
        print(summarise(links))
        if not args.apply:
            print("\nDry run: nothing was written to the database. Add --apply to load.")
            return 0
        apply(conn, links, f"{path.stem}/links", args.snapshot)
    print("\nLoaded.")
    return 0


def cmd_convert(args: argparse.Namespace) -> int:
    import psycopg

    from .fx import Rates, apply, plan, summarise

    with psycopg.connect(config.database_url()) as conn:
        conversions = plan(conn, Rates(config.REPO_ROOT / "data" / "fx-cache.json"))
        print(summarise(conversions))
        if not args.apply:
            print("\nDry run: nothing was written to the database. Add --apply to save.")
            return 0
        apply(conn, conversions, date.today().isoformat())
    print("\nSaved.")
    return 0


def cmd_profiles(args: argparse.Namespace) -> int:
    import psycopg

    from .crawl import make_client
    from .profiles import Search, apply, find, summarise

    def progress(step: str, done: int, total: int) -> None:
        print(f"\r{step}: {done} of {total}   ", end="", file=sys.stderr, flush=True)

    # Asked for before anything is fetched, so a missing key is known at once.
    key = config.search_api_key() if args.search else None
    with psycopg.connect(config.database_url()) as conn:
        if args.web or args.search:
            with make_client() as client:
                engines = ("google", "duckduckgo") if args.engine == "both" else (args.engine,)
                search = Search(client, key, config.profile_search_cache(), engines, args.limit) if key else None
                people, stopped = find(conn, client if args.web else None, search, progress)
            print(file=sys.stderr)
            if search:
                print(f"{search.asked} search request(s) made; the rest were answered from earlier runs.")
        else:
            people, stopped = find(conn)
        print(summarise(people))
        if stopped:
            print(f"\n{stopped}", file=sys.stderr)
        if not args.apply:
            print("\nDry run: nothing was written to the database. Add --apply to save.")
            return 0
        print(f"\nSaved {apply(conn, people)} profile link(s).")
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

    load = commands.add_parser("import-orgs", help="load a researched organisations CSV (dry run unless --apply)")
    load.add_argument("dataset")
    load.add_argument("--apply", action="store_true", help="write to the database")
    load.add_argument("--mapping", help="JSON file mapping field names to this dataset's column headings")
    load.add_argument("--publish-all", action="store_true", help="for a vetted dataset with no verification column: publish every row")
    load.add_argument("--replace-sample", action="store_true", help="also remove the synthetic sample records")
    load.add_argument("--snapshot", default=date.today().isoformat(), help="date the research was done (YYYY-MM-DD)")
    load.add_argument("--report", default=str(config.REPO_ROOT / "data" / "import-report.md"))
    load.set_defaults(run=cmd_import)

    funding = commands.add_parser("import-rounds", help="load hand-curated funding rounds (dry run unless --apply)")
    funding.add_argument("file")
    funding.add_argument("--apply", action="store_true", help="write to the database")
    funding.set_defaults(run=cmd_rounds)

    places = commands.add_parser("import-locations", help="place organisations that have no office at a city (dry run unless --apply)")
    places.add_argument("file")
    places.add_argument("--apply", action="store_true", help="write to the database")
    places.set_defaults(run=cmd_locations)

    ties = commands.add_parser("import-links", help="load relationships between organisations from a CSV (dry run unless --apply)")
    ties.add_argument("file")
    ties.add_argument("--apply", action="store_true", help="write to the database")
    ties.add_argument("--snapshot", default=date.today().isoformat(), help="date the research was done (YYYY-MM-DD)")
    ties.set_defaults(run=cmd_links)

    convert = commands.add_parser("convert-rounds", help="give rounds in other currencies a US dollar amount (dry run unless --apply)")
    convert.add_argument("--apply", action="store_true", help="write to the database")
    convert.set_defaults(run=cmd_convert)

    profiles = commands.add_parser("find-profiles", help="find people's LinkedIn profile links without visiting LinkedIn (dry run unless --apply)")
    profiles.add_argument("--web", action="store_true", help="also read each organisation's own website for links to its people's profiles")
    profiles.add_argument("--search", action="store_true", help="also ask a web search service for those still not found (needs SERPAPI_API_KEY)")
    profiles.add_argument("--engine", choices=["google", "duckduckgo", "both"], default="both", help="which engine SerpAPI asks; both tries DuckDuckGo for anyone Google did not find")
    profiles.add_argument("--limit", type=int, default=240, help="the most search requests to make in one run (the free plan allows 250 a month)")
    profiles.add_argument("--apply", action="store_true", help="write to the database")
    profiles.set_defaults(run=cmd_profiles)

    args = parser.parse_args()
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
