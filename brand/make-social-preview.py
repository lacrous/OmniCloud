#!/usr/bin/env python3
"""Render the GitHub social preview for OmniCloud (1280x640).

Reproducible: run it and commit the output. It needs Pillow and the Noto
Sans fonts that ship with most Linux distributions.

    python3 brand/make-social-preview.py

The palette is the project's own: ink #17150f, gold #f3d789 -> #a8801a,
warm paper #faf9f5, muted #b7b0a0. The orbit mark is drawn from the same
geometry as brand/logo-mark.svg so the preview and the logo stay in step.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1280, 640
S = 4  # supersampling factor; the preview is drawn at 4x and scaled down

INK = (23, 21, 15)
PAPER = (250, 249, 245)
GOLD_LIGHT = (243, 215, 137)
GOLD = (226, 189, 82)
GOLD_DEEP = (168, 128, 26)
MUTED = (183, 176, 160)
DIM = (126, 119, 104)

FONT_DIR = "/usr/share/fonts/truetype/noto"
BRAND_OUT = Path(__file__).with_name("social-preview.png")
# GitHub looks for the social preview in .github/assets, so the same image is
# written to both places and they can never drift apart.
GITHUB_OUT = Path(__file__).resolve().parent.parent / ".github" / "assets" / "social-preview.png"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size * S)


def measure(draw, text, fnt, tracking=0.0) -> float:
    """Width of `text` when drawn with the same letter spacing as tracked()."""
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    return sum(widths) + tracking * S * (len(text) - 1)


def tracked(draw, xy, text, fnt, fill, tracking=0.0, anchor="ls"):
    """Draw text with letter spacing, which PIL does not support natively."""
    x, y = xy
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + tracking * S * (len(text) - 1)
    if anchor[0] == "m":
        x -= total / 2
    elif anchor[0] == "r":
        x -= total
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=fnt, fill=fill, anchor="l" + anchor[1])
        x += w + tracking * S
    return total


def gradient(size: tuple[int, int], start, end, box) -> Image.Image:
    """Linear gradient across `box` (x0, y0, x1, y1) inside a `size` image."""
    grad = Image.new("RGBA", size)
    px = grad.load()
    x0, y0, x1, y1 = box
    span_x = max(1.0, (x1 - x0))
    span_y = max(1.0, (y1 - y0))
    span = span_x + span_y
    for yy in range(y0, y1):
        for xx in range(x0, x1):
            t = ((xx - x0) / span_x + (yy - y0) / span_y) / 2.0
            t = min(1.0, max(0.0, t))
            px[xx, yy] = (
                int(start[0] + (end[0] - start[0]) * t),
                int(start[1] + (end[1] - start[1]) * t),
                int(start[2] + (end[2] - start[2]) * t),
                255,
            )
    return grad


def gradient_fast(size, start, end, box) -> Image.Image:
    """Same as gradient(), but one row at a time (the naive version is slow)."""
    grad = Image.new("RGBA", size)
    draw = ImageDraw.Draw(grad)
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    span_x = max(1.0, x1 - x0)
    span_y = max(1.0, y1 - y0)
    rows = y1 - y0
    for i in range(rows):
        t = (i / max(1, rows - 1)) / 2.0
        colour = (
            int(start[0] + (end[0] - start[0]) * t),
            int(start[1] + (end[1] - start[1]) * t),
            int(start[2] + (end[2] - start[2]) * t),
            255,
        )
        draw.line([(x0, y0 + i), (x1, y0 + i)], fill=colour)
    return grad


def draw_mark(size: int) -> Image.Image:
    """The orbit mark, drawn from the geometry in brand/logo-mark.svg."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = size / 64.0

    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=18 * k, fill=INK + (255,))

    # Everything gold in the mark is painted through one mask, so the whole
    # mark can share the one gradient the logo uses.
    mask = Image.new("L", (size, size), 0)
    m = ImageDraw.Draw(mask)

    def pt(x, y):
        return (x * k, y * k)

    spokes = [
        ((32, 32), (49, 19)),
        ((32, 32), (51, 35)),
        ((32, 32), (41, 51)),
        ((32, 32), (15, 45)),
        ((32, 32), (13, 29)),
        ((32, 32), (42, 13)),
    ]
    for a, b in spokes:
        m.line([pt(*a), pt(*b)], fill=224, width=max(1, int(2.4 * k)))

    # The two outer arcs: the lower one bulges down, the upper one bulges up.
    r = 18.8
    lower_c = (32, 20.7 - math.sqrt(r * r - 13.3 * 13.3))
    m.arc(
        [
            (lower_c[0] - r) * k,
            (lower_c[1] - r) * k,
            (lower_c[0] + r) * k,
            (lower_c[1] + r) * k,
        ],
        45,
        135,
        fill=107,
        width=max(1, int(2.4 * k)),
    )
    upper_c = (32, 43.3 + math.sqrt(r * r - 13.3 * 13.3))
    m.arc(
        [
            (upper_c[0] - r) * k,
            (upper_c[1] - r) * k,
            (upper_c[0] + r) * k,
            (upper_c[1] + r) * k,
        ],
        225,
        315,
        fill=107,
        width=max(1, int(2.4 * k)),
    )

    grad = gradient_fast((size, size), GOLD_LIGHT, GOLD_DEEP, (12 * k, 8 * k, 52 * k, 56 * k))
    img.paste(grad, (0, 0), mask)

    # The hub: an ink disc inside a gold ring, with a gold core.
    d.ellipse(
        [
            (32 - 8.5) * k,
            (32 - 8.5) * k,
            (32 + 8.5) * k,
            (32 + 8.5) * k,
        ],
        fill=INK + (255,),
    )
    ring = Image.new("L", (size, size), 0)
    rm = ImageDraw.Draw(ring)
    rm.ellipse(
        [
            (32 - 8.5) * k,
            (32 - 8.5) * k,
            (32 + 8.5) * k,
            (32 + 8.5) * k,
        ],
        outline=255,
        width=max(1, int(2.6 * k)),
    )
    img.paste(grad, (0, 0), ring)
    d.ellipse(
        [(32 - 4.2) * k, (32 - 4.2) * k, (32 + 4.2) * k, (32 + 4.2) * k],
        fill=GOLD + (255,),
    )

    # The six orbit nodes.
    for cx, cy in [(49, 19), (51, 35), (41, 51), (15, 45), (13, 29), (42, 13)]:
        x, y = cx * k, cy * k
        r_node = 3.8 * k
        d.ellipse(
            [x - r_node, y - r_node, x + r_node, y + r_node],
            fill=GOLD_LIGHT + (255,),
            outline=INK + (255,),
            width=max(1, int(1.8 * k)),
        )
    return img


def build() -> Image.Image:
    size = (W * S, H * S)
    canvas = Image.new("RGBA", size, INK + (255,))
    d = ImageDraw.Draw(canvas)

    # A warm glow behind the mark, so the flat ink background has depth.
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = 250 * S, 190 * S
    for radius, alpha in ((620, 8), (460, 10), (320, 12), (190, 16)):
        gd.ellipse(
            [cx - radius * S, cy - radius * S, cx + radius * S, cy + radius * S],
            fill=GOLD + (alpha,),
        )
    glow = glow.filter(ImageFilter.GaussianBlur(90 * S))
    canvas.alpha_composite(glow)

    # Concentric orbit rings in the top-right corner, clear of the text block.
    rings = Image.new("RGBA", size, (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    ring_c = (1330 * S, 60 * S)
    for radius, alpha in ((120, 120), (205, 92), (300, 64), (410, 44)):
        rd.ellipse(
            [
                ring_c[0] - radius * S,
                ring_c[1] - radius * S,
                ring_c[0] + radius * S,
                ring_c[1] + radius * S,
            ],
            outline=GOLD + (alpha,),
            width=max(1, int(1.6 * S)),
        )
    for angle, radius, alpha in ((140, 300, 130), (186, 410, 100), (243, 205, 160)):
        rad = math.radians(angle)
        nx = ring_c[0] + math.cos(rad) * radius * S
        ny = ring_c[1] + math.sin(rad) * radius * S
        rr = 7 * S
        rd.ellipse([nx - rr, ny - rr, nx + rr, ny + rr], fill=GOLD_LIGHT + (alpha,))
    rings = rings.filter(ImageFilter.GaussianBlur(1.2 * S))
    canvas.alpha_composite(rings)

    # The mark.
    mark_size = 132 * S
    mark = draw_mark(mark_size)
    canvas.alpha_composite(mark, (80 * S, 116 * S))

    # Wordmark: "Omni" in paper white, "Cloud" in muted — as in logo.svg.
    word = font("NotoSans-Bold.ttf", 68)
    word_w = measure(d, "Omni", word, tracking=-2.6)
    tracked(d, (80 * S + word_w + 8 * S, 202 * S), "Omni", word, PAPER + (255,), tracking=-2.6)
    tracked(d, (80 * S + word_w + 8 * S, 202 * S), "Cloud", word, MUTED + (255,), tracking=-2.6)

    # Tagline and the feature line.
    body = font("NotoSans-Regular.ttf", 29)
    tracked(
        d,
        (80 * S, 268 * S),
        "Self-hosted cloud storage on your own Telegram account.",
        body,
        MUTED + (255,),
    )
    feat = font("NotoSans-Medium.ttf", 25)
    tracked(
        d,
        (80 * S, 322 * S),
        "Optional end-to-end encryption  ·  Web app  ·  API  ·  npm SDK  ·  CLI",
        feat,
        GOLD + (255,),
    )

    # A short gold rule to close the text block.
    d.rectangle([80 * S, 352 * S, 80 * S + 56 * S, 352 * S + 3 * S], fill=GOLD + (255,))

    # Tech pills.
    pill_font = font("NotoSans-Medium.ttf", 20)
    labels = ["TypeScript", "React", "Fastify", "PostgreSQL", "Prisma", "npm"]
    x = 80 * S
    y = 404 * S
    pad_x, height = 18 * S, 40 * S
    for label in labels:
        tw = d.textlength(label, font=pill_font)
        w = tw + pad_x * 2
        d.rounded_rectangle(
            [x, y, x + w, y + height], radius=20 * S, fill=(34, 31, 24, 255), outline=(52, 47, 37, 255), width=max(1, int(1 * S))
        )
        d.text((x + pad_x, y + height / 2), label, font=pill_font, fill=MUTED + (255,), anchor="lm")
        x += w + 12 * S
    if x > W * S - 40 * S:
        raise SystemExit(f"the pill row overflows the canvas: ends at {x / S:.0f}px")

    # Footer: what to install, and where the code lives.
    mono = font("NotoSansMono-Regular.ttf", 19)
    left = "npm install @hilbras/omnicloud"
    right = "github.com/Hilbras/OmniCloud"
    right_w = sum(d.textlength(ch, font=mono) for ch in right)
    if 80 * S + d.textlength(left, font=mono) > 1200 * S - right_w - 40 * S:
        raise SystemExit("the footer lines overlap")
    d.text((80 * S, 540 * S), left, font=mono, fill=DIM + (255,), anchor="ls")
    tracked(d, (1200 * S, 540 * S), right, mono, DIM + (255,), anchor="rs")

    return canvas.resize((W, H), Image.LANCZOS)


if __name__ == "__main__":
    image = build()
    for out in (BRAND_OUT, GITHUB_OUT):
        out.parent.mkdir(parents=True, exist_ok=True)
        image.save(out, "PNG", optimize=True)
        print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
