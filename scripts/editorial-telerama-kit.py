#!/usr/bin/env python3
"""Reading aids for the provided Télérama PDF during a production session.

grid-ratings  native grid marks (T…TTTT, Hélas) printed next to each row
grid-samples  contact sheets of three rows per grid page for the import review
printed       the printed lines (director, country, year, length) of the picks

They read the saved extraction (telerama.json) and the PDF. They never decide,
rank or certify anything; the reviewer still reads the pages.
"""
import argparse
import datetime as dt
import importlib.util
import json
import pathlib

spec = importlib.util.spec_from_file_location("telerama_grid", pathlib.Path(__file__).with_name("editorial-telerama-pdf.py"))
grid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grid)

GRID_MARKS = {"r": "Hélas", "t": "T", "y": "TT", "u": "TTT", "i": "TTTT"}
DAY_NAMES = ("samedi", "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi")


def norm(value):
    return "".join(c for c in str(value or "").lower().replace("’", "'") if c.isalnum())


def mark_for(bbox, icons):
    """The rating glyph on the row's line, at most 70 pt left of its title."""
    near = [c for c in icons if c["text"] in GRID_MARKS and abs(c["top"] - bbox[1]) < 4 and bbox[0] - 70 <= c["x0"] <= bbox[0] + 2]
    return GRID_MARKS[max(near, key=lambda c: c["x0"])["text"]] if near else None


def grid_ratings(report, page_chars):
    """{observation index: mark}; page_chars(pdf_page) returns deduplicated chars."""
    by_page = {}
    for index, observation in enumerate(report["observations"]):
        by_page.setdefault(observation["pdf_page"], []).append(index)
    result = {}
    for page, indexes in sorted(by_page.items()):
        icons = [c for c in page_chars(page) if grid.icon(c)]
        for index in indexes:
            mark = mark_for(report["observations"][index]["bbox"], icons)
            if mark:
                result[str(index)] = mark
    return result


def choose_samples(rows):
    """Three distinct rows of a page: first printed, one in prime time, one at night."""
    rows = sorted(rows, key=lambda r: (r["bbox"][0], r["bbox"][1]))
    if not rows:
        return []
    wanted = [rows[0], next((r for r in rows if "20:30" <= r["start"] <= "22:30"), rows[len(rows) // 2]),
              next((r for r in rows if r.get("overnight")), rows[-1])]
    picked = []
    for row in wanted + rows:
        if row not in picked:
            picked.append(row)
        if len(picked) == 3:
            break
    return picked


def pick_date(pick, start):
    if pick.get("date"):
        return pick["date"]
    return (start + dt.timedelta(days=DAY_NAMES.index(pick["day"]))).isoformat()


def match_pick(report, pick):
    """Index and observation printed at the pick's date and start under its printed title."""
    start = dt.date.fromisoformat(report["range"]["from"])
    date, title = pick_date(pick, start), norm(pick.get("printed") or pick.get("title"))
    for index, observation in enumerate(report["observations"]):
        if observation["date"] == date and observation["start"] == pick["time"] and norm(observation["title"]) == title:
            return index, observation
    return None, None


def load_picks(path):
    data = json.loads(pathlib.Path(path).read_text(encoding="utf8"))
    return data["picks"] if isinstance(data, dict) else data


def run_grid_ratings(args):
    import pdfplumber
    report = json.loads(pathlib.Path(args.report).read_text(encoding="utf8"))
    with pdfplumber.open(args.pdf) as document:
        result = grid_ratings(report, lambda page: grid.dedupe_chars(document.pages[page - 1].chars))
    pathlib.Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    counts = {}
    for mark in result.values():
        counts[mark] = counts.get(mark, 0) + 1
    print(json.dumps({"rated_rows": len(result), "marks": counts, "output": args.out}, ensure_ascii=False))


def sheet_font(size):
    from PIL import ImageFont
    for name in ("arial.ttf", "DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def run_grid_samples(args):
    import pypdfium2 as pdfium
    from PIL import Image, ImageDraw
    report = json.loads(pathlib.Path(args.report).read_text(encoding="utf8"))
    out = pathlib.Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(args.pdf)
    font = sheet_font(16)
    pages_by_date = {}
    for page in report["pages"]:
        if page.get("grid_date"):
            pages_by_date.setdefault(page["grid_date"], []).append(page)
    indexed = list(enumerate(report["observations"]))
    samples = []
    for date, pages in sorted(pages_by_date.items()):
        sheet = Image.new("RGB", (1260, 370 * len(pages)), "white")
        draw = ImageDraw.Draw(sheet)
        for row_index, page in enumerate(pages):
            rows = [dict(o, index=i) for i, o in indexed if o["pdf_page"] == page["pdf_page"]]
            image = document[page["pdf_page"] - 1].render(scale=3).to_pil()
            for column, row in enumerate(choose_samples(rows)):
                x, y = column * 420, row_index * 370
                draw.multiline_text((x + 8, y + 8), f"p.{page['pdf_page']} {row['date']} {row['start']}\n{row['channel']}\n{row['title']}",
                                    font=font, fill="black", spacing=4)
                left, top = max(0, row["bbox"][0] - 12), max(0, row["bbox"][1] - 24)
                right, bottom = min(page["width"], max(row["bbox"][2] + 5, left + 116)), min(page["height"], top + 86)
                crop = image.crop((int(left * 3), int(top * 3), int(right * 3), int(bottom * 3)))
                if crop.width > 410:
                    crop.thumbnail((410, 268))
                sheet.paste(crop, (x + 5, y + 95))
                samples.append({"observation": f"/observations/{row['index']}", **{k: row[k] for k in ("pdf_page", "date", "start", "channel", "title", "bbox")}})
        sheet.save(out / f"grid-{date}.png")
    (out / "samples.json").write_text(json.dumps(samples, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    print(json.dumps({"samples": len(samples), "pages": sum(len(p) for p in pages_by_date.values()), "output": str(out)}))


def run_printed(args):
    import pdfplumber
    report = json.loads(pathlib.Path(args.report).read_text(encoding="utf8"))
    result = []
    with pdfplumber.open(args.pdf) as document:
        for pick in load_picks(args.picks):
            index, observation = match_pick(report, pick)
            if observation is None:
                result.append({"pick": pick, "error": "no printed row at this date, start and title"})
                continue
            page, box = document.pages[observation["pdf_page"] - 1], observation["bbox"]
            crop = page.crop((max(0, box[0] - 25), box[1] - 2, min(page.width, box[0] + 175), min(page.height, box[1] + 62)))
            text = " ".join((crop.extract_text() or "").split())
            result.append({"pick": pick, "observation": f"/observations/{index}", "pdf_page": observation["pdf_page"],
                           "channel": observation["channel"], "printed": text[:330]})
    pathlib.Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    missing = [row["pick"] for row in result if "error" in row]
    print(json.dumps({"picks": len(result), "not_found": missing, "output": args.out}, ensure_ascii=False))
    return 1 if missing else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("grid-ratings", "grid-samples", "printed"):
        command = commands.add_parser(name)
        command.add_argument("--pdf", required=True)
        command.add_argument("--report", required=True, help="telerama.json of the same PDF")
        if name == "grid-samples":
            command.add_argument("--out-dir", required=True)
        else:
            command.add_argument("--out", required=True)
        if name == "printed":
            command.add_argument("--picks", required=True, help="picks.json of the work directory")
    args = parser.parse_args(argv)
    return {"grid-ratings": run_grid_ratings, "grid-samples": run_grid_samples, "printed": run_printed}[args.command](args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
