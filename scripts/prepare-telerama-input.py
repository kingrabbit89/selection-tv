#!/usr/bin/env python3
"""Prepare both optional inputs from a PDF, deriving its week from the cover.

Run in a new local directory. Review headings and add short attributed
paraphrases before saving these inputs through a normal protected GitHub PR.
"""
import argparse
import datetime as dt
import importlib.util
import json
import pathlib


def module(filename, name):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def detect_week(path, reference_pdfs=None):
    grid = module("editorial-telerama-pdf.py", "telerama_grid_prepare")
    with grid.open_pdf(path, reference_pdfs) as pdf:
        if not pdf.pages:
            raise ValueError("empty PDF")
        text = "\n".join(grid.compose(line) for line in grid.line_groups(grid.dedupe_chars(pdf.pages[0].chars)))
        start, _ = grid.cover_range(text)
    year, week, _ = (start + dt.timedelta(days=2)).isocalendar()
    return f"{year}-S{week:02d}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--week")
    parser.add_argument("--library-file-id")
    parser.add_argument("--reference-pdf", action="append", default=[], metavar="PDF",
                        help="Earlier text issue, needed only when this PDF has no text layer; repeat it")
    args = parser.parse_args()
    out = pathlib.Path(args.out_dir)
    if out.exists():
        parser.error("output directory must be new")
    try:
        week = detect_week(args.pdf, args.reference_pdf)
    except (ValueError, RuntimeError) as exc:
        parser.exit(2, f"error: {exc}\n")
    if args.week and args.week != week:
        parser.error("PDF cover does not match requested week")
    grid = module("editorial-telerama-pdf.py", "telerama_grid_prepare")
    editorial = module("editorial-telerama-editorial.py", "telerama_reviews_prepare")
    schedule = grid.extract_pdf(args.pdf, week, args.library_file_id, reference_pdfs=args.reference_pdf)
    reviews = editorial.extract(args.pdf, week, args.library_file_id, args.reference_pdf)
    if schedule["source"]["sha256"] != reviews["source"]["sha256"]:
        raise ValueError("PDF changed during preparation")
    summary = {"week": week, "range": schedule["range"], "source_sha256": schedule["source"]["sha256"],
               "schedule": schedule["summary"], "editorial": reviews["summary"],
               "next_action": "Review titles and write short attributed review paraphrases; save both inputs in GitHub.",
               "publication_ready": False, "coverage_certified": False}
    out.mkdir(parents=True)
    for filename, data in (("telerama.json", schedule), ("telerama-editorial.json", reviews), ("summary.json", summary)):
        (out / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
