"""Regenerates app/templates/blank.vsdx.

`vsdx.VisioFile(path)` can only open an *existing* file — there's no "create
blank" constructor — so every export in vsdx_builder.py starts from this
checked-in template. It's derived from the `vsdx` library's own bundled
`media.vsdx` (its one demo shape and connects stripped out) rather than
hand-built from scratch, because a from-scratch minimal OOXML zip is missing
pieces (windows.xml, docProps/thumbnail.emf, StyleSheets/theme/font tables)
that `vsdx.Connect.create()` reads/mutates when it lazily bootstraps the
connector master on first use — see the docstring in vsdx_builder.py.

Run this only if blank.vsdx needs to be regenerated (e.g. after a `vsdx`
library upgrade): `python -m app.templates.generate_blank_template`
"""

from __future__ import annotations

import os
from pathlib import Path

import vsdx

OUTPUT_PATH = Path(__file__).parent / "blank.vsdx"


def generate() -> None:
    media_path = Path(os.path.dirname(vsdx.__file__)) / "media" / "media.vsdx"

    with vsdx.VisioFile(str(media_path)) as vis:
        page = vis.get_page(0)
        for shape in list(page.child_shapes):
            shape.remove()
        connects_el = page.xml.getroot().find(f"{vsdx.namespace}Connects")
        if connects_el is not None:
            page.xml.getroot().remove(connects_el)
        vis.save_vsdx(str(OUTPUT_PATH))

    # Round-trip sanity check before we trust the output.
    with vsdx.VisioFile(str(OUTPUT_PATH)) as check:
        page = check.get_page(0)
        assert len(page.child_shapes) == 0, "blank template should have zero shapes"
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    generate()
