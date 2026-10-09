#!/usr/bin/env python3
"""Extract native daily-review marks and page pointers, never article bodies.

Short review summaries are supplied separately after reading the cited PDF.
No rating conversion, editorial decision or broadcast certification is made.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import pathlib
import re

spec = importlib.util.spec_from_file_location("telerama_grid", pathlib.Path(__file__).with_name("editorial-telerama-pdf.py"))
grid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grid)

RATINGS = {"r": ("Hélas", None), "t": ("Bof", 1), "y": ("Bien", 2),
           "u": ("Très bien", 3), "i": ("Bravo", 4)}
GENRES = ("Seul-en-scène", "Documentaire", "Téléfilm", "Spectacle", "Théâtre",
          "Magazine", "Animation", "Concert", "Série", "Film", "Opéra")


def header_candidates(chars):
    result = []
    for line in grid.line_groups(chars):
        marks = [c for c in line if grid.icon(c) and c["text"] in RATINGS
                 and 7.5 <= c["size"] <= 10 and 40 <= c["top"] < 715]
        for index, mark in enumerate(marks):
            right = marks[index + 1]["x0"] - 2 if index + 1 < len(marks) else 10000
            header = [c for c in line if mark["x0"] <= c["x0"] < right and
                      "Graphik" in c.get("fontname", "") and 7.5 <= c["size"] <= 10]
            text = grid.compose(header)
            matched = re.fullmatch(r"(\d{1,2})[.:](\d{2})\s+(.+?)\s+(" + "|".join(GENRES) + r")", text)
            if not matched or int(matched[1]) > 23 or int(matched[2]) > 59:
                continue
            result.append({"mark": mark, "header": header, "start": f"{int(matched[1]):02d}:{matched[2]}",
                           "channel_printed": matched[3], "programme_kind": matched[4]})
    return sorted(result, key=lambda item: (item["mark"]["top"], item["mark"]["x0"]))


def page_reviews(chars, nominal_date, pdf_page, width):
    headers = header_candidates(chars)
    reviews, rejected = [], []
    for item in headers:
        mark = item["mark"]
        # A competing review to the right defines a column boundary. Large
        # bold title glyphs identify headings; body/caption fonts stay excluded.
        boundaries = [h["mark"]["x0"] - 3 for h in headers if h["mark"]["x0"] > mark["x0"] + 30
                      and h["mark"]["top"] >= mark["top"] - 2]
        right = min(boundaries, default=width - 16)
        candidates = [c for c in chars if mark["x0"] - 2 <= c["x0"] < right and
                      mark["top"] + 8 <= c["top"] <= mark["top"] + 70 and
                      "Graphik-Bold" in c.get("fontname", "") and c["size"] >= 9]
        lines = grid.line_groups(candidates)
        if not lines:
            rejected.append({"pdf_page": pdf_page, "reason": "unreadable_review_title", "bbox": grid.bbox([mark] + item["header"])})
            continue
        title_chars, previous_bottom = [], None
        for line in lines:
            if previous_bottom is not None and min(c["top"] for c in line) - previous_bottom > 8:
                break
            title_chars.extend(line)
            previous_bottom = max(c["bottom"] for c in line)
        title = grid.normalize_text(" ".join(grid.compose(line) for line in grid.line_groups(title_chars)))
        if not title or len(title) > 300:
            rejected.append({"pdf_page": pdf_page, "reason": "ambiguous_review_title"})
            continue
        date = nominal_date + dt.timedelta(days=item["start"] < "06:00")
        label, count = RATINGS[mark["text"]]
        bounds = grid.bbox([mark] + item["header"] + title_chars)
        identity = f"{pdf_page}:{bounds}:{title}"
        reviews.append({"id": hashlib.sha256(identity.encode()).hexdigest()[:20],
                        "title": title, "date": date.isoformat(), "grid_date": nominal_date.isoformat(),
                        "start": item["start"], "channel": grid.canonical_channel(item["channel_printed"]),
                        "channel_printed": item["channel_printed"], "programme_kind": item["programme_kind"],
                        "in_daily_review_pages": True,
                        "native_rating": {"glyph_code": mark["text"], "label": label, "t_count": count},
                        "author": None, "review_summary": None, "summary_reviewed": False,
                        "pdf_page": pdf_page, "printed_page": grid.printed_page(chars), "bbox": bounds,
                        "requires_title_review": True, "source_url": None, "checked_at": None})
    return reviews, rejected


def extract(path, week, library_file_id=None):
    import pdfplumber
    path = pathlib.Path(path)
    raw = path.read_bytes()
    if not raw or len(raw) > 100 * 1024 * 1024:
        raise ValueError("PDF size invalid")
    start, end = grid.issue_range(week)
    digest = hashlib.sha256(raw).hexdigest()
    report = {"schema_version": 1, "kind": "telerama_editorial", "week": week,
              "range": {"from": start.isoformat(), "to": end.isoformat()},
              "source": {"filename": path.name, "sha256": digest, "bytes": len(raw)},
              "reviews": [], "pages": [], "coverage_certified": False, "publication_ready": False,
              "warnings": ["Daily-review inclusion is not a positive recommendation; low marks remain visible.",
                           "Native Telerama marks are not IMDb or SensCritique scores.",
                           "Summaries require reading and review; no article body is exported."]}
    if library_file_id:
        report["source"]["library_file_id"] = library_file_id
    with pdfplumber.open(path) as document:
        if not 1 <= len(document.pages) <= 400:
            raise ValueError("PDF page count invalid")
        report["source"]["pages"] = len(document.pages)
        first_chars = grid.dedupe_chars(document.pages[0].chars)
        cover = "\n".join(grid.compose(line) for line in grid.line_groups(first_chars))
        if grid.cover_range(cover) != (start, end):
            raise ValueError("PDF cover does not match target week")
        publication_date = grid.cover_publication_date(cover)
        if publication_date:
            report["source"]["publication_date"] = publication_date
        index = grid.poppler_index(path, len(document.pages))
        # Only a daily non-grid page with an explicit weekday/day header, or
        # its immediately preceding TNT review page, supplies a civil date.
        targets = {}
        for number, page in enumerate(document.pages, 1):
            if index and not re.search(r"\b(" + "|".join(grid.DAYS) + r")\s+\d{1,2}\b", index[number - 1]):
                continue
            chars = grid.dedupe_chars(page.chars)
            date, error = grid.date_header(chars, start, end)
            if date and not error and not grid.grid_columns(chars) and header_candidates(chars):
                targets[number] = date
                if number > 1:
                    previous = document.pages[number - 2]
                    prev_chars = grid.dedupe_chars(previous.chars)
                    top = " ".join(grid.compose(line) for line in grid.line_groups([c for c in prev_chars if c["top"] < 40]))
                    prev_date, prev_error = grid.date_header(prev_chars, start, end)
                    if top.strip() == "TNT" and not prev_error and not grid.grid_columns(prev_chars) and (not prev_date or prev_date == date):
                        targets[number - 1] = date
            page.flush_cache()
        for number, nominal in sorted(targets.items()):
            page = document.pages[number - 1]
            chars = grid.dedupe_chars(page.chars)
            reviews, rejected = page_reviews(chars, nominal, number, page.width)
            outside = [review for review in reviews if not start.isoformat() <= review["date"] <= end.isoformat()]
            retained = [review for review in reviews if review not in outside]
            for review in retained:
                review["source_ref"] = "sha256:" + digest
            report["reviews"].extend(retained)
            report["pages"].append({"pdf_page": number, "width": float(page.width), "height": float(page.height),
                                    "grid_date": nominal.isoformat(), "status": "partial" if rejected else "parsed",
                                    "reviews_count": len(retained), "rejected": rejected, "outside_issue_count": len(outside)})
            page.flush_cache()
    report["summary"] = {"reviews": len(report["reviews"]), "daily_pages": len(report["pages"]),
                         "days": len({review["grid_date"] for review in report["reviews"]}),
                         "summaries_reviewed": 0, "rejected": sum(len(page["rejected"]) for page in report["pages"])}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--week", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--library-file-id")
    args = parser.parse_args()
    out = pathlib.Path(args.output)
    if out.exists():
        parser.error("output already exists")
    result = extract(args.pdf, args.week, args.library_file_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
