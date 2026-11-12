# Usage guide

1. Pick a converter from the sidebar (Documents, Images, Audio, Video, Archive), **All Tools**, or the search box on Home.
2. Drag files into the drop zone or press **Browse Files**. You can add one file or many. Invalid files (wrong type, empty, renamed/corrupt, too large, too big for your device) are listed with the reason and are never processed.
3. Choose settings:
   * **Recommended** – nothing to configure; the card tells you what will be used.
   * **Advanced** – only the options that make sense for this converter (quality, resize, DPI, page range, bitrate, resolution, OCR, table detection, …). *Reset to defaults* restores them.
4. Press **Convert** (or **Convert all**). Each file has its own status and progress bar plus an overall bar. A failed file shows an error and a **Retry** button; the others continue. **Cancel** stops the batch.
5. Download single results with **Download**, or everything with **Download All as ZIP**.
   By default a result is released from memory once downloaded (Settings → *Release a result…*). Press **Clear Files** to drop everything.

Tips
* Images → PDF: enable *Merge all images into one PDF* in Advanced to get one multi-page document.
* PDF → Word/Excel/PowerPoint: works on PDFs that contain real text. Scanned PDFs need OCR (shown as unavailable if the OCR engine is not part of the deployment).
* ZIP: *Extract ZIP* shows the contents first; untick files you do not want. Paths such as `../x` are neutralised.
* Large video/audio: prefer a desktop browser, close other tabs, and use the Recommended settings (they lower resolution for files above 200 MB).
