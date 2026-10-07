import json

import httpx
import pytest

from atlas_workers.geocode import Geocoder, classify, in_nairobi
from atlas_workers.importer import (
    address_parts,
    find_address,
    clean_address,
    display_name,
    locate,
    parse_row,
    read_people,
    read_sectors,
    read_stage,
    read_website,
)

ROW = {
    "Record #": "7",
    "Startup / organisation": "Sample Pay (Sample Pay Limited)",
    "Verification status": "verified",
    "Industry": "Fintech: SME payments and lending for agricultural traders.",
    "Nairobi basis": "Official contact page lists its location as Lavington, Nairobi, Kenya.",
    "Exact public building / premise": "Sample House, 2nd Floor, Sample Road, Westlands, Nairobi, Kenya",
    "Location verification": "exact_public_address_verified",
    "Location source URL": "https://example.org/contact",
    "Funding level / status": "Seed (latest disclosed round found)",
    "Funding details": "A source reported a seed round in 2022.",
    "Funding source URL": "",
    "Founders and public roles": "Jane Doe — Co-Founder and CEO; John Roe — COO.",
    "Founder source URL": "https://example.org/about",
    "Official website": "https://www.example.org/",
    "Identity / Nairobi source URL": "https://example.org/",
}


def test_display_name_drops_bracketed_notes():
    assert display_name("Acme (Acme Advisors)") == "Acme"
    assert display_name("Sample Loans / SAMPLE (Sample Labs Limited, trading as SAMPLE)") == "Sample Loans / SAMPLE"
    assert display_name("Borealis") == "Borealis"


def test_sectors_follow_the_order_of_mention():
    assert read_sectors("Agricultural insurance and insurtech; climate-risk data for farmers.") == ["agritech", "insurtech", "cleantech"]
    assert read_sectors("Fintech") == ["fintech"]
    assert read_sectors("Not independently verified") == []


@pytest.mark.parametrize(
    "status, stage",
    [
        ("Series B", "series-b"),
        ("Pre-Series A (equity-debt round; latest reliable disclosed round identified).", "pre-series-a"),
        ("Pre-seed (undisclosed amount)", "pre-seed"),
        ("Seed; subsequent undisclosed strategic backing reported", "seed"),
        ("Senior debt facility (latest dated disclosure found)", "debt"),
        ("Bootstrapped; no disclosed external funding round found", "bootstrapped"),
        ("Seed prize (2023); no later closed round reliably disclosed.", "grant"),
        ("Grant (Sample Foundation seed funding)", "grant"),
        # Statuses that mention a stage only in passing must not be read as that stage.
        ("Undisclosed investment (reported early-stage round); prior Series A", None),
        ("No reliable disclosure found", None),
        ("Latest identified investment: undisclosed investment by an angel group", None),
        ("DFI equity investment (2024); previously undisclosed seed round (2022).", None),
    ],
)
def test_stage_is_read_only_from_the_opening_words(status, stage):
    assert read_stage(status) == stage


def test_website_takes_the_first_url_and_flags_notes():
    assert read_website("https://www.pula-advisors.com/") == ("https://www.pula-advisors.com/", "pula-advisors.com", False)
    url, domain, noted = read_website("https://www.chpter.co (former company domain; now parked).")
    assert (url, domain, noted) == ("https://www.chpter.co", "chpter.co", True)
    assert read_website("") == (None, None, False)


def test_people_are_loaded_only_when_named_as_founders():
    assert read_people("Alice Example — Co-Founder and President; Brian Example — Co-Founder and CEO.") == [
        ("Alice Example", "Co-Founder and President"),
        ("Brian Example", "Co-Founder and CEO"),
    ]
    assert read_people("Carol Example (co-founder and CEO); Dan da Sample (co-founder).") == [
        ("Carol Example", "co-founder and CEO"),
        ("Dan da Sample", "co-founder"),
    ]
    # A named officer who is not called a founder is left out.
    assert read_people("Ivan Example is publicly identified in a LinkedIn profile as Sample Voices COO.") == []
    assert read_people("Jane Doe — COO.") == []
    assert read_people("No founders reliably identified.") == []


def test_address_parts_keep_what_a_map_can_find():
    assert address_parts("Kalamu House, 2nd Floor, Brookside Drive, Westlands, Nairobi, Kenya") == [
        "Kalamu House", "Brookside Drive", "Westlands",
    ]
    assert address_parts("Unicity Mall, next to Kenyatta University Main Campus, along Thika Road, Nairobi, Kenya")[-1] == "Thika Road"
    assert address_parts("Samplepay parent office: Westpark Towers, Mpesi Lane, Westlands, Nairobi, Kenya. No separate premises.")[0] == "Westpark Towers"
    assert clean_address("Bush House, Kabarnet Road, off Ngong Road, Nairobi (official website).") == "Bush House, Kabarnet Road, off Ngong Road, Nairobi"
    assert clean_address("No. 19 Kanjata Road, Muthangari Drive, Nairobi, Kenya") == "No. 19 Kanjata Road, Muthangari Drive, Nairobi, Kenya"
    assert clean_address("Velka Business Park, Athi River (main office; not Nairobi).") == "Velka Business Park, Athi River"
    # Floors and unit numbers are dropped from a part; the building named beside them is kept.
    assert address_parts("7th floor Rainbow Towers, Muthithi Road, Westlands, Nairobi, Kenya") == ["Rainbow Towers", "Muthithi Road", "Westlands"]
    assert address_parts("Sifa Towers, 2nd Floor, Office 2A, Lenana Road, Kilimani, Nairobi, Kenya") == ["Sifa Towers", "Lenana Road", "Kilimani"]
    assert address_parts("Sultan Office Suite, Ngong View, Karen, Nairobi, Kenya")[0] == "Sultan Office Suite"
    assert address_parts("Manga House – Ground Floor, Right Wing, 9 Kiambere Rd, Upper Hill, Nairobi, Kenya") == ["Manga House", "Kiambere Road", "Upper Hill"]
    assert address_parts("Godown 9, Radheshyam Godowns, Off-Outering Road, Donholm 00501, Nairobi, Kenya") == ["Radheshyam Godowns", "Outering Road", "Donholm"]


def test_row_is_parsed_into_a_record():
    record = parse_row(ROW)
    assert (record.number, record.name, record.slug, record.publish) == (7, "Sample Pay", "sample-pay", True)
    assert record.sectors == ["fintech", "agritech"]
    assert record.stage == "seed"
    assert record.domain == "example.org"
    assert record.people == [("Jane Doe", "Co-Founder and CEO")]
    assert record.area == "Lavington"
    assert record.sources == {
        "name": "https://example.org/",
        "office": "https://example.org/contact",
        "people": "https://example.org/about",
        "website": "https://www.example.org/",
    }
    assert record.notes == []
    assert not parse_row({**ROW, "Verification status": "not_verified"}).publish


def geocoder(tmp_path, answers: dict[str, list]) -> Geocoder:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=answers.get(request.url.params["q"], []))

    return Geocoder(tmp_path / "cache.json", httpx.Client(transport=httpx.MockTransport(handler)), delay=0)


BUILDING = {"lon": "36.80", "lat": "-1.26", "category": "building", "type": "office", "display_name": "Sample House"}
SUBURB = {"lon": "36.81", "lat": "-1.27", "category": "place", "type": "suburb", "display_name": "Westlands, Lavington, Nairobi"}


def place(name: str, category: str = "building") -> dict:
    return {"lon": "36.80", "lat": "-1.26", "category": category, "type": "x", "display_name": name}


def test_locate_keeps_a_building_match_that_carries_the_address_and_caches(tmp_path):
    geo = geocoder(tmp_path, {"Sample House, Nairobi": [place("Sample House, Sample Road, Westlands, Nairobi")]})
    record = parse_row(ROW)
    locate(record, geo)
    assert (record.precision, record.place.matched) == ("address", "Sample House, Sample Road, Westlands, Nairobi")
    assert record.address == "Sample House, 2nd Floor, Sample Road, Westlands, Nairobi, Kenya"
    assert geo.requests == 2  # the whole address missed, the building name hit

    again = parse_row(ROW)
    locate(again, geo)
    assert geo.requests == 2  # both answers, including the miss, came from the cache
    assert json.loads((tmp_path / "cache.json").read_text())["Sample House, Sample Road, Westlands, Nairobi"] is None


def test_lookalike_buildings_are_refused(tmp_path):
    # A different place whose name merely shares words with the building.
    lookalike = geocoder(tmp_path / "a", {
        "Nairobi Garage, Nairobi": [place("Motor Scope Auto Garage, Karen Road, Nairobi")],
        "Kaburu Drive, Nairobi": [place("Kaburu Drive, Kilimani, Nairobi", "highway")],
    })
    found = find_address("Nairobi Garage, Kaburu Drive, Nairobi, Kenya", lookalike)
    assert found and (found[1], found[0].matched) == ("area", "Kaburu Drive, Kilimani, Nairobi")

    # The right name in the wrong part of town: nothing else in the address agrees.
    elsewhere = geocoder(tmp_path / "b", {"Bush House, Nairobi": [place("Bush House & Camp, Karen, Nairobi")]})
    assert find_address("Bush House, Kabarnet Road, off Ngong Road, Nairobi", elsewhere) is None

    # A street query answered with something that is not that street.
    wrong_street = geocoder(tmp_path / "c", {
        "Hospital Road, Nairobi": [place("Nairobi Hospital, Argwings Kodhek Road")],
        "Upper Hill, Nairobi": [place("Upper Hill, Nairobi", "place")],
    })
    found = find_address("Britam Towers, Hospital Road, Upper Hill, Nairobi, Kenya", wrong_street)
    assert found and found[0].matched == "Upper Hill, Nairobi"


def test_streets_are_not_taken_for_buildings_and_arterials_are_skipped(tmp_path):
    # "Ngong View" is not a building just because a road is called "Ngong View Rise".
    road = geocoder(tmp_path / "a", {
        "Ngong View, Nairobi": [place("Ngong View Rise, Karen, Nairobi", "highway")],
        "Karen, Nairobi": [place("Karen, Langata, Nairobi", "place")],
    })
    found = find_address("Ngong View, Karen, Nairobi, Kenya", road)
    assert found and (found[1], found[0].matched) == ("area", "Karen, Langata, Nairobi")

    # A point somewhere on a 15 km road is not a location.
    arterial = geocoder(tmp_path / "b", {"Ngong Road, Nairobi": [place("Ngong Road, Karen, Nairobi", "highway")]})
    assert find_address("Nairobi Garage, Ngong Road, Nairobi, Kenya", arterial) is None
    assert arterial.requests == 2  # only the building was looked up

    # The street is searched with its area first.
    ring = geocoder(tmp_path / "c", {
        "Ring Road, Westlands, Nairobi": [place("Ring Road, Parklands, Westlands, Nairobi", "highway")],
        "Ring Road, Nairobi": [place("Ring Road, Kariokor, Nairobi", "highway")],
    })
    found = find_address("KOFISI 9 West, Ring Road, Westlands, Nairobi, Kenya", ring)
    assert found and found[0].matched.startswith("Ring Road, Parklands")


def test_numbered_street_addresses_are_placed_on_the_street(tmp_path):
    geo = geocoder(tmp_path, {"Mandera Road, Nairobi": [place("Mandera Road, Kileleshwa, Nairobi", "highway")]})
    found = find_address("304 Mandera Road, Kileleshwa, Nairobi, Kenya", geo)
    assert found and found[1] == "area"
    assert geo.requests == 2  # with its area first, then alone


def test_locate_falls_back_to_area_then_city(tmp_path):
    street_only = parse_row(ROW)
    locate(street_only, geocoder(tmp_path / "a", {"Westlands, Nairobi": [SUBURB]}))
    assert street_only.precision == "area"
    assert "placed on its street or area" in street_only.notes[0]

    area_row = {**ROW, "Exact public building / premise": "Not publicly verified", "Location verification": "only_area_or_city_verified"}
    by_area = parse_row(area_row)
    locate(by_area, geocoder(tmp_path / "b", {"Lavington, Nairobi": [SUBURB]}))
    assert (by_area.precision, by_area.address) == ("area", "Lavington")

    nothing = parse_row(ROW)
    locate(nothing, geocoder(tmp_path / "c", {}))
    assert (nothing.precision, nothing.place) == ("city", None)

    unlocated_draft = parse_row({**area_row, "Verification status": "not_verified", "Location verification": "not_publicly_verified"})
    locate(unlocated_draft, geocoder(tmp_path / "d", {}))
    assert unlocated_draft.precision is None


def test_matches_outside_nairobi_are_refused(tmp_path):
    mombasa = {**BUILDING, "lon": "39.66", "lat": "-4.04"}
    assert geocoder(tmp_path, {"x": [mombasa]}).lookup("x") is None
    assert in_nairobi(36.82, -1.29) and not in_nairobi(39.66, -4.04)
    assert classify("highway", "residential") == "area"
    assert classify("place", "house") == "address"
    assert classify("office", "company") == "address"


def test_types_are_read_from_a_type_column():
    from atlas_workers.importer import read_types

    assert read_types("Investor; Accelerator") == (["fund", "accelerator"], [])
    assert read_types("Startups") == (["startup"], [])
    assert read_types("VC / innovation hub") == (["fund", "innovation_hub"], [])
    assert read_types("Bank") == ([], ["bank"])
    assert read_types("") == ([], [])

    record = parse_row({**ROW, "Type": "Investor, Bank"})
    assert record.types == ["fund"]
    assert "type not recognised: bank" in record.notes
    assert parse_row(ROW).types == ["startup"]


def test_a_dataset_with_other_headings_is_read_through_a_mapping(tmp_path):
    from atlas_workers.importer import read_dataset

    path = tmp_path / "other.csv"
    path.write_text(
        "Company,Kind,Year,Lat,Lng,Site\n"
        "Sample Hub,Innovation hub,2019,-1.26,36.80,https://hub.example.org\n"
        "Far Away Ltd,Startup,nineteen,-4.04,39.66,\n"
    )
    columns = {"name": "Company", "type": "Kind", "founded_year": "Year", "latitude": "Lat", "longitude": "Lng", "website": "Site"}

    drafts = read_dataset(path, columns)
    assert [record.publish for record in drafts] == [False, False]  # no verification column

    hub, far = read_dataset(path, columns, publish_all=True)
    assert (hub.name, hub.types, hub.founded_year, hub.publish, hub.number) == ("Sample Hub", ["innovation_hub"], 2019, True, 1)
    locate(hub, geocoder(tmp_path, {}))
    assert (hub.precision, hub.place.lon, hub.place.lat) == ("address", 36.80, -1.26)
    assert "founded year not read: 'nineteen'" in far.notes
    assert "coordinates are outside Nairobi; not used" in far.notes

    with pytest.raises(ValueError, match="missing columns: Startup / organisation"):
        read_dataset(path)


def test_records_outside_nairobi_are_placed_at_their_city(tmp_path):
    lagos = {"lon": "3.39", "lat": "6.45", "category": "place", "type": "city", "display_name": "Lagos, Lagos Island, Nigeria"}
    geo = geocoder(tmp_path, {"Lagos": [lagos], "Sample House, Nairobi": [BUILDING]})

    record = parse_row({**ROW, "City": "Lagos", "Country": "ng"})
    locate(record, geo)
    assert (record.city, record.country, record.precision) == ("Lagos", "NG", "city")
    assert (record.city_centre.lon, record.place) == (3.39, None)  # the Nairobi address lookup is not attempted

    # Coordinates given by the dataset are used as they are.
    exact = parse_row({**ROW, "City": "Lagos", "Country": "NG", "Latitude": "6.43", "Longitude": "3.42"})
    locate(exact, geo)
    assert (exact.precision, exact.place.lon) == ("address", 3.42)

    # A city the geocoder cannot find, or finds as something else, gets no office.
    lost = parse_row({**ROW, "City": "Atlantis", "Country": "GR"})
    locate(lost, geocoder(tmp_path / "b", {"Atlantis": [{**lagos, "display_name": "Atlantic Hotel, Athens"}]}))
    assert lost.precision is None and "city not found: Atlantis, GR" in lost.notes[-1]

    bad = parse_row({**ROW, "City": "Lagos", "Country": "Nigeria"})
    locate(bad, geo)
    assert bad.precision is None and "country must be a two-letter code" in bad.notes[0]


def test_cleaning_services_are_not_clean_technology():
    assert read_sectors("Technology-enabled domestic cleaning services") == []
    assert read_sectors("Clean cooking / energy hardware") == ["cleantech"]
    assert read_sectors("Clean technology; environmental services") == ["cleantech"]


def test_descriptive_categories_are_read_as_types():
    from atlas_workers.importer import read_types

    assert read_types("VC / impact investor") == (["fund"], [])
    assert read_types("Impact investor (family-backed impact fund)") == (["fund"], [])
    assert read_types("VC (seed fund and accelerator)") == (["fund", "accelerator"], [])
    assert read_types("Venture capital / angel-network manager / accelerator") == (["fund", "angel_network", "accelerator"], [])
    assert read_types("innovation hub and accelerator") == (["innovation_hub", "accelerator"], [])
    assert read_types("Climate innovation accelerator and incubator") == (["accelerator", "incubator"], [])
    assert read_types("venture capital / venture studio / accelerator") == (["fund", "accelerator"], [])
    assert read_types("Accelerator / entrepreneur support organization") == (["accelerator"], [])
    assert read_types("Law firm") == ([], ["law firm"])


def test_sources_cell_and_own_site():
    from atlas_workers.importer import own_site, read_sources

    cell = "Listing — https://www.linkedin.com/company/sample || Sample Capital: Home — https://www.samplecapital.com/team/ || Again — https://www.samplecapital.com/team/"
    urls = read_sources(cell)
    assert urls == ["https://www.linkedin.com/company/sample", "https://www.samplecapital.com/team/"]
    assert own_site("Sample Capital", urls) == ("https://samplecapital.com/", "samplecapital.com")
    assert own_site("Other Fund", urls) == (None, None)
    # A word as common as "Africa" does not identify a site.
    assert own_site("Sample Africa", ["https://elsewhere.africa/"]) == (None, None)


def test_an_investor_row_under_other_headings():
    columns = {"name": "name", "type": "category", "premise": "exact_location", "funding_status": "funding_size",
               "founders": "key_people", "sources": "sources", "confidence": "confidence"}
    record = parse_row({
        "name": "Sample Capital", "category": "VC (seed fund and accelerator)",
        "exact_location": "Not publicly disclosed; the official website publishes only a London address",
        "funding_size": "US$58 million across two seed funds", "confidence": "Medium",
        "key_people": "Jane Doe — Co-founder & Managing Partner | John Roe — Partner, Nairobi",
        "sources": "Home — https://www.samplecapital.com/",
    }, {**__import__("atlas_workers.importer", fromlist=["DEFAULT_COLUMNS"]).DEFAULT_COLUMNS, **columns}, publish_all=True)
    assert record.types == ["fund", "accelerator"]
    assert record.premise is None  # "Not publicly disclosed" is not an address
    assert record.stage is None  # "seed funds" describes the fund, not a round it raised
    assert record.people == [("Jane Doe", "Co-founder & Managing Partner")]
    assert (record.domain, record.confidence, record.publish) == ("samplecapital.com", 0.6, True)
    assert clean_address("3rd Floor, Bishop Magua Center, Ngong Road, Nairobi — third-party LinkedIn listing; unconfirmed") == "3rd Floor, Bishop Magua Center, Ngong Road, Nairobi"


def test_people_in_a_bar_separated_cell():
    cell = (
        "Eve Example — Founder and CEO (named on the official about page; co-founder confirmed elsewhere) | "
        "Faith Example — former CEO | Grace Example — Co-Founder & Managing Director, Sample Africa; co-founder of Another. | "
        "Henry Example — Co-founder, Sample Africa"
    )
    assert [name for name, _ in read_people(cell)] == ["Eve Example", "Grace Example", "Henry Example"]


def test_a_street_with_a_direction_is_not_a_building(tmp_path):
    geo = geocoder(tmp_path, {
        "Mokoyeti Road West, Langata Road, Nairobi": [place("Wildebeest Eco Camp, Mokoyeti Rd W, Nairobi, Mokoyeti Road West, Karen")],
        "Mokoyeti Road West, Nairobi": [place("Mokoyeti Road West, Karen, Nairobi", "highway")],
    })
    found = find_address("Mokoyeti Road West, Off Langata Road, Nairobi, Kenya", geo)
    assert found and found[1] == "area"

    # A building name that only appears deep in another place's address is not a match.
    deep = geocoder(tmp_path / "b", {"Sample Court, Nairobi": [place("Some Cafe, Unit 4, Sample Court, Sample Road, Nairobi")]})
    assert find_address("Sample Court, Sample Road, Nairobi", deep) is None


def test_statuses_and_aliases_come_from_the_mapping(tmp_path):
    from atlas_workers.importer import read_dataset

    path = tmp_path / "investors.csv"
    path.write_text("name\nSample Capital\nUnsure Partners\n")
    sure, unsure = read_dataset(
        path, {"name": "name"}, publish_all=True,
        aliases={"Sample Capital": ["Sample"]}, statuses={"Unsure Partners": "partially_verified"},
    )
    assert (sure.publish, sure.aliases) == (True, ["Sample"])
    assert (unsure.publish, unsure.status) == (False, "partially_verified")


KAMPALA = {"lon": "32.58", "lat": "0.32", "category": "place", "type": "city", "display_name": "Kampala, Central Region, Uganda"}


def kampala(name: str, category: str = "building", lon: str = "32.60") -> dict:
    return {"lon": lon, "lat": "0.33", "category": category, "type": "x", "display_name": name}


def test_addresses_are_looked_up_in_other_cities(tmp_path):
    geo = geocoder(
        tmp_path,
        {
            "Kampala": [KAMPALA],
            "Sample House, Kampala": [kampala("Sample House, Sample Street, Kololo, Kampala, Central Region, Uganda")],
        },
    )
    row = {**ROW, "Exact public building / premise": "4th Floor, Sample House, Plot 90, Sample Street, Kampala, Uganda"}
    record = parse_row({**row, "City": "Kampala", "Country": "UG"})
    locate(record, geo)
    assert (record.precision, record.place.lon, record.city_centre.lon) == ("address", 32.60, 32.58)
    assert record.address == "4th Floor, Sample House, Plot 90, Sample Street, Kampala, Uganda"

    # A result outside the city's surroundings is refused, and the record stays at the city's centre.
    far = geocoder(
        tmp_path / "far",
        {"Kampala": [KAMPALA], "Sample House, Kampala": [kampala("Sample House, Sample Street, Gulu", lon="34.00")]},
    )
    record = parse_row({**row, "City": "Kampala", "Country": "UG"})
    locate(record, far)
    assert (record.precision, record.place) == ("city", None)
    assert record.notes[-1] == "address not found on the map; placed at city level"


def test_a_region_or_country_in_an_address_is_not_a_place_to_match(tmp_path):
    # "Uganda" is in every result in Kampala; without the guard the first of them would be taken.
    anything = kampala("Some Cafe, Kampala, Central Region, Uganda", "amenity")
    geo = geocoder(tmp_path, {"Uganda, Kampala": [anything], "Republic of Uganda, Kampala": [anything]})
    box = (32.28, 0.02, 32.88, 0.62)
    wider = (" Central Region", " Uganda")
    assert find_address("Sample Close, Republic of Uganda", geo, "Kampala", box, "UG", wider) is None
    # The city ends the address, so the country after it is never looked up.
    assert find_address("Sample Close, Kampala, Uganda", geo, "Kampala", box, "UG") is None


def test_short_words_and_french_street_names(tmp_path):
    avenue = kampala("Avenue du Large, Kabondo, Bujumbura", "highway")
    geo = geocoder(tmp_path, {"Av, Bujumbura": [avenue], "Avenue de France, Bujumbura": [kampala("Avenue de France, Bujumbura", "highway")]})
    # "Av" would be found inside "Avenue du Large": too short to identify anything.
    assert find_address("Quartier Sample, Av", geo, "Bujumbura", (29, -4, 30, 3), "BI") is None
    # A street named the French way is a street, so the record is on it, not at an address.
    found = find_address("Avenue de France n°14, Bujumbura, Burundi", geo, "Bujumbura", (29, -4, 33, 3), "BI")
    assert found is None  # "Avenue de France n°14" is not the street's name as mapped
    found = find_address("Avenue de France, Bujumbura, Burundi", geo, "Bujumbura", (29, -4, 33, 3), "BI")
    assert found[1] == "area"
    assert clean_address("Quartier Sample, Av. du Cinquantenaire, No 6, Bujumbura") == "Quartier Sample, Av. du Cinquantenaire, No 6, Bujumbura"
    assert clean_address("Building/premise not publicly disclosed; Plot 6, Sample Road, Kampala") == "Plot 6, Sample Road, Kampala"


def test_an_institution_is_placed_where_the_map_names_it(tmp_path):
    campus = kampala("Sample University, Campus Road, Kampala, Central Region, Uganda", "amenity")
    answers = {"Kampala": [KAMPALA], "Sample University, Kampala": [campus], "Sample Pay, Kampala": [kampala("Sample Pay, Kampala", "shop")]}
    row = {**ROW, "Exact public building / premise": "Main Campus, Unmapped Hill, Kampala, Uganda", "City": "Kampala", "Country": "UG"}

    university = parse_row({**row, "Startup / organisation": "Sample University", "Type": "university"})
    locate(university, geocoder(tmp_path / "a", answers))
    assert (university.precision, university.place.lon) == ("address", 32.60)
    assert "placed where the map shows the institution itself" in university.notes[-1]

    # A company is not looked up by name: its name is too often also a shop's.
    company = parse_row(row)
    locate(company, geocoder(tmp_path / "b", answers))
    assert (company.precision, company.place) == ("city", None)

    # Nor is a result that only resembles the name.
    answers["Sample University, Kampala"] = [kampala("Sample University Hostel, Kampala", "amenity")]
    lookalike = parse_row({**row, "Startup / organisation": "Sample University", "Type": "university"})
    locate(lookalike, geocoder(tmp_path / "c", answers))
    assert lookalike.precision == "city"


def test_the_curator_can_set_values_for_one_row(tmp_path):
    from atlas_workers.importer import read_dataset

    path = tmp_path / "bodies.csv"
    path.write_text(
        "name,kind,industry,where\n"
        "Sample Agency (SA),State corporation under the Ministry,ICT policy and financing,Kampala\n"
        "Other Body,Statutory board,Research,Kampala\n"
    )
    columns = {"name": "name", "industry": "industry"}
    overrides = {
        "Sample Agency (SA)": {"type": "government", "city": "Kampala", "country": "UG", "sectors": "ict, policy", "status": "partially_verified"},
        "Other Body": {"name": "Other Body of Uganda", "type": "ngo"},
    }
    agency, other = read_dataset(path, columns, publish_all=True, overrides=overrides)
    assert (agency.types, agency.city, agency.country, agency.sectors) == (["government_program"], "Kampala", "UG", ["ict", "policy"])
    assert (agency.publish, other.publish) == (False, True)
    assert (other.name, other.types, other.city) == ("Other Body of Uganda", ["ngo"], "Nairobi")

    with pytest.raises(ValueError, match="names rows that are not in bodies.csv: Missing Body"):
        read_dataset(path, columns, overrides={"Missing Body": {"type": "ngo"}})


def test_sources_cited_by_id_are_read_from_a_register(tmp_path):
    from atlas_workers.importer import read_dataset, read_register

    listing = tmp_path / "sources.csv"
    listing.write_text(
        "Source ID,Organisation,URL\n"
        "001-S01,Sample Clinic,https://sampleclinic.example/\n"
        '001-S02,Sample Clinic,"https://news.example/a,b;c"\n'
        "001-S03,Sample Clinic,https://sampleclinic.example/contact\n"
        "001-S04,Sample Clinic,not found\n"
    )
    register = read_register(listing)
    assert "001-S04" not in register

    path = tmp_path / "clinics.csv"
    path.write_text(
        "name,all,where,money\n"
        "Sample Clinic,001-S01; 001-S02; 001-S03; 001-S09,001-S03; 001-S01,001-S02\n"
    )
    columns = {"name": "name", "sources": "all", "source_office": "where", "source_funding": "money"}
    (clinic,) = read_dataset(path, columns, publish_all=True, register=register)
    # A link is taken whole, punctuation and all.
    assert clinic.references == [
        "https://sampleclinic.example/",
        "https://news.example/a,b;c",
        "https://sampleclinic.example/contact",
    ]
    assert clinic.sources == {"office": "https://sampleclinic.example/contact", "funding": "https://news.example/a,b;c"}
    assert clinic.domain == "sampleclinic.example"
    assert "source not in the register: 001-S09" in clinic.notes

    with pytest.raises(ValueError, match="sources.csv is missing columns: Link"):
        read_register(listing, url_column="Link")
