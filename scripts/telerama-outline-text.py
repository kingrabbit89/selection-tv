#!/usr/bin/env python3
"""Rebuild the character layer of a Telerama PDF whose text became vector outlines.

Each glyph of such a PDF is one path object. Every path is matched against the
outlines of the fonts embedded in earlier text issues (--reference-pdf), jointly
per word: same font, size from the line, position from the reference metrics.
The result stands in for pdfplumber, so the usual parsers and their controls run
on it unchanged. A path that matches no reference stays out of the text.

The rebuilt pages and the reference outlines are local working files: they stay
in the output directory or the temporary cache, never in the repository.
"""

from __future__ import annotations

import argparse
import collections
import ctypes
import hashlib
import io
import json
import os
import shutil
import statistics
import sys
import tempfile
from pathlib import Path

LAYER_KIND = "rebuilt_from_vector_outlines"
REFERENCES_ENV = "SELECTION_TV_TELERAMA_REFERENCE_PDFS"
CACHE_ENV = "SELECTION_TV_TELERAMA_OUTLINE_CACHE"
REPOSITORY = Path(__file__).resolve().parent.parent
MAIN_FONTS = {"Graphik-Bold", "Graphik-Regular", "Graphik-RegularItalic", "PublicoText-Bold", "PublicoText-BoldItalic",
              "PublicoText-Roman", "PublicoText-Italic", "TeleramaIconsPrint-Regular"}
# Superior and fraction figures share the shapes of ordinary digits at another scale.
SKIPPED_GLYPH_SUFFIXES = {"sups", "numr", "dnom", "sinf", "subs", "ordn"}
SKIPPED_GLYPH_NAMES = {".notdef", "space", "onesuperior", "twosuperior", "threesuperior", "ordfeminine", "ordmasculine"}
PUNCTUATION = ",;:.'’‘\"«»-–—_·…"
NUMERIC = set("0123456789.:")
PATH_LINE, PATH_CURVE, PATH_MOVE = 0, 1, 2


def log(message):
    print(message, file=sys.stderr, flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


# Shapes ---------------------------------------------------------------------

def box(points):
    xs, ys = [p[1] for p in points], [p[2] for p in points]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def canonical_outline(points):
    """Drop closing lines and sort contours: their order differs between a font subset and an outlined page."""
    closed, contour = [], []

    def flush():
        if len(contour) > 2 and contour[-1][0] == PATH_LINE and abs(contour[-1][1] - contour[0][1]) < 1e-3 \
                and abs(contour[-1][2] - contour[0][2]) < 1e-3:
            contour.pop()
        closed.extend(contour)
    for point in points:
        if point[0] == PATH_MOVE:
            flush()
            contour = [point]
        else:
            contour.append(point)
    flush()
    x0, y0, width, height = box(closed)
    contours, current = [], []
    for point in closed:
        if point[0] == PATH_MOVE and current:
            contours.append(current)
            current = []
        current.append(point)
    if current:
        contours.append(current)
    contours.sort(key=lambda c: (len(c), round((sum(p[2] for p in c) / len(c) - y0) / (height or 1) * 6),
                                 round((sum(p[1] for p in c) / len(c) - x0) / (width or 1) * 6)))
    return [point for c in contours for point in c]


def signature(points):
    return "".join(str(p[0]) for p in points)


class References:
    """Reference glyphs indexed by the sequence of their path operators."""

    def __init__(self, table):
        self.by_signature = collections.defaultdict(list)
        for font, glyphs in table.items():
            for glyph in glyphs.values():
                if not glyph["segs"]:
                    continue
                points = canonical_outline(glyph["segs"])
                x0, y0, width, height = box(points)
                if width <= 0 or height <= 0:
                    continue
                self.by_signature[signature(points)].append({
                    "font": font, "u": glyph["u"], "adv": glyph["adv"], "desc": glyph.get("desc") or 0,
                    "x0": x0, "y0": y0, "w": width, "h": height, "main": font in MAIN_FONTS,
                    "pts": [((p[1] - x0) / width, (p[2] - y0) / height) for p in points]})


# Reference fonts ------------------------------------------------------------

def add_reference_glyph(table, font, text, advance, descent, segments):
    key = text + "|" + signature(segments) + "|" + ",".join(f"{p[1]:.3f}" for p in segments[:8])
    table[font].setdefault(key, {"u": text, "adv": advance, "desc": descent, "segs": segments})


def add_cff_font(table, spec, short, descent):
    """Name-keyed CFF subsets give every glyph with its name, variants included."""
    from fontTools.agl import toUnicode
    from fontTools.cffLib import CFFFontSet
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from pdfminer.pdftypes import dict_value, stream_value
    descriptor = dict_value(spec.get("FontDescriptor"))  # Composite fonts have none here.
    if "FontFile3" not in descriptor:
        return False
    raw = stream_value(descriptor["FontFile3"]).get_data()
    if raw[:1] != b"\x01":
        return False
    fonts = CFFFontSet()
    fonts.decompile(io.BytesIO(raw), None)
    font = fonts[0]
    if getattr(font, "ROS", None) is not None:
        return False
    glyphs = font.CharStrings
    for name in glyphs.keys():
        if name in SKIPPED_GLYPH_NAMES or name.split(".")[-1] in SKIPPED_GLYPH_SUFFIXES:
            continue
        text = toUnicode(name)
        if not text:
            continue
        charstring = glyphs[name]
        charstring.decompile()
        pen = DecomposingRecordingPen(glyphs)
        charstring.draw(pen)
        segments = []
        for operator, values in pen.value:
            if operator == "moveTo":
                segments.append((PATH_MOVE, values[0][0] / 1000, values[0][1] / 1000))
            elif operator == "lineTo":
                segments.append((PATH_LINE, values[0][0] / 1000, values[0][1] / 1000))
            elif operator == "curveTo":
                segments += [(PATH_CURVE, p[0] / 1000, p[1] / 1000) for p in values]
        width = charstring.width if getattr(charstring, "width", None) is not None else font.Private.defaultWidthX
        if segments:
            add_reference_glyph(table, short, text, width / 1000, descent, segments)
    return True


def pdfium_glyph_path(font, code, size=1000.0):
    import pypdfium2.raw as raw
    path = raw.FPDFFont_GetGlyphPath(font, code, size)
    if not path:
        return None
    x, y = ctypes.c_float(), ctypes.c_float()
    segments = []
    for index in range(raw.FPDFGlyphPath_CountGlyphSegments(path)):
        segment = raw.FPDFGlyphPath_GetGlyphPathSegment(path, index)
        raw.FPDFPathSegment_GetPoint(segment, x, y)
        segments.append((raw.FPDFPathSegment_GetType(segment), x.value, y.value))
    return segments


def read_reference_fonts(paths):
    """{font: {key: glyph}} from every font embedded in the reference PDFs."""
    try:
        import fontTools  # noqa: F401
        import pdfplumber
        import pypdfium2 as pdfium
        import pypdfium2.raw as raw
    except ImportError as exc:
        raise RuntimeError("reading an outlined PDF requires pdfplumber and fonttools; "
                           "install with python3 -m pip install pdfplumber fonttools") from exc
    from pdfminer.pdffont import PDFCIDFont
    from pdfminer.pdftypes import dict_value
    table = collections.defaultdict(dict)
    for path in paths:
        fonts_before = sum(len(glyphs) for glyphs in table.values())
        handled = set()
        document, plumber = pdfium.PdfDocument(path), pdfplumber.open(path)
        for number in range(len(document)):
            page, plumbed = document[number], plumber.pages[number]
            resources = plumbed.page_obj.resources.get("Font") if plumbed.page_obj.resources else None
            miner_fonts, specs = {}, {}
            for spec in (dict_value(resources) if resources else {}).values():
                try:
                    described = dict_value(spec)
                    font = plumber.rsrcmgr.get_font(getattr(spec, "objid", None), described)
                except Exception:  # A broken font resource only means fewer reference glyphs.
                    continue
                miner_fonts[str(font.fontname)] = font
                specs[str(font.fontname).split("+")[-1]] = (str(font.fontname), described)
            covered = set()  # Fonts of this page read by name: the code route below would add wrongly scaled twins.
            for short, (full, described) in specs.items():
                try:
                    if full in handled or add_cff_font(table, described, short, miner_fonts[full].get_descent()):
                        handled.add(full)
                        covered.add(short)
                except Exception as exc:  # Same: the page font route below may still read it.
                    log(f"reference font {short}: {exc}")
            page_fonts = {}
            for item in page.get_objects(max_depth=5):
                if item.type != 1:
                    continue
                font = raw.FPDFTextObj_GetFont(item.raw)
                buffer = ctypes.create_string_buffer(256)
                raw.FPDFFont_GetBaseFontName(font, buffer, 256)
                page_fonts[buffer.value.decode("latin1")] = font
            for name, font in page_fonts.items():
                short = name.split("+")[-1]
                miner = next((m for full, m in miner_fonts.items() if full.split("+")[-1] == short), None)
                if miner is None or short in covered or name in handled:
                    continue
                handled.add(name)
                for code in range(4000 if isinstance(miner, PDFCIDFont) else 256):
                    try:
                        text = miner.to_unichr(code)
                    except Exception:  # pdfminer raises for every unmapped code.
                        continue
                    segments = pdfium_glyph_path(font, code) if text else None
                    if segments:
                        add_reference_glyph(table, short, text, miner.char_width(code), miner.get_descent(), segments)
            plumbed.flush_cache()
            page.close()
        plumber.close()
        document.close()
        if sum(len(glyphs) for glyphs in table.values()) == fonts_before:
            raise ValueError(f"reference PDF {path} adds no font outline; use earlier issues that have a text layer")
    return table


# Page rebuilding ------------------------------------------------------------

def page_paths(page):
    """Upright filled paths of a page: [(canonical points, fill colour)]."""
    import pypdfium2.raw as raw
    x, y = ctypes.c_float(), ctypes.c_float()
    r, g, b, a = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    result = []
    for item in page.get_objects(max_depth=1):
        if item.type != 2:
            continue
        count = raw.FPDFPath_CountSegments(item.raw)
        if count < 2 or count > 500:
            continue
        matrix = item.get_matrix().get()
        if abs(matrix[1]) > 1e-3 or abs(matrix[2]) > 1e-3:
            continue
        points = []
        for index in range(count):
            segment = raw.FPDFPath_GetPathSegment(item.raw, index)
            raw.FPDFPathSegment_GetPoint(segment, x, y)
            points.append((raw.FPDFPathSegment_GetType(segment), matrix[0] * x.value + matrix[4], matrix[3] * y.value + matrix[5]))
        raw.FPDFPageObj_GetFillColor(item.raw, r, g, b, a)
        result.append((canonical_outline(points), (r.value / 255, g.value / 255, b.value / 255)))
    return result


def identify(paths, references):
    """Candidate reference glyphs for each path; also the count of paths matching none."""
    glyphs, unknown = [], 0
    for points, colour in paths:
        x0, y0, width, height = box(points)
        if width > 40 or height > 40 or width <= 0 or height <= 0:
            continue
        shape = [((p[1] - x0) / width, (p[2] - y0) / height) for p in points]
        candidates = []
        for entry in references.by_signature.get(signature(points), ()):
            distance = sum(abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(shape, entry["pts"])) / (2 * len(shape))
            if distance < .05 and abs(width / height - entry["w"] / entry["h"]) < .22 * entry["w"] / entry["h"] + .08:
                candidates.append((distance + (0 if entry["main"] else .02), entry))
        if not candidates:
            unknown += 1
            continue
        candidates.sort(key=lambda item: item[0])
        best = candidates[0][1]
        scale = height / best["h"] if height >= width else width / best["w"]
        glyphs.append({"x0": x0, "y0": y0, "w": width, "h": height, "col": colour, "cand": candidates, "s": scale,
                       "b": y0 - best["y0"] * scale, "n": len(points),
                       "anchor": len(points) > 10 and best["u"] not in PUNCTUATION})
    return glyphs, unknown


def baseline_runs(glyphs):
    """Runs of glyphs sharing a baseline, split where a wide blank separates columns."""
    bands, current = [], []
    for glyph in sorted(glyphs, key=lambda g: g["b"]):
        if current and glyph["b"] - current[-1]["b"] > .5:
            bands.append(current)
            current = []
        current.append(glyph)
    if current:
        bands.append(current)
    runs = []
    for band in bands:
        run = []
        for glyph in sorted(band, key=lambda g: g["x0"]):
            if run and glyph["x0"] - (run[-1]["x0"] + run[-1]["w"]) > 14:
                runs.append(run)
                run = []
            run.append(glyph)
        if run:
            runs.append(run)
    return runs


def merge_short_runs(runs):
    """A short run just off a longer line is a glyph variant misread in the first pass (old-style 3)."""
    runs = sorted(runs, key=len)
    merged = []
    for index, run in enumerate(runs):
        target = None
        if len(run) <= 3:
            baseline = statistics.median(g["b"] for g in run)
            size = statistics.median(g["s"] for g in run)
            left, right = min(g["x0"] for g in run), max(g["x0"] + g["w"] for g in run)
            for other in runs[index + 1:]:
                other_size = statistics.median(g["s"] for g in other)
                if abs(statistics.median(g["b"] for g in other) - baseline) < .2 * other_size and abs(size / other_size - 1) < .3 \
                        and min(g["x0"] for g in other) - right < 14 and left - max(g["x0"] + g["w"] for g in other) < 14:
                    target = other
                    break
        if target is not None:
            target.extend(run)
        else:
            merged.append(run)
    return merged


def attach_marks(runs, marks):
    """Punctuation and accents join the line that holds them; what remains forms its own runs."""
    lines = [(min(g["x0"] for g in run), max(g["x0"] + g["w"] for g in run), statistics.median(g["b"] for g in run),
              statistics.median(g["s"] for g in run), run) for run in runs]
    alone = []
    for mark in marks:
        best, nearest = None, 1e9
        for left, right, baseline, size, run in lines:
            if left - 1.6 * size <= mark["x0"] <= right + 1.6 * size and baseline - .35 * size <= mark["y0"] \
                    and mark["y0"] + mark["h"] <= baseline + 1.05 * size:
                distance = abs(mark["y0"] + mark["h"] / 2 - (baseline + .3 * size))
                if distance < nearest:
                    best, nearest = run, distance
        if best is None:
            alone.append(mark)
        else:
            best.append(mark)
    return runs + baseline_runs(alone)


def run_chars(run, page_height):
    """Decode a printed line word by word on one font, then restore the spaces outlines dropped."""
    run.sort(key=lambda g: g["x0"])
    anchored = [g for g in run if g["anchor"]] or run
    size = round(statistics.median(g["s"] for g in anchored) * 20) / 20
    if abs(size - round(size * 2) / 2) < .11:
        size = round(size * 2) / 2
    baseline = statistics.median(g["b"] for g in anchored)
    words, word = [], []
    for glyph in run:
        if word and glyph["x0"] - (word[-1]["x0"] + word[-1]["w"]) > .14 * size:
            words.append(word)
            word = []
        word.append(glyph)
    if word:
        words.append(word)

    def cost(glyph, candidate):
        distance, entry = candidate
        return distance + .5 * abs(glyph["h"] - entry["h"] * size) / size + .5 * abs(glyph["w"] - entry["w"] * size) / size \
            + .4 * abs(glyph["y0"] - entry["y0"] * size - baseline) / size

    for word in words:
        best = None
        for font in {c[1]["font"] for g in word for c in g["cand"]}:
            total, picks = 0, []
            for glyph in word:
                options = [(cost(glyph, c), c[1]) for c in glyph["cand"] if c[1]["font"] == font]
                if options:
                    option = min(options, key=lambda o: o[0])
                    total += option[0]
                    picks.append(option[1])
                else:
                    total += .25
                    picks.append(None)
            if best is None or total < best[0]:
                best = (total, picks)
        for glyph, entry in zip(word, best[1]):
            if entry is None:
                entry = min(((cost(glyph, c), c[1]) for c in glyph["cand"]), key=lambda o: o[0])[1]
            origin = glyph["x0"] - entry["x0"] * size
            bottom = baseline + entry["desc"] * size
            top = bottom + size
            glyph["c"] = {"text": entry["u"], "fontname": entry["font"], "size": size, "upright": True,
                          "x0": round(origin, 3), "x1": round(origin + entry["adv"] * size, 3),
                          "top": round(page_height - top, 3), "bottom": round(page_height - bottom, 3),
                          "y0": round(bottom, 3), "y1": round(top, 3),
                          "matrix": [size, 0, 0, size, round(origin, 3), round(baseline, 1)],
                          "non_stroking_color": list(glyph["col"]), "adv": entry["adv"] * size,
                          "width": entry["adv"] * size, "height": size, "object_type": "char"}
    chars, last, last_glyph = [], None, None
    for glyph in run:
        char = glyph["c"]
        if last:
            ink = glyph["x0"] - (last_glyph["x0"] + last_glyph["w"])
            numeric = last["text"] in NUMERIC and char["text"] in NUMERIC
            if (numeric and ink > .42 * size) or (not numeric and char["x0"] - last["x1"] > .12 * size and ink > .1 * size):
                space = dict(char if "Icons" in last["fontname"] else last)
                if "Icons" in space["fontname"]:
                    space["fontname"] = "Graphik-Regular"
                x0, x1 = min(last["x1"], char["x0"] - .01), char["x0"]
                space.update(text=" ", x0=x0, x1=x1, width=x1 - x0, adv=x1 - x0)
                space["matrix"] = [size, 0, 0, size, x0, char["matrix"][5]]
                chars.append(space)
            else:
                last["x1"] = max(last["x1"], char["x0"])
        chars.append(char)
        last, last_glyph = char, glyph
    return chars


def rebuild_page_chars(paths, references, page_height):
    """(pdfplumber-like chars, recognised glyph count, unrecognised path count) of one page."""
    glyphs, unknown = identify(paths, references)
    runs = merge_short_runs(baseline_runs([g for g in glyphs if g["anchor"]]))
    runs = attach_marks(runs, [g for g in glyphs if not g["anchor"]])
    return [char for run in runs for char in run_chars(run, page_height)], len(glyphs), unknown


# Layer on disk --------------------------------------------------------------

def resolve_reference_pdfs(reference_pdfs=None):
    paths = list(reference_pdfs or []) or [p for p in os.environ.get(REFERENCES_ENV, "").split(os.pathsep) if p.strip()]
    missing = [p for p in paths if not Path(p).is_file()]
    if missing:
        raise ValueError(f"reference PDF not found: {missing[0]}")
    return paths


def cache_root():
    return Path(os.environ.get(CACHE_ENV) or Path(tempfile.gettempdir()) / "selection-tv-telerama-outline")


def refuse_repository_path(path):
    resolved = Path(path).resolve()
    if resolved == REPOSITORY or REPOSITORY in resolved.parents:
        raise ValueError("rebuilt text and font outlines must stay outside the repository")


def load_references(paths, digests):
    root = cache_root()
    refuse_repository_path(root)
    stored = root / ("references-" + hashlib.sha256((tool_digest() + "".join(sorted(digests))).encode()).hexdigest()[:24] + ".json")
    if stored.is_file():
        return References(json.loads(stored.read_text(encoding="utf8")))
    log(f"reading reference fonts of {len(paths)} PDF(s)")
    table = read_reference_fonts(paths)
    root.mkdir(parents=True, exist_ok=True)
    partial = stored.with_suffix(f".{os.getpid()}.tmp")
    partial.write_text(json.dumps(table, ensure_ascii=False), encoding="utf8")
    partial.replace(stored)
    return References(table)


def tool_digest():
    return hashlib.sha256(Path(__file__).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def write_layer(pdf_path, reference_paths, digest, reference_digests, target):
    """Write pages/N.json, then manifest.json last: a manifest means a complete layer."""
    import pypdfium2 as pdfium
    references = load_references(reference_paths, reference_digests)
    pages_dir = target / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(pdf_path)
    pages = []
    for index in range(len(document)):
        page = document[index]
        width, height = page.get_size()
        chars, glyphs, unknown = rebuild_page_chars(page_paths(page), references, height)
        page.close()
        (pages_dir / f"{index + 1}.json").write_text(json.dumps(chars, ensure_ascii=False), encoding="utf8")
        pages.append({"pdf_page": index + 1, "width": width, "height": height, "glyphs": glyphs,
                      "chars": len(chars), "unknown_paths": unknown})
        if (index + 1) % 20 == 0:
            log(f"rebuilt {index + 1}/{len(document)} pages")
    document.close()
    manifest = {"schema_version": 1, "text_layer": LAYER_KIND, "source_sha256": digest,
                "reference_sha256": sorted(reference_digests), "tool_sha256": tool_digest(),
                "summary": {"pages": len(pages), "glyphs": sum(p["glyphs"] for p in pages),
                            "chars": sum(p["chars"] for p in pages), "unknown_paths": sum(p["unknown_paths"] for p in pages)},
                "pages": pages}
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    return manifest


def cached_layer(pdf_path, reference_paths):
    """Directory of the complete layer for this PDF, these references and this tool; built when absent."""
    digest = sha256_file(pdf_path)
    reference_digests = [sha256_file(p) for p in reference_paths]
    if digest in reference_digests:
        raise ValueError("a reference PDF cannot be the outlined PDF itself")
    key = hashlib.sha256((digest + "".join(sorted(reference_digests)) + tool_digest()).encode()).hexdigest()[:24]
    root = cache_root()
    refuse_repository_path(root)
    target = root / key
    if not (target / "manifest.json").is_file():
        shutil.rmtree(target, ignore_errors=True)
        log(f"{Path(pdf_path).name} has no text layer: rebuilding it from the outlines")
        write_layer(pdf_path, reference_paths, digest, reference_digests, target)
    return target


class RebuiltCrop:
    def __init__(self, chars):
        self.chars = chars

    def extract_text(self):
        lines = {}
        for char in self.chars:
            lines.setdefault(round(char["matrix"][5], 1), []).append(char)
        return "\n".join("".join(c["text"] for c in sorted(lines[key], key=lambda c: c["x0"]))
                         for key in sorted(lines, reverse=True))


class RebuiltPage:
    """The part of a pdfplumber page the Telerama parsers read."""

    def __init__(self, layer, description):
        self.layer, self.page_number = layer, description["pdf_page"]
        self.width, self.height = description["width"], description["height"]
        self._chars = None

    @property
    def chars(self):
        if self._chars is None:
            self._chars = json.loads((self.layer / "pages" / f"{self.page_number}.json").read_text(encoding="utf8"))
        return self._chars

    def flush_cache(self):
        self._chars = None

    def crop(self, bounds):
        return RebuiltCrop([c for c in self.chars if c["x0"] >= bounds[0] and c["x1"] <= bounds[2]
                            and c["top"] >= bounds[1] and c["bottom"] <= bounds[3]])


class RebuiltDocument:
    def __init__(self, layer):
        self.layer = Path(layer)
        self.manifest = json.loads((self.layer / "manifest.json").read_text(encoding="utf8"))
        self.pages = [RebuiltPage(self.layer, page) for page in self.manifest["pages"]]
        self.text_layer = {"text_layer": LAYER_KIND, "text_layer_references": self.manifest["reference_sha256"],
                           "unknown_paths": self.manifest["summary"]["unknown_paths"]}
        self.warning = ("This PDF has no text layer: characters, fonts, sizes and positions were rebuilt by matching its "
                        "vector outlines to the fonts of earlier issues. Check lines against page images during review.")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        pass


def has_no_text(path):
    """True only when no page of the PDF holds a single character."""
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(path)
    try:
        for index in range(len(document)):
            page = document[index]
            text = page.get_textpage()
            count = text.count_chars()
            text.close()
            page.close()
            if count:
                return False
    finally:
        document.close()
    return True


def open_text_pdf(path, reference_pdfs=None):
    """The PDF through pdfplumber or, when it holds no character at all, through its rebuilt layer."""
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError("pdfplumber is required; install with python3 -m pip install pdfplumber") from exc
    document = pdfplumber.open(path)
    if not document.pages or document.pages[0].chars or not has_no_text(path):
        return document
    document.close()
    references = resolve_reference_pdfs(reference_pdfs)
    if not references:
        raise ValueError(f"{Path(path).name} has no text layer (text converted to outlines); give earlier text issues "
                         f"with --reference-pdf or {REFERENCES_ENV}")
    return RebuiltDocument(cached_layer(path, references))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", help="Path to the outlined Telerama PDF (not published)")
    parser.add_argument("--reference-pdf", action="append", default=[], metavar="PDF",
                        help=f"Earlier text issue supplying font outlines; repeat it (default: {REFERENCES_ENV})")
    parser.add_argument("--out-dir", help="New directory for the layer (default: the cache the parsers read)")
    args = parser.parse_args(argv)
    try:
        if not has_no_text(args.pdf):
            print(json.dumps({"text_layer": "native", "next_action": "This PDF has text: the parsers read it directly."}))
            return 0
        references = resolve_reference_pdfs(args.reference_pdf)
        if not references:
            parser.error(f"give at least one --reference-pdf or set {REFERENCES_ENV}")
        if args.out_dir:
            target = Path(args.out_dir)
            refuse_repository_path(target)
            if target.exists():
                parser.error("output directory must be new")
            digest = sha256_file(args.pdf)
            reference_digests = [sha256_file(p) for p in references]
            if digest in reference_digests:
                raise ValueError("a reference PDF cannot be the outlined PDF itself")
            write_layer(args.pdf, references, digest, reference_digests, target)
        else:
            target = cached_layer(args.pdf, references)
    except (ValueError, RuntimeError, OSError) as exc:
        parser.exit(2, f"error: {exc}\n")
    manifest = json.loads((target / "manifest.json").read_text(encoding="utf8"))
    print(json.dumps({"text_layer": LAYER_KIND, "output": str(target), **manifest["summary"],
                      "publication_ready": False}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
