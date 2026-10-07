import httpx
import pytest

from atlas_workers.profiles import Person, Search, SearchStopped, assign, mentions, belongs_to, name_words, page_links, people_pages, profile_url, site_profiles


def test_only_personal_profiles_are_profile_addresses():
    assert profile_url("https://ke.linkedin.com/in/Jane-Doe-4a1b2c/?originalSubdomain=ke") == "https://www.linkedin.com/in/jane-doe-4a1b2c"
    assert profile_url("http://linkedin.com/in/jane%2Ddoe") == "https://www.linkedin.com/in/jane-doe"
    assert profile_url("https://www.linkedin.com/in/janedoe;") == "https://www.linkedin.com/in/janedoe"
    assert profile_url("https://www.linkedin.com/company/sample-pay/") is None
    assert profile_url("https://www.linkedin.com/posts/jane-doe_activity-1") is None
    assert profile_url("https://example.org/in/jane-doe") is None


def test_a_profile_must_carry_the_first_and_last_name():
    assert name_words("Dr. Jané O. Doe, PhD") == ["jane", "doe"]
    assert belongs_to("https://www.linkedin.com/in/jane-doe-4a1b2c", "Jane Doe")
    assert belongs_to("https://www.linkedin.com/in/doe-jane", "Dr Jane Doe")
    assert belongs_to("https://www.linkedin.com/in/janedoe1", "Jane Doe")
    assert belongs_to("https://www.linkedin.com/in/jane-mary-doe", "Jane Doe")
    # An initial, another surname, or one name alone is not enough.
    assert not belongs_to("https://www.linkedin.com/in/jdoe", "Jane Doe")
    assert not belongs_to("https://www.linkedin.com/in/jane-smith", "Jane Doe")
    assert not belongs_to("https://www.linkedin.com/in/jane", "Jane")
    assert not belongs_to("https://www.linkedin.com/in/janedoering", "Jane Doering Smith")


def person(name, org="o1", id=None):
    return Person(id=id or name, name=name, organisation="Sample Pay", organisation_id=org, domain=None, current=None)


def test_a_profile_is_given_only_when_it_is_the_one_match():
    jane, john, ann, sam = person("Jane Doe"), person("John Roe"), person("Ann Lee"), person("Sam Poe", "o2")
    twin_a, twin_b = person("Kim Tan", "o3", "a"), person("Kim Tan", "o3", "b")
    offered = {
        "o1": {
            "https://www.linkedin.com/in/jane-doe-1": "https://samplepay.example/team",
            "https://www.linkedin.com/in/ann-lee": "page",
            "https://www.linkedin.com/in/ann-lee-2": "page",
            "https://www.linkedin.com/in/someone-else": "page",
        },
        # Another organisation's links are never tried against this one's people.
        "o2": {"https://www.linkedin.com/in/john-roe": "page"},
        "o3": {"https://www.linkedin.com/in/kim-tan": "page"},
    }
    assign([jane, john, ann, sam, twin_a, twin_b], offered)
    assert (jane.profile, jane.source) == ("https://www.linkedin.com/in/jane-doe-1", "https://samplepay.example/team")
    assert john.profile is None and john.note is None
    assert ann.profile is None and "2 profiles" in ann.note
    assert sam.profile is None
    assert twin_a.profile is None and "more than one person" in twin_a.note


HOME = """<a href="/about-us">About</a> <a href="/blog/our-team-grows">Post</a> <a href="https://other.example/team">Other</a>
<a href="/brochure-about.pdf">PDF</a> <a href="https://www.linkedin.com/company/samplepay">Company</a>"""
ABOUT = """<a href="https://ke.linkedin.com/in/jane-doe-1/">Jane</a> <a href="https://twitter.com/jane">x</a>"""


def test_people_pages_are_on_the_same_site_and_look_like_pages_about_people():
    links = page_links(HOME, "https://samplepay.example/")
    assert people_pages(links, "https://samplepay.example/") == [
        "https://samplepay.example/about-us",
        "https://samplepay.example/blog/our-team-grows",
    ]


def test_a_site_is_read_within_its_robots_rules_and_linkedin_is_never_asked():
    asked = []

    def answer(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        assert "linkedin.com" not in request.url.host
        pages = {
            "/robots.txt": httpx.Response(200, text="User-agent: *\nDisallow: /blog/\n"),
            "/": httpx.Response(200, text=HOME, headers={"content-type": "text/html"}),
            "/about-us": httpx.Response(200, text=ABOUT, headers={"content-type": "text/html; charset=utf-8"}),
        }
        return pages.get(request.url.path, httpx.Response(404))

    with httpx.Client(transport=httpx.MockTransport(answer)) as client:
        found = site_profiles(client, "samplepay.example", pause=0)
    assert found == {"https://www.linkedin.com/in/jane-doe-1": "https://samplepay.example/about-us"}
    assert "https://samplepay.example/blog/our-team-grows" not in asked

    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    with httpx.Client(transport=httpx.MockTransport(broken)) as client:
        assert site_profiles(client, "down.example", pause=0) == {}


def test_a_result_must_name_the_organisation():
    assert mentions("Jane Doe - Co-Founder - Sample Pay | LinkedIn", ["Sample Pay Limited"])
    assert mentions("Founder at SamplePay", ["Sample Pay"])
    assert mentions("CEO, Orbit Health", ["eHealth IT Services PLC", "Orbit Health"])
    assert not mentions("Jane Doe - Nurse - City Hospital | LinkedIn", ["Sample Pay"])
    # The name must stand as words of its own.
    assert mentions("Founder, REMA", ["REMA"])
    assert not mentions("Remarkable results", ["REMA"])
    assert not mentions("A copy editor", ["Co"])


RESULTS = {
    "organic_results": [
        {"link": "https://ke.linkedin.com/in/jane-doe-1", "title": "Jane Doe - Co-Founder - Sample Pay | LinkedIn", "snippet": "Nairobi"},
        # The same name at another employer: a namesake.
        {"link": "https://www.linkedin.com/in/jane-doe-nurse", "title": "Jane Doe - Nurse | LinkedIn", "snippet": "City Hospital"},
        # The organisation is named, but the profile is someone else's.
        {"link": "https://www.linkedin.com/in/john-roe", "title": "John Roe - COO - Sample Pay", "snippet": ""},
        {"link": "https://www.linkedin.com/company/sample-pay", "title": "Sample Pay | LinkedIn", "snippet": "Jane Doe"},
    ]
}
NOTHING = {"error": "Google hasn't returned any results for this query."}
JSON = {"content-type": "application/json"}


def test_search_keeps_the_profile_that_fits_the_name_and_the_organisation(tmp_path):
    asked = []

    def answer(request: httpx.Request) -> httpx.Response:
        asked.append(request)
        assert request.url.host == "serpapi.com"
        return httpx.Response(200, json=RESULTS)

    cache = tmp_path / "search.json"
    with httpx.Client(transport=httpx.MockTransport(answer)) as client:
        search = Search(client, "key-123", cache, pause=0)
        found = search.profiles("Jane Doe", ["Sample Pay", "SamplePay Ltd"])
        assert list(found) == ["https://www.linkedin.com/in/jane-doe-1"]
        assert found["https://www.linkedin.com/in/jane-doe-1"].startswith("https://www.google.com/search?q=%22Jane+Doe%22")
        assert dict(asked[0].url.params) == {"engine": "google", "q": '"Jane Doe" "Sample Pay" site:linkedin.com/in', "api_key": "key-123"}
        # Found by the first engine, so the second is not asked; and the answer is kept, here and for the next run.
        search.profiles("Jane Doe", ["Sample Pay"])
        assert (len(asked), search.asked) == (1, 1)
        assert Search(client, "key-123", cache, pause=0).profiles("Jane Doe", ["Sample Pay"]) == found
        assert len(asked) == 1


def test_the_second_engine_is_asked_only_for_those_the_first_did_not_find(tmp_path):
    engines = []

    def answer(request: httpx.Request) -> httpx.Response:
        engine = request.url.params["engine"]
        engines.append(engine)
        # Finding nothing is an answer, not a failure.
        return httpx.Response(200, json=RESULTS) if engine == "duckduckgo" else httpx.Response(400, json=NOTHING)

    with httpx.Client(transport=httpx.MockTransport(answer)) as client:
        found = Search(client, "key", tmp_path / "search.json", pause=0).profiles("Jane Doe", ["Sample Pay"])
    assert engines == ["google", "duckduckgo"]
    assert found == {"https://www.linkedin.com/in/jane-doe-1": "https://duckduckgo.com/?q=%22Jane+Doe%22+%22Sample+Pay%22+site%3Alinkedin.com%2Fin"}


def test_search_stops_when_the_service_refuses_or_the_limit_is_reached(tmp_path):
    refused = httpx.Response(429, json={"error": "Your account has run out of searches."})
    with httpx.Client(transport=httpx.MockTransport(lambda request: refused)) as client:
        search = Search(client, "key", tmp_path / "search.json", pause=0)
        with pytest.raises(SearchStopped, match="429: Your account has run out of searches"):
            search.profiles("Jane Doe", ["Sample Pay"])

    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(400, json=NOTHING))) as client:
        search = Search(client, "key", tmp_path / "other.json", engines=("google",), limit=2, pause=0)
        search.profiles("Jane Doe", ["Sample Pay"])
        search.profiles("John Roe", ["Sample Pay"])
        with pytest.raises(SearchStopped, match="limit of 2 requests"):
            search.profiles("Ann Lee", ["Sample Pay"])
        # What was already answered costs nothing more.
        assert search.profiles("Jane Doe", ["Sample Pay"]) == {} and search.asked == 2
