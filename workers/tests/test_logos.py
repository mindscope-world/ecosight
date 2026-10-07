import httpx

from atlas_workers.logos import Logo, fetch_logo, icon_candidates, image_type

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 200
HOME = """<head>
<link rel="icon" href="/small.png" sizes="32x32">
<link rel="mask-icon" href="/mask.svg">
<link rel="icon" type="image/png" href="https://cdn.sample.example/big.png" sizes="192x192">
<link rel="apple-touch-icon" href="/touch.png">
<link rel="stylesheet" href="/site.css">
</head>"""


def test_the_home_screen_icon_comes_first_then_the_largest():
    assert icon_candidates(HOME, "https://samplepay.example/") == [
        "https://samplepay.example/touch.png",
        "https://cdn.sample.example/big.png",
        "https://samplepay.example/small.png",
        "https://samplepay.example/mask.svg",
        "https://samplepay.example/favicon.ico",
    ]
    assert icon_candidates("", "https://samplepay.example/about") == ["https://samplepay.example/favicon.ico"]


def test_an_image_is_known_by_its_bytes_not_by_what_the_site_calls_it():
    assert image_type(PNG) == "image/png"
    assert image_type(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert image_type(b"GIF89a...") == "image/gif"
    assert image_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert image_type(b"\x00\x00\x01\x00\x01\x00") == "image/x-icon"
    assert image_type(b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"></svg>") == "image/svg+xml"
    # A "not found" page served where the icon should be.
    assert image_type(b"<!doctype html><html><body>Not found</body></html>") is None


def site(pages):
    def answer(request: httpx.Request) -> httpx.Response:
        return pages.get(request.url.path, httpx.Response(404))

    return httpx.Client(transport=httpx.MockTransport(answer))


def test_a_logo_is_fetched_from_the_organisations_own_site():
    pages = {
        "/": httpx.Response(200, text=HOME, headers={"content-type": "text/html"}),
        "/touch.png": httpx.Response(200, content=PNG),
    }
    logo = Logo("o1", "Sample Pay", "samplepay.example")
    with site(pages) as client:
        fetch_logo(client, logo, pause=0)
    assert (logo.content_type, logo.image, logo.source_url) == ("image/png", PNG, "https://samplepay.example/touch.png")


def picture(side: int, noisy: bool = True) -> bytes:
    """A PNG of the given size. Noise does not compress, which makes a large file."""
    import io
    import os

    from PIL import Image

    image = Image.frombytes("RGBA", (side, side), os.urandom(side * side * 4)) if noisy else Image.new("RGBA", (side, side), (0, 120, 200, 128))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_an_image_too_large_to_keep_is_drawn_smaller():
    import io

    from PIL import Image

    from atlas_workers.logos import MAX_BYTES, shrink

    big = picture(400)
    assert len(big) > MAX_BYTES
    small = shrink(big)
    assert small is not None and len(small) <= MAX_BYTES and image_type(small) == "image/png"
    with Image.open(io.BytesIO(small)) as redrawn:
        assert max(redrawn.size) <= 256 and redrawn.mode == "RGBA"
    # A wide banner keeps its shape.
    wide = Image.new("RGB", (1200, 300), (10, 20, 30))
    out = io.BytesIO()
    wide.save(out, format="JPEG")
    with Image.open(io.BytesIO(shrink(out.getvalue()))) as redrawn:
        assert redrawn.size == (256, 64)
    assert shrink(b"\x89PNG\r\n\x1a\n" + b"0" * 70000) is None

    pages = {
        "/": httpx.Response(200, text='<link rel="apple-touch-icon" href="/touch.png">', headers={"content-type": "text/html"}),
        "/touch.png": httpx.Response(200, content=big),
    }
    logo = Logo("o1", "Sample Pay", "samplepay.example")
    with site(pages) as client:
        fetch_logo(client, logo, pause=0)
    assert logo.content_type == "image/png" and len(logo.image) <= MAX_BYTES and logo.source_url == "https://samplepay.example/touch.png"


def test_what_cannot_be_kept_is_left_out_with_the_reason():
    huge = {
        "/": httpx.Response(200, text='<link rel="apple-touch-icon" href="/touch.png">', headers={"content-type": "text/html"}),
        # Named a PNG and opening like one, but not a picture that can be redrawn.
        "/touch.png": httpx.Response(200, content=b"\x89PNG\r\n\x1a\n" + b"0" * 70000),
        "/favicon.ico": httpx.Response(200, text="<html>Not found</html>"),
    }
    logo = Logo("o1", "Sample Pay", "samplepay.example")
    with site(huge) as client:
        fetch_logo(client, logo, pause=0)
    assert logo.image is None and logo.note == "its icon is too large and could not be drawn smaller"

    closed = {"/robots.txt": httpx.Response(200, text="User-agent: *\nDisallow: /\n")}
    logo = Logo("o2", "Shut Site", "shut.example")
    with site(closed) as client:
        fetch_logo(client, logo, pause=0)
    assert logo.image is None and logo.note == "robots.txt does not allow it"

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    logo = Logo("o3", "Down Site", "down.example")
    with httpx.Client(transport=httpx.MockTransport(down)) as client:
        fetch_logo(client, logo, pause=0)
    assert logo.image is None and "could not be read" in logo.note
