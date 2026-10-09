#!/usr/bin/env python3
"""Optional, conservative extraction of factual Telerama TV grid entries.

Requires pdfplumber. It reads the supplied PDF, never changes repository data,
and never exports review/article paragraphs, editorial ratings or coverage flags.
Only the observed six-column Graphik grid layout is supported. Other layouts,
image-only pages and ambiguous entries are reported for manual review.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

SCHEMA_VERSION = 1
DAYS = ("LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE")
CLOCK = re.compile(r"^(\d{1,2})\.(\d{2})(?:\s|$)")
CHANNEL_ALIASES = {
    "arte": "Arte", "tv5 monde": "TV5MONDE", "ocs": "Ciné+ OCS",
    "canal+ cinema(s)": "Canal+ Cinéma", "canal+ box ofice": "Canal+ Box Office",
    "canal+ box office": "Canal+ Box Office", "canal+ grand ecran": "Canal+ Grand Écran",
    "cine+ emotion": "Ciné+ Emotion", "13 rue": "13e Rue",
    "rmc lifestory": "RMC Story", "rmc life": "RMC Life", "rmc story": "RMC Story",
}


def normalize_text(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip()


def folded(value):
    return "".join(c for c in unicodedata.normalize("NFKD", normalize_text(value).lower())
                   if not unicodedata.combining(c))


def issue_range(week):
    match = re.fullmatch(r"(\d{4})-S(\d{2})", week or "")
    if not match:
        raise ValueError("week must be YYYY-Sxx")
    try:
        monday = dt.date.fromisocalendar(int(match[1]), int(match[2]), 1)
    except ValueError as exc:
        raise ValueError("invalid ISO week") from exc
    start = monday - dt.timedelta(days=2)
    return start, start + dt.timedelta(days=6)


def cover_range(text):
    text = normalize_text(text)
    match = re.search(r"\bDu\s+(\d{1,2})\s+au\s+(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})\b", text, re.I)
    if not match:
        raise ValueError("the cover has no supported, readable seven-day date range")
    first, last, month, year = map(int, match.groups())
    start, end = dt.date(year, month, first), dt.date(year, month, last)
    if (end - start).days != 6 or start.weekday() != 5:
        raise ValueError("the cover is not a Saturday-to-Friday issue")
    return start, end


def cover_publication_date(text):
    match = re.search(r"\b(" + "|".join(DAYS) + r")\s+(\d{1,2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})\b",
                      normalize_text(text).upper())
    if not match:
        return None
    try:
        value = dt.date(int(match[4]), int(match[3]), int(match[2]))
    except ValueError:
        return None
    return value.isoformat() if DAYS[value.weekday()] == match[1] else None


def white(char):
    value = char.get("non_stroking_color")
    return isinstance(value, (tuple, list)) and len(value) == 3 and all(float(v) > .98 for v in value)


def graphik_bold(char):
    return "Graphik-Bold" in char.get("fontname", "") and float(char.get("size", 0)) >= 6


def icon(char):
    return "TeleramaIconsPrint" in char.get("fontname", "")


def dedupe_chars(chars):
    """Linear bounded glyph deduplication, with style/color preserved."""
    seen, result = set(), []
    for char in chars:
        if not char.get("upright", True):
            continue
        key = (char.get("text"), round(char["x0"], 2), round(char["top"], 2),
               round(char.get("size", 0), 2), char.get("fontname"),
               repr(char.get("non_stroking_color")))
        if key not in seen:
            seen.add(key)
            result.append(char)
    return result


def line_groups(chars):
    # The custom symbol font has a different ascent, but shares the text baseline.
    groups = collections.defaultdict(list)
    for char in chars:
        matrix = char.get("matrix")
        baseline = float(matrix[5]) if matrix else -float(char["bottom"])
        groups[round(baseline, 1)].append(char)
    return [sorted(groups[key], key=lambda c: c["x0"])
            for key in sorted(groups, reverse=True)]


def compose(chars):
    result, previous = [], None
    for char in sorted(chars, key=lambda c: c["x0"]):
        value = char.get("text", "")
        if previous and char["x0"] - previous["x1"] > max(1.1, .2 * float(char.get("size", 6.5))):
            result.append(" ")
        result.append(value)
        previous = char
    return normalize_text("".join(result))


def bbox(chars):
    return [round(min(c["x0"] for c in chars), 2), round(min(c["top"] for c in chars), 2),
            round(max(c["x1"] for c in chars), 2), round(max(c["bottom"] for c in chars), 2)]


def canonical_channel(printed):
    clean = normalize_text(printed)
    return CHANNEL_ALIASES.get(folded(clean), clean)


def split_header_line(chars):
    groups, current, previous = [], [], None
    for char in sorted(chars, key=lambda c: c["x0"]):
        if previous and char["x0"] - previous["x1"] > 12:
            if current:
                groups.append(current)
            current = []
        current.append(char)
        previous = char
    if current:
        groups.append(current)
    return groups


def grid_columns(chars):
    header = [c for c in chars if c.get("text", "").strip() and 30 <= c["top"] <= 55 and white(c)
              and graphik_bold(c) and 8 <= c.get("size", 0) <= 9]
    lines = line_groups(header)
    if not lines:
        return None
    groups = split_header_line(lines[0])
    if len(groups) != 6:
        return None
    starts = [min(c["x0"] for c in group) for group in groups]
    pitches = [starts[i + 1] - starts[i] for i in range(5)]
    if not all(85 <= width <= 100 for width in pitches):
        return None
    pitch = sum(pitches) / len(pitches)
    return [(start - 1, starts[i + 1] - 3 if i < 5 else start + pitch - 3)
            for i, start in enumerate(starts)]


def date_header(chars, start, end):
    candidates = set()
    found, invalid = False, False
    for line in line_groups([c for c in chars if c["top"] < 55]):
        text = compose([c for c in line if not icon(c)])
        for match in re.finditer(r"\b(" + "|".join(DAYS) + r")\s+(\d{1,2})\b", text):
            found, matched = True, False
            day = int(match[2])
            for offset in range(7):
                date = start + dt.timedelta(days=offset)
                if date.day == day and DAYS[date.weekday()] == match[1]:
                    candidates.add(date)
                    matched = True
            if not matched:
                invalid = True
    if found and invalid:
        return None, "date header does not match the issue range and weekday"
    if len(candidates) > 1:
        return None, "conflicting date headers"
    return (next(iter(candidates)), None) if candidates else (None, None)


def printed_page(chars):
    values = []
    for line in line_groups([c for c in chars if c["top"] > 730]):
        text = compose(line)
        if "Télérama" not in text:
            continue
        match = re.search(r"^(\d{1,3})\s+Télérama\b", text)
        if not match:
            match = re.search(r"Télérama\s+\d+\s+\d{2}/\d{2}/\d{2}\s+(\d{1,3})$", text)
        if match:
            values.append(int(match[1]))
            continue
        for fragment in split_header_line([c for c in line if graphik_bold(c)]):
            value = compose(fragment)
            if re.fullmatch(r"\d{1,3}", value):
                values.append(int(value))
    return values[0] if len(set(values)) == 1 else None


def text_grid_candidate(text):
    """Optional Poppler triage only. Accepted facts still come from PDF glyphs."""
    signatures = (
        r"TF1\s+.*France 2\s+.*France 3\s+.*France 4\s+.*France 5\s+.*Arte\b",
        r"M6\s+.*LCP\s+.*W9\s+.*TMC\s+.*Gulli\s+.*L[’']Équipe\b",
        r"Canal\+\s+.*Canal\+\s+.*Canal\+\s+.*OCS\s+.*Ciné\+\s+.*Ciné\+",
        r"TCM\s+.*Mezzo\s+.*Histoire TV\s+.*Paris\s+.*RTL9\s+.*TV5\b",
    )
    return any(re.search(pattern, text[:2500]) for pattern in signatures)


def text_date_header(text, start):
    candidates = set()
    found, invalid = False, False
    for match in re.finditer(r"\b(" + "|".join(DAYS) + r")\s+(\d{1,2})\b", text[:700]):
        found, matched = True, False
        for offset in range(7):
            date = start + dt.timedelta(days=offset)
            if date.day == int(match[2]) and DAYS[date.weekday()] == match[1]:
                candidates.add(date)
                matched = True
        if not matched:
            invalid = True
    if found and invalid:
        return None, "date header does not match the issue range and weekday"
    if len(candidates) > 1:
        return None, "conflicting date headers"
    return (next(iter(candidates)), None) if candidates else (None, None)


def poppler_index(path, expected_pages):
    executable = shutil.which("pdftotext")
    if not executable:
        return None
    try:
        result = subprocess.run([executable, "-layout", str(path), "-"], check=True,
                                capture_output=True, timeout=90)
        pages = result.stdout.decode("utf-8", errors="replace").split("\f")
        if len(pages) == expected_pages + 1 and not pages[-1].strip():
            pages.pop()
        return pages if len(pages) == expected_pages else None
    except (subprocess.SubprocessError, OSError):
        return None


def header_sections(lines):
    """A section starts with white channel lettering, never with a time band."""
    starts = []
    i = 0
    while i < len(lines):
        selected = [c for c in lines[i] if white(c) and graphik_bold(c)
                    and 8 <= c.get("size", 0) <= 9]
        text = compose(selected)
        if text and not CLOCK.match(text) and not re.fullmatch(r"[T\s]+", text):
            combined = list(selected)
            j = i + 1
            while j < len(lines):
                other = [c for c in lines[j] if white(c) and graphik_bold(c)
                         and 8 <= c.get("size", 0) <= 9]
                other_text = compose(other)
                if not other_text or CLOCK.match(other_text) or abs(lines[j][0]["top"] - lines[j - 1][0]["top"]) > 10:
                    break
                combined += other
                j += 1
            label = " ".join(compose([c for c in row if c in combined]) for row in lines[i:j])
            starts.append({"index": i, "body_index": j, "channel_printed": normalize_text(label), "chars": combined})
            i = j
        else:
            i += 1
    return starts


def time_row(line, left):
    plain = [c for c in line if not icon(c)]
    text = compose(plain)
    match = CLOCK.match(text)
    if not match or not plain or abs(min(c["x0"] for c in plain) - left) > 3:
        return None
    digits = [c for c in plain if c.get("text", "").strip()][:len(match[1]) + 3]
    if not all(graphik_bold(c) for c in digits):
        return None
    hour, minute = int(match[1]), int(match[2])
    if hour > 23 or minute > 59:
        return {"error": "invalid time", "text": match[0].strip()}
    # Position after the printed time lets us extract an inline bold title.
    ending = max(c["x1"] for c in digits)
    return {"minute": hour * 60 + minute, "start": f"{hour:02}:{minute:02}", "end_x": ending}


def title_from_segment(lines, time):
    title_chars, title_lines, started, previous_top = [], [], False, None
    genre_icons = set()
    for index, line in enumerate(lines):
        line_top = min(c["top"] for c in line)
        if started and previous_top is not None and line_top - previous_top > 13:
            break
        arrows = [c["x0"] for c in line if icon(c) and c.get("text") == "2"]
        selected = [c for c in line if graphik_bold(c) and not white(c) and not icon(c)]
        if arrows:
            selected = [c for c in selected if c["x0"] < min(arrows)]
        if index == 0:
            selected = [c for c in selected if c["x0"] >= time["end_x"] - .1]
        text = compose(selected)
        if text:
            if len(text) > 180 or re.search(r"\b(LIRE|Télérama)\b", text):
                break
            title_chars.extend(selected)
            title_lines.append(text)
            started = True
            previous_top = line_top
        elif started:
            # Only the first title run; never take a subsequent review or caption.
            genre_icons.update(c.get("text", "") for c in line if icon(c))
            break
        genre_icons.update(c.get("text", "") for c in line if icon(c))
        if selected:
            last_title_x = max(c["x1"] for c in selected)
            trailing_plain = [c for c in line if not icon(c) and not white(c)
                              and not graphik_bold(c) and c.get("text", "").strip()
                              and c["x0"] >= last_title_x]
            if trailing_plain:
                break
    title = normalize_text(" ".join(title_lines))
    if not title or len(title) > 240:
        return None, None, None
    # f/d are factual Film/Documentary pictograms, not the editorial rating marks.
    genre = "Film" if "f" in genre_icons else "Documentaire" if "d" in genre_icons else None
    return title, genre, bbox(title_chars)


def extract_grid(chars, nominal_date, page_number, print_page, source_ref, scope="films-docs"):
    columns = grid_columns(chars)
    if not columns:
        return None
    observations, rejected, channels = [], [], []
    for column_index, (left, right) in enumerate(columns):
        lines = line_groups([c for c in chars if left <= c["x0"] <= right and c["top"] < 738])
        sections = header_sections(lines)
        for section_index, section in enumerate(sections):
            channel_printed = section["channel_printed"]
            channel = canonical_channel(channel_printed)
            channels.append(channel)
            stop = sections[section_index + 1]["index"] if section_index + 1 < len(sections) else len(lines)
            rows = []
            for index in range(section["body_index"], stop):
                time = time_row(lines[index], left)
                if time is not None:
                    rows.append((index, time))
            previous, day_offset, timeline_valid = None, 0, True
            for row_index, (index, time) in enumerate(rows):
                rejection = {"column": column_index + 1, "channel": channel, "bbox": bbox(lines[index])}
                if time.get("error"):
                    rejected.append({**rejection, "reason": time["error"], "time": time["text"]})
                    timeline_valid = False
                    continue
                minutes = time["minute"]
                if previous is None and minutes < 300:
                    timeline_valid = False
                if previous is not None and minutes < previous:
                    if previous >= 18 * 60 and minutes < 6 * 60 and day_offset == 0:
                        day_offset = 1
                    else:
                        timeline_valid = False
                previous = minutes
                if not timeline_valid:
                    rejected.append({**rejection, "reason": "ambiguous chronological sequence", "start": time["start"]})
                    continue
                last = rows[row_index + 1][0] if row_index + 1 < len(rows) else stop
                title, genre, title_bbox = title_from_segment(lines[index:last], time)
                if not title:
                    rejected.append({**rejection, "reason": "no unambiguous styled title", "start": time["start"]})
                    continue
                if scope == "films-docs" and genre is None:
                    continue
                if folded(title).startswith("programmes de nuit"):
                    continue
                date = nominal_date + dt.timedelta(days=day_offset)
                observations.append({
                    "date": date.isoformat(), "start": time["start"], "channel": channel,
                    "channel_printed": channel_printed, "title": title,
                    "genre_hint": genre, "source": "Télérama magazine fourni",
                    "source_type": "telerama_pdf", "source_ref": source_ref, "source_url": None,
                    "pdf_page": page_number, "printed_page": print_page,
                    "bbox": title_bbox, "grid_date": nominal_date.isoformat(),
                    "overnight": bool(day_offset), "checked_at": None,
                    "source_independence": None, "requires_broadcast_confirmation": True,
                    "requires_title_review": True,
                })
    return {"observations": observations, "rejected": rejected, "channels": sorted(set(channels))}


def extract_pdf(pdf_path, week, library_file_id=None, scope="films-docs"):
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError("pdfplumber is required; install with python3 -m pip install pdfplumber") from exc
    if scope not in ("films-docs", "all-programmes"):
        raise ValueError("unsupported scope")
    start, end = issue_range(week)
    path = Path(pdf_path)
    raw = path.read_bytes()
    if len(raw) > 100 * 1024 * 1024:
        raise ValueError("PDF exceeds the 100 MiB import limit")
    digest = hashlib.sha256(raw).hexdigest()
    source_ref = "sha256:" + digest
    report = {"schema_version": SCHEMA_VERSION, "kind": "telerama_pdf", "week": week,
              "range": {"from": start.isoformat(), "to": end.isoformat()},
              "source": {"filename": path.name, "sha256": digest, "bytes": len(raw)},
              "observations": [], "pages": [], "coverage_certified": False,
              "publication_ready": False, "scope": scope,
              "warnings": ["Printed schedules require current broadcast confirmation.",
                           "The first Saturday's preceding-night programmes are not supplied by this issue.",
                           "No review paragraphs or editorial rating symbols are imported."]}
    if library_file_id:
        report["source"]["library_file_id"] = library_file_id
    with pdfplumber.open(path) as document:
        report["source"]["pages"] = len(document.pages)
        if not document.pages or len(document.pages) > 400:
            raise ValueError("unsupported PDF page count")
        first_chars = dedupe_chars(document.pages[0].chars)
        text = "\n".join(compose(line) for line in line_groups(first_chars))
        actual_start, actual_end = cover_range(text)
        if (actual_start, actual_end) != (start, end):
            raise ValueError(f"PDF cover {actual_start} to {actual_end} does not match {week} ({start} to {end})")
        publication_date = cover_publication_date(text)
        if publication_date:
            report["source"]["publication_date"] = publication_date
        text_index = poppler_index(path, len(document.pages))
        report["parser"] = {"layout": "telerama_six_column_graphik_v1",
                             "text_triage": "pdftotext" if text_index else "none",
                             "facts": "pdfplumber_glyph_positions_and_styles"}
        nominal_date, date_context_error, seen = None, None, set()
        for number, page in enumerate(document.pages, 1):
            if text_index:
                indexed_date, indexed_error = text_date_header(text_index[number - 1], start)
                if indexed_date:
                    nominal_date = indexed_date
                    date_context_error = None
                if indexed_error:
                    nominal_date = None
                    date_context_error = indexed_error
                if not text_grid_candidate(text_index[number - 1]):
                    report["pages"].append({"pdf_page": number, "width": float(page.width),
                                            "height": float(page.height), "status": "not_supported_grid",
                                            "observations_count": 0})
                    page.flush_cache()
                    continue
            chars = first_chars if number == 1 else dedupe_chars(page.chars)
            header_date, header_error = date_header(chars, start, end)
            if header_date:
                nominal_date = header_date
                date_context_error = None
            if header_error:
                nominal_date = None
                date_context_error = header_error
            columns = grid_columns(chars)
            if not columns:
                report["pages"].append({"pdf_page": number, "width": float(page.width), "height": float(page.height), "status": "not_supported_grid",
                                        "observations_count": 0})
                page.flush_cache()
                continue
            if date_context_error or nominal_date is None:
                report["pages"].append({"pdf_page": number, "width": float(page.width), "height": float(page.height), "status": "rejected",
                                        "errors": [date_context_error or "no preceding date header"], "observations_count": 0})
                page.flush_cache()
                continue
            print_number = printed_page(chars)
            grid = extract_grid(chars, nominal_date, number, print_number, source_ref, scope)
            accepted, outside = 0, 0
            for observation in grid["observations"]:
                if not start.isoformat() <= observation["date"] <= end.isoformat():
                    outside += 1
                    continue
                key = (observation["date"], observation["start"], observation["channel"], folded(observation["title"]))
                if key in seen:
                    continue
                seen.add(key)
                report["observations"].append(observation)
                accepted += 1
            report["pages"].append({"pdf_page": number, "printed_page": print_number,
                                    "width": float(page.width), "height": float(page.height),
                                    "status": "partial" if grid["rejected"] else "parsed",
                                    "grid_date": nominal_date.isoformat(), "channels": grid["channels"],
                                    "observations_count": accepted, "outside_issue_count": outside,
                                    "rejected_entries": grid["rejected"]})
            page.flush_cache()
    report["observations"].sort(key=lambda item: (item["date"], item["channel"], item["start"], item["title"]))
    parsed = [page for page in report["pages"] if page["status"] in ("parsed", "partial")]
    report["summary"] = {"observations": len(report["observations"]), "grid_pages": len(parsed),
                          "days": len({item["date"] for item in report["observations"]}),
                          "channels": len({item["channel"] for item in report["observations"]}),
                          "rejected_entries": sum(len(page.get("rejected_entries", [])) for page in parsed),
                          "outside_issue_entries": sum(page.get("outside_issue_count", 0) for page in parsed)}
    if not parsed or not report["observations"]:
        report["warnings"].append("No supported factual TV grid entries were extracted; use a manual or OCR-assisted review.")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", help="Path to the supplied Telerama PDF (not published)")
    parser.add_argument("--week", required=True, help="Issue ID, e.g. 2026-S42")
    parser.add_argument("--output", required=True, help="New report JSON path")
    parser.add_argument("--library-file-id")
    parser.add_argument("--scope", choices=("films-docs", "all-programmes"), default="films-docs")
    args = parser.parse_args(argv)
    target = Path(args.output)
    if target.exists():
        parser.error("output already exists; choose a new path")
    try:
        report = extract_pdf(args.pdf, args.week, args.library_file_id, args.scope)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("x", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    except (ValueError, RuntimeError, OSError) as exc:
        parser.exit(2, f"error: {exc}\n")
    print(json.dumps({"output": str(target), **report["summary"], "publication_ready": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
