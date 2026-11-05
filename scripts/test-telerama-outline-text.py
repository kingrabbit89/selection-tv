#!/usr/bin/env python3
"""Outlined PDFs, on synthetic shapes: the tests need neither a magazine nor its fonts."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(filename, name):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


outline = load("telerama-outline-text.py", "telerama_outline_under_test")
grid = load("editorial-telerama-pdf.py", "telerama_grid_under_test")
editorial = load("editorial-telerama-editorial.py", "telerama_editorial_under_test")

MOVE, LINE = outline.PATH_MOVE, outline.PATH_LINE


def polygon(points, dx=0, dy=0, scale=1):
    """One closed contour, the way a font or an outlined page draws it."""
    placed = [(x * scale + dx, y * scale + dy) for x, y in points]
    return [(MOVE, *placed[0])] + [(LINE, x, y) for x, y in placed[1:]] + [(LINE, *placed[0])]


# Invented glyphs, with enough points to anchor a line (more than ten).
COMB = [(0, 0), (.5, 0), (.5, .7), (.4, .7), (.4, .1), (.3, .1), (.3, .7), (.2, .7), (.2, .1), (.1, .1), (.1, .7), (0, .7)]
STAIR = [(0, 0), (.6, 0), (.6, .1), (.5, .1), (.5, .2), (.4, .2), (.4, .3), (.3, .3), (.3, .5), (.2, .5), (.2, .7), (0, .7)]
HOLE_OUT, HOLE_IN = [(0, 0), (.5, 0), (.5, .7), (0, .7)], [(.1, .1), (.4, .1), (.4, .6), (.25, .65), (.1, .6)]
FONT = {"Graphik-Regular": {
    "comb": {"u": "A", "adv": .6, "desc": -.2, "segs": polygon(COMB)},
    "stair": {"u": "B", "adv": .7, "desc": -.2, "segs": polygon(STAIR)},
    "hole": {"u": "O", "adv": .6, "desc": -.2, "segs": polygon(HOLE_OUT) + polygon(HOLE_IN)}}}
SIZE = 10


def path(shape, x, y=700):
    points = polygon(shape, x, y, SIZE)
    return outline.canonical_outline(points), (0, 0, 0)


class RebuildTests(unittest.TestCase):
    def setUp(self):
        self.references = outline.References(FONT)

    def test_contour_order_and_closing_line_do_not_change_the_shape(self):
        one = outline.canonical_outline(polygon(HOLE_OUT) + polygon(HOLE_IN))
        other = outline.canonical_outline(polygon(HOLE_IN) + polygon(HOLE_OUT))
        self.assertEqual(one, other)
        self.assertEqual(outline.signature(one), "200020000")

    def test_a_line_gets_text_font_size_position_and_its_dropped_space(self):
        paths = [path(STAIR, 106.5), path(COMB, 100), path(COMB, 120)]
        chars, glyphs, unknown = outline.rebuild_page_chars(paths, self.references, 800)
        self.assertEqual((glyphs, unknown), (3, 0))
        line = sorted(chars, key=lambda c: c["x0"])
        self.assertEqual("".join(c["text"] for c in line), "AB A")
        self.assertEqual({c["fontname"] for c in line}, {"Graphik-Regular"})
        self.assertEqual({c["size"] for c in line}, {SIZE})
        self.assertAlmostEqual(line[0]["x0"], 100, places=2)
        self.assertAlmostEqual(line[0]["matrix"][5], 700, places=1)
        self.assertAlmostEqual(line[0]["bottom"], 800 - (700 - .2 * SIZE), places=2)
        # The parsers' line grouping and composition read the rebuilt chars as usual.
        self.assertEqual(grid.compose(grid.line_groups(chars)[0]), "AB A")

    def test_a_path_matching_no_reference_never_becomes_text(self):
        triangle = [(0, 0), (.5, 0), (.25, .7)]
        chars, glyphs, unknown = outline.rebuild_page_chars([path(triangle, 100), path(COMB, 200)], self.references, 800)
        self.assertEqual((glyphs, unknown), (1, 1))
        self.assertEqual([c["text"] for c in chars], ["A"])

    def test_a_distorted_shape_is_not_accepted(self):
        bent = [(x, .7 - y) if 3 <= index < 9 else (x, y) for index, (x, y) in enumerate(COMB)]
        _, glyphs, unknown = outline.rebuild_page_chars([path(bent, 100)], self.references, 800)
        self.assertEqual((glyphs, unknown), (0, 1))


def char(text, x, top, size=6.5, font="Graphik-Bold", colour=(0, 0, 0), width=4.0):
    return {"text": text, "x0": x, "x1": x + width, "top": top, "bottom": top + size, "size": size, "fontname": font,
            "matrix": [size, 0, 0, size, x, 800 - top - size], "non_stroking_color": list(colour), "upright": True}


def text_chars(value, x, top, **style):
    return [char(c, x + i * 4.0, top, **style) for i, c in enumerate(value)]


def rebuilt_line(*parts):
    """Without its space glyph, a rebuilt line runs each advance up to the next origin: no blank is left."""
    line = [c for part in parts for c in part]
    for one, following in zip(line, line[1:]):
        one["x1"] = following["x0"]
    return line


class ParserTests(unittest.TestCase):
    LEFT = 59

    def row(self, value, x=60):
        return text_chars(value, x, 100)

    def test_native_alignment_stays_three_points(self):
        self.assertIsNotNone(grid.time_row(self.row("9.00 Titre", x=self.LEFT + 3), self.LEFT))
        self.assertIsNone(grid.time_row(self.row("9.00 Titre", x=self.LEFT + 3.3), self.LEFT))

    def test_rebuilt_alignment_accepts_its_noise_but_not_the_next_printed_position(self):
        tolerance = grid.REBUILT_TIME_ALIGNMENT
        self.assertIsNotNone(grid.time_row(self.row("9.00 Titre", x=self.LEFT + 3.3), self.LEFT, tolerance))
        self.assertIsNone(grid.time_row(self.row("9.00 Titre", x=self.LEFT + 5.1), self.LEFT, tolerance))

    def glued(self, jump):
        row = text_chars("11.10", 60, 100)
        return rebuilt_line(row, text_chars("100% immo", row[-1]["x0"] + jump, 100))

    def test_a_title_starting_with_a_number_is_cut_from_the_time_at_the_blank(self):
        row = self.glued(4.0 + .285 * 6.5)
        time = grid.time_row(row, self.LEFT)
        # compose() sees no blank wider than its threshold here, so only the position test separates them.
        self.assertEqual(grid.compose(row)[:8], "11.10100")
        self.assertEqual(time["start"], "11:10")
        title, _, _ = grid.title_from_segment([row], time)
        self.assertEqual(title, "100% immo")

    def test_a_longer_number_at_the_regular_pitch_stays_rejected(self):
        self.assertIsNone(grid.time_row(self.glued(4.0), self.LEFT), "12.345 is no time")
        self.assertIsNone(grid.time_row(self.row("20.559"), self.LEFT))

    def test_invalid_time_stays_an_error_even_glued(self):
        row = self.glued(4.0 + .285 * 6.5)
        row[0]["text"] = "9"
        self.assertEqual(grid.time_row(row, self.LEFT).get("error"), "invalid time")

    def test_glued_digits_in_a_plain_font_are_no_time(self):
        row = self.glued(4.0 + .285 * 6.5)
        for c in row:
            c["fontname"] = "Graphik-Regular"
        self.assertIsNone(grid.time_row(row, self.LEFT))

    def test_cover_range_reads_a_lost_kerned_blank_and_keeps_its_date_checks(self):
        self.assertEqual(grid.cover_range("N 4008 Du 7au 13/11/2026"), (dt.date(2026, 11, 7), dt.date(2026, 11, 13)))
        with self.assertRaises(ValueError):
            grid.cover_range("Du 8au 13/11/2026")
        with self.assertRaises(ValueError):
            grid.cover_range("Du 7 13/11/2026")


class FakePage:
    def __init__(self, chars):
        self.chars, self.width, self.height = chars, 600, 800

    def flush_cache(self):
        pass


def fake_pdfplumber(pages):
    class Document:
        def __init__(self):
            self.pages = pages
            self.closed = False

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def close(self):
            self.closed = True
    return types.SimpleNamespace(open=lambda path: Document())


COVER = text_chars("Du 7 au 13/11/2026", 40, 15, width=4.0)
WHITE = dict(colour=(1, 1, 1), size=8.5)
GRID_PAGE = (text_chars("SAMEDI 7", 40, 22, size=8) +
             [c for i, name in enumerate(("TF1", "France 2", "France 3", "France 4", "France 5", "Arte"))
              for c in text_chars(name, 60 + i * 92, 40, **WHITE)] +
             text_chars("9.00 ", 62.2, 60) + text_chars("Film au bord", 83, 60) + [char("f", 70, 68, font="TeleramaIconsPrint-Regular")] +
             rebuilt_line(text_chars("11.10", 60, 90), text_chars("100 Jours", 60 + 16 + 5.9, 90)) + [char("f", 70, 98, font="TeleramaIconsPrint-Regular")])


def write_layer(directory, pages):
    pages_dir = Path(directory) / "pages"
    pages_dir.mkdir(parents=True)
    description = []
    for number, chars in enumerate(pages, 1):
        (pages_dir / f"{number}.json").write_text(json.dumps(chars), encoding="utf8")
        description.append({"pdf_page": number, "width": 600, "height": 800, "glyphs": len(chars), "chars": len(chars), "unknown_paths": 0})
    (Path(directory) / "manifest.json").write_text(json.dumps({
        "schema_version": 1, "text_layer": outline.LAYER_KIND, "source_sha256": "a" * 64, "reference_sha256": ["b" * 64],
        "tool_sha256": "c" * 64, "summary": {"pages": len(pages), "glyphs": 0, "chars": 0, "unknown_paths": 0}, "pages": description}), encoding="utf8")


class OpenPdfTests(unittest.TestCase):
    def test_a_pdf_with_characters_stays_with_pdfplumber(self):
        with patch.dict(sys.modules, {"pdfplumber": fake_pdfplumber([FakePage(COVER)])}), \
                patch.object(outline, "has_no_text", side_effect=AssertionError("no pdfium scan when the cover has text")):
            document = outline.open_text_pdf("native.pdf")
        self.assertFalse(hasattr(document, "text_layer"))

    def test_a_textless_cover_alone_does_not_switch_to_the_rebuilt_layer(self):
        with patch.dict(sys.modules, {"pdfplumber": fake_pdfplumber([FakePage([]), FakePage(GRID_PAGE)])}), \
                patch.object(outline, "has_no_text", return_value=False):
            document = outline.open_text_pdf("hybrid.pdf", ["reference.pdf"])
        self.assertFalse(hasattr(document, "text_layer"))

    def test_no_reference_is_an_explicit_refusal(self):
        with patch.dict(sys.modules, {"pdfplumber": fake_pdfplumber([FakePage([])])}), patch.object(outline, "has_no_text", return_value=True), \
                patch.dict(os.environ, {outline.REFERENCES_ENV: ""}):
            with self.assertRaisesRegex(ValueError, "no text layer.*--reference-pdf"):
                outline.open_text_pdf("outlined.pdf")

    def test_a_missing_reference_is_refused(self):
        with self.assertRaisesRegex(ValueError, "not found"):
            outline.resolve_reference_pdfs(["nowhere.pdf"])

    def test_references_come_from_the_environment_when_no_option_is_given(self):
        with tempfile.TemporaryDirectory() as directory:
            one, two = Path(directory) / "1.pdf", Path(directory) / "2.pdf"
            one.write_bytes(b"1")
            two.write_bytes(b"2")
            with patch.dict(os.environ, {outline.REFERENCES_ENV: f"{one}{os.pathsep}{two}"}):
                self.assertEqual(outline.resolve_reference_pdfs(), [str(one), str(two)])
                self.assertEqual(outline.resolve_reference_pdfs([str(two)]), [str(two)])

    def test_rebuilt_text_and_outlines_cannot_land_in_the_repository(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            outline.refuse_repository_path(HERE / "rebuilt")
        with tempfile.TemporaryDirectory() as directory:
            outline.refuse_repository_path(directory)
            pdf = Path(directory) / "same.pdf"
            pdf.write_bytes(b"same")
            with self.assertRaisesRegex(ValueError, "cannot be the outlined PDF"):
                outline.cached_layer(str(pdf), [str(pdf)])

    def test_a_complete_layer_is_reused_and_an_interrupted_one_is_not(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {outline.CACHE_ENV: directory}):
            pdf, reference = Path(directory) / "o.pdf", Path(directory) / "r.pdf"
            pdf.write_bytes(b"o")
            reference.write_bytes(b"r")
            built = []

            def fake_write(_pdf, _refs, _digest, _reference_digests, target):
                built.append(target)
                write_layer(target, [COVER])
            with patch.object(outline, "write_layer", fake_write):
                first = outline.cached_layer(str(pdf), [str(reference)])
                self.assertEqual(outline.cached_layer(str(pdf), [str(reference)]), first)
                self.assertEqual(len(built), 1)
                (first / "manifest.json").unlink()
                outline.cached_layer(str(pdf), [str(reference)])
                self.assertEqual(len(built), 2)


class RebuiltDocumentTests(unittest.TestCase):
    """The parsers run on the stand-in with their usual controls, and trace its origin."""

    def extraction(self, function):
        with tempfile.TemporaryDirectory() as directory:
            layer = Path(directory) / "layer"
            write_layer(layer, [COVER, GRID_PAGE])
            pdf = Path(directory) / "outlined.pdf"
            pdf.write_bytes(b"outlined bytes")
            with patch.object(grid, "open_pdf", lambda *_: outline.RebuiltDocument(layer)), \
                    patch.object(grid, "poppler_index", side_effect=AssertionError("no pdftotext triage on outlines")):
                return function(pdf)

    def test_grid_report_keeps_its_controls_and_names_the_rebuilt_layer(self):
        report = self.extraction(lambda pdf: grid.extract_pdf(pdf, "2026-S46"))
        self.assertEqual([(o["start"], o["title"]) for o in report["observations"]], [("09:00", "Film au bord"), ("11:10", "100 Jours")])
        self.assertEqual(report["parser"]["text_layer"], "rebuilt_from_vector_outlines")
        self.assertEqual(report["parser"]["text_layer_references"], ["b" * 64])
        self.assertEqual(report["parser"]["text_triage"], "none")
        self.assertTrue(any("no text layer" in warning for warning in report["warnings"]))
        self.assertFalse(report["coverage_certified"])
        self.assertFalse(report["publication_ready"])

    def test_a_rebuilt_cover_of_another_week_is_still_refused(self):
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.extraction(lambda pdf: grid.extract_pdf(pdf, "2026-S45"))

    def test_editorial_report_traces_the_layer_in_its_allowed_fields(self):
        original = editorial.grid
        editorial.grid = grid
        try:
            report = self.extraction(lambda pdf: editorial.extract(pdf, "2026-S46"))
        finally:
            editorial.grid = original
        self.assertTrue(any("no text layer" in warning for warning in report["warnings"]))
        self.assertLessEqual(set(report), {"schema_version", "kind", "week", "range", "source", "reviews", "pages",
                                           "coverage_certified", "publication_ready", "warnings", "summary"})

    def test_crop_reads_the_lines_in_order(self):
        with tempfile.TemporaryDirectory() as directory:
            write_layer(directory, [text_chars("AB", 40, 100) + text_chars("CD", 40, 120) + text_chars("EF", 300, 120)])
            page = outline.RebuiltDocument(directory).pages[0]
            self.assertEqual(page.crop((30, 90, 200, 140)).extract_text(), "AB\nCD")


@unittest.skipUnless(importlib.util.find_spec("pypdfium2"), "pypdfium2 reads the generated PDF")
class GeneratedPdfTests(unittest.TestCase):
    """A real PDF made of filled paths only, without any font."""

    @staticmethod
    def pdf_bytes():
        drawn = []
        for x, shape in ((100, COMB), (106.5, STAIR)):
            placed = [(px * SIZE + x, py * SIZE + 700) for px, py in shape]
            drawn.append(f"{placed[0][0]:.3f} {placed[0][1]:.3f} m " + " ".join(f"{a:.3f} {b:.3f} l" for a, b in placed[1:]) + " h f")
        content = "\n".join(drawn).encode()
        objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                   b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R >>",
                   b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content)]
        output, offsets = bytearray(b"%PDF-1.4\n"), []
        for number, body in enumerate(objects, 1):
            offsets.append(len(output))
            output += b"%d 0 obj\n%s\nendobj\n" % (number, body)
        table = len(output)
        output += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
        for offset in offsets:
            output += b"%010d 00000 n \n" % offset
        output += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, table)
        return bytes(output)

    def test_paths_of_a_pdf_without_characters_become_text(self):
        import pypdfium2 as pdfium
        with tempfile.TemporaryDirectory() as directory:
            path_ = Path(directory) / "paths.pdf"
            path_.write_bytes(self.pdf_bytes())
            self.assertTrue(outline.has_no_text(str(path_)))
            document = pdfium.PdfDocument(str(path_))
            chars, glyphs, unknown = outline.rebuild_page_chars(outline.page_paths(document[0]), outline.References(FONT), 800)
            document.close()
        self.assertEqual((glyphs, unknown), (2, 0))
        self.assertEqual("".join(c["text"] for c in sorted(chars, key=lambda c: c["x0"])), "AB")


if __name__ == "__main__":
    unittest.main()
