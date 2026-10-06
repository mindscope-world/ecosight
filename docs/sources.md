# Crawled sources

One row per source the pipeline reads, with what its robots.txt and terms allow.
Check a source again before changing how it is crawled. Nothing from these
sources is republished: the text is stored privately for extraction, and the map
shows only extracted facts with a link back to the article.

| Source | What is fetched | robots.txt (checked Oct 6, 2026) | Rate | Notes |
|--------|-----------------|----------------------------------|------|-------|
| TechCabal | RSS feed, `https://techcabal.com/feed/` | No robots.txt (404), so no restriction stated | One feed request per run | Terms of use not yet read by a person |
| Disrupt Africa | RSS feed, `https://disruptafrica.com/feed/` | `Disallow:` empty, everything allowed | One feed request per run | Terms of use not yet read by a person |

Rules the crawler follows for every source:

- It reads the RSS feed only and does not request article pages.
- It checks robots.txt on every run and skips the source if the feed is disallowed
  or robots.txt returns a server error.
- It identifies itself with the `CRAWLER_USER_AGENT` setting. Set this to a string
  with a working contact address before running on a schedule.
- It waits 5 seconds between the robots.txt request and the feed request.

Considered and left out: Techpoint Africa (its feed returned 403 to the crawler's
user agent, and robots.txt asks for a 10 second crawl delay).

Open: a person needs to read each publisher's terms of use and record the result
here before the crawler runs daily (risk R6 in `plan.md`).
