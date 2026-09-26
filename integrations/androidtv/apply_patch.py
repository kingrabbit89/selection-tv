#!/usr/bin/env python3
from pathlib import Path
import shutil
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path("upstream").resolve()
HERE = Path(__file__).resolve().parent

def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Patch target not found in {path}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

# 1) Add the isolated Selection TV fragment.
target = ROOT / "app/src/main/java/org/jellyfin/androidtv/ui/selectiontv/SelectionTvFragment.kt"
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(HERE / "SelectionTvFragment.kt", target)

# 2) Register a destination in Jellyfin's existing navigation stack.
dest = ROOT / "app/src/main/java/org/jellyfin/androidtv/ui/navigation/Destinations.kt"
replace_once(
    dest,
    "import org.jellyfin.androidtv.ui.search.SearchFragment\n",
    "import org.jellyfin.androidtv.ui.search.SearchFragment\n"
    "import org.jellyfin.androidtv.ui.selectiontv.SelectionTvFragment\n",
)
replace_once(
    dest,
    "\tval home = fragmentDestination<HomeFragment>()\n",
    "\tval home = fragmentDestination<HomeFragment>()\n"
    "\tval selectionTv = fragmentDestination<SelectionTvFragment>()\n",
)

# 3) Add one toolbar button. Nothing else in the Jellyfin UI is replaced.
toolbar = ROOT / "app/src/main/java/org/jellyfin/androidtv/ui/shared/toolbar/MainToolbar.kt"
replace_once(
    toolbar,
    "\tHome,\n\tSearch,\n",
    "\tHome,\n\tSelectionTv,\n\tSearch,\n",
)
home_button = """\t\t\t\t\tButton(
\t\t\t\t\t\tonClick = {
\t\t\t\t\t\t\tif (activeButton != MainToolbarActiveButton.Search) {
"""
selection_button = """\t\t\t\t\tButton(
\t\t\t\t\t\tonClick = {
\t\t\t\t\t\t\tif (activeButton != MainToolbarActiveButton.SelectionTv) {
\t\t\t\t\t\t\t\tnavigationRepository.navigate(
\t\t\t\t\t\t\t\t\tDestinations.selectionTv,
\t\t\t\t\t\t\t\t\treplace = true,
\t\t\t\t\t\t\t\t)
\t\t\t\t\t\t\t}
\t\t\t\t\t\t},
\t\t\t\t\t\tcolors = if (activeButton == MainToolbarActiveButton.SelectionTv) activeButtonColors else ButtonDefaults.colors(),
\t\t\t\t\t\tcontent = { Text("Sélection TV") }
\t\t\t\t\t)
"""
replace_once(toolbar, home_button, selection_button + home_button)

# 4) Make the experimental APK install alongside the official Jellyfin app.
gradle = ROOT / "app/build.gradle.kts"
replace_once(
    gradle,
    '\t\t\tapplicationIdSuffix = ".debug"\n',
    '\t\t\tapplicationIdSuffix = ".selectiontv"\n',
)
replace_once(
    gradle,
    '\t\t\tresValue("string", "app_name", "@string/app_name_debug")\n',
    '\t\t\tresValue("string", "app_name", "Jellyfin Sélection TV")\n',
)

print("Selection TV Android TV patch applied successfully")
