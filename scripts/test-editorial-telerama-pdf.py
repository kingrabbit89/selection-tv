#!/usr/bin/env python3
"""Tests do not need the magazine or pdfplumber; its extraction stays optional."""

import datetime as dt
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("telerama_pdf", Path(__file__).with_name("editorial-telerama-pdf.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def chars(text, x=24, top=60, size=6.5, bold=True, is_white=False, icons=False):
    font = "Example+TeleramaIconsPrint-Regular" if icons else "Example+Graphik-Bold" if bold else "Example+Graphik-Regular"
    output = []
    for index, letter in enumerate(text):
        left = x + index * size * .5
        output.append({"text": letter, "x0": left, "x1": left + size * .5,
                       "top": top, "bottom": top + size, "size": size,
                       "fontname": font, "non_stroking_color": (1., 1., 1.) if is_white else (0., 0., 0.),
                       "matrix": (1, 0, 0, 1, left, 770 - top), "upright": True})
    return output


def grid(programmes):
    result = []
    for i, label in enumerate(["TF1", "France 2", "France 3", "France 4", "France 5", "Arte"]):
        result += chars(label, x=24 + i * 92, top=41, size=8.5, is_white=True)
    for top, time, title, hint in programmes:
        result += chars(time, x=484, top=top)
        result += chars(title, x=510, top=top)
        if hint:
            result += chars(hint, x=503, top=top, icons=True)
        result += chars("A review paragraph which must never be exported.", x=484, top=top + 7, bold=False)
    return result


class TeleramaTests(unittest.TestCase):
    def test_week_matches_next_iso_monday_and_cover(self):
        self.assertEqual(MODULE.issue_range("2026-S42"), (dt.date(2026, 10, 10), dt.date(2026, 10, 16)))
        self.assertEqual(MODULE.cover_range("Nº 4004 Du 10 au 16 / 10 / 2026"), MODULE.issue_range("2026-S42"))
        for value in ["S42", "2026-S00", "2026-S99"]:
            with self.assertRaises(ValueError):
                MODULE.issue_range(value)
        for value in ["Du 10 au 17 / 10 / 2026", "Du 32 au 38 / 10 / 2026", "No readable date"]:
            with self.assertRaises(ValueError):
                MODULE.cover_range(value)
        self.assertEqual(MODULE.cover_publication_date("Mercredi 7 / 10 / 2026"), "2026-10-07")
        self.assertIsNone(MODULE.cover_publication_date("Mercredi 8 / 10 / 2026"))
        self.assertIsNone(MODULE.cover_publication_date("PDF metadata says 1999"))

    def test_columns_keep_channels_and_do_not_cross_text(self):
        data = grid([(60, "20.55", "A film", "f")])
        self.assertEqual(len(MODULE.grid_columns(data)), 6)
        parsed = MODULE.extract_grid(data, dt.date(2026, 10, 10), 100, 100, "sha256:abc")
        self.assertEqual(len(parsed["observations"]), 1)
        item = parsed["observations"][0]
        self.assertEqual(item["channel"], "Arte")
        self.assertEqual(item["title"], "A film")
        self.assertEqual(item["genre_hint"], "Film")
        self.assertEqual(item["pdf_page"], 100)
        self.assertEqual(item["printed_page"], 100)
        self.assertEqual(item["source_ref"], "sha256:abc")
        self.assertIsNone(item["checked_at"])
        self.assertIsNone(item["source_url"])
        self.assertIsNone(item["source_independence"])
        self.assertNotIn("review paragraph", str(item).lower())

    def test_midnight_is_next_civil_date(self):
        data = grid([(60, "20.55", "Evening film", "f"), (85, "23.20", "Late doc", "d"),
                     (110, "0.20", "Night film", "f"), (135, "4.20", "Last doc", "d")])
        parsed = MODULE.extract_grid(data, dt.date(2026, 10, 10), 100, 100, "sha256:abc")
        self.assertEqual([o["date"] for o in parsed["observations"]],
                         ["2026-10-10", "2026-10-10", "2026-10-11", "2026-10-11"])
        self.assertEqual(parsed["observations"][2]["start"], "00:20")
        self.assertTrue(parsed["observations"][2]["overnight"])

    def test_malformed_and_ambiguous_times_are_rejected(self):
        data = grid([(60, "20.55", "Film", "f"), (85, "25.99", "Bad time", "f"),
                     (110, "0.20", "Cannot infer after bad time", "f")])
        parsed = MODULE.extract_grid(data, dt.date(2026, 10, 10), 100, None, "sha256:abc")
        self.assertEqual(len(parsed["observations"]), 1)
        self.assertEqual(len(parsed["rejected"]), 2)
        early = MODULE.extract_grid(grid([(60, "0.20", "Ambiguous first programme", "f")]),
                                    dt.date(2026, 10, 10), 100, None, "sha256:abc")
        self.assertEqual(early["observations"], [])
        reversed_rows = MODULE.extract_grid(grid([(60, "14.00", "One", "f"), (85, "13.00", "Two", "f")]),
                                            dt.date(2026, 10, 10), 100, None, "sha256:abc")
        self.assertEqual(len(reversed_rows["rejected"]), 1)

    def test_unmarked_programmes_are_optional_and_rating_is_not_genre(self):
        data = grid([(60, "20.55", "Game show", "u"), (85, "21.30", "Explicit doc", "d")])
        parsed = MODULE.extract_grid(data, dt.date(2026, 10, 10), 100, None, "sha256:abc")
        self.assertEqual([o["title"] for o in parsed["observations"]], ["Explicit doc"])
        all_items = MODULE.extract_grid(data, dt.date(2026, 10, 10), 100, None, "sha256:abc", "all-programmes")
        self.assertEqual(len(all_items["observations"]), 2)
        self.assertIsNone(all_items["observations"][0]["genre_hint"])
        self.assertNotIn("rating", str(all_items["observations"]))

    def test_custom_icon_font_uses_shared_baseline_and_glyphs_are_deduplicated(self):
        data = chars("Film", top=60)
        duplicate = [dict(char) for char in data]
        self.assertEqual(MODULE.dedupe_chars(data + duplicate), data)
        icon_data = chars("f", top=58.6, icons=True)
        icon_data[0]["matrix"] = (1, 0, 0, 1, 24, 710)
        self.assertEqual(len(MODULE.line_groups(data + icon_data)), 1)

    def test_canonical_channel_preserves_only_known_equivalences(self):
        self.assertEqual(MODULE.canonical_channel("Canal+ Cinéma(s)"), "Canal+ Cinéma")
        self.assertEqual(MODULE.canonical_channel("Canal+ Box Ofice"), "Canal+ Box Office")
        self.assertEqual(MODULE.canonical_channel("OCS"), "Ciné+ OCS")
        self.assertEqual(MODULE.canonical_channel("Ciné+ Émotion"), "Ciné+ Emotion")
        self.assertEqual(MODULE.canonical_channel("Unknown channel"), "Unknown channel")

    def test_date_header_requires_matching_weekday_and_week_range(self):
        start, end = MODULE.issue_range("2026-S42")
        self.assertEqual(MODULE.date_header(chars("SAMEDI 10", top=22), start, end), (start, None))
        self.assertEqual(MODULE.date_header(chars("VENDREDI 10", top=22), start, end),
                         (None, "date header does not match the issue range and weekday"))
        contradictory = chars("SAMEDI 10 DIMANCHE 11", top=22)
        self.assertEqual(MODULE.date_header(contradictory, start, end), (None, "conflicting date headers"))

    def test_footer_page_is_separate_from_pdf_position(self):
        self.assertEqual(MODULE.printed_page(chars("100 Télérama 4004 07/10/26", top=745)), 100)
        self.assertEqual(MODULE.printed_page(chars("Télérama 4004 07/10/26 101", top=745)), 101)
        self.assertIsNone(MODULE.printed_page(chars("4004 07/10/26", top=745)))

    def test_title_stops_before_distant_choice_caption_and_closing_arrow(self):
        row = chars("3.15", top=60) + chars("Le Peuple des airs", x=50, top=60) + chars("2", x=110, top=60, icons=True)
        # A later editorial choice at the bottom must not become part of the title.
        other = chars("Ciné+ Émotion Film Les Invités de mon père", x=24, top=100)
        time = MODULE.time_row(row, 24)
        self.assertEqual(MODULE.title_from_segment([row, other], time)[0], "Le Peuple des airs")

    def test_poppler_only_selects_known_grid_signatures_and_dates(self):
        self.assertTrue(MODULE.text_grid_candidate("TNT\nTF1 111 France 2 222 France 3 333 France 4 444 France 5 555 Arte 777"))
        self.assertTrue(MODULE.text_grid_candidate("TCM 33 Mezzo 222 Histoire TV 333 Paris 444 RTL9 555 TV5 777"))
        self.assertFalse(MODULE.text_grid_candidate("Article about Canal+ and Arte with a long review"))
        start, _ = MODULE.issue_range("2026-S42")
        self.assertEqual(MODULE.text_date_header("AUTRES CHAÎNES SAMEDI 10", start), (start, None))
        self.assertEqual(MODULE.text_date_header("AUTRES CHAÎNES SAMEDI 20", start),
                         (None, "date header does not match the issue range and weekday"))

    def test_invalid_header_cancels_inherited_date_until_next_valid_header(self):
        class Page:
            width, height = 592.44, 771.02

            def __init__(self, content):
                self.chars = content

            def flush_cache(self):
                pass

        class Document:
            pages = [Page(chars("Du 10 au 16 / 10 / 2026", top=20)),
                     Page(chars("SAMEDI 10", top=22) + grid([(60, "20.55", "Saturday film", "f")])),
                     Page(chars("LUNDI 11", top=22) + grid([(60, "20.55", "Invalid date film", "f")])),
                     Page(grid([(60, "20.55", "Cannot inherit Saturday", "f")])),
                     Page(chars("DIMANCHE 11", top=22) + grid([(60, "20.55", "Sunday film", "f")]))]

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        fake_pdf = types.SimpleNamespace(open=lambda path: Document())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "provided.pdf"
            path.write_bytes(b"test bytes, never interpreted by mock pdfplumber")
            with patch.dict(sys.modules, {"pdfplumber": fake_pdf}), patch.object(MODULE, "poppler_index", return_value=None):
                report = MODULE.extract_pdf(path, "2026-S42")
        self.assertEqual([(o["title"], o["date"]) for o in report["observations"]],
                         [("Saturday film", "2026-10-10"), ("Sunday film", "2026-10-11")])
        self.assertEqual(report["pages"][2]["status"], "rejected")
        self.assertEqual(report["pages"][3]["status"], "rejected")
        self.assertFalse(report["coverage_certified"])
        self.assertFalse(report["publication_ready"])


if __name__ == "__main__":
    unittest.main()
