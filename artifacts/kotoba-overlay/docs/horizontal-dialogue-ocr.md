# Horizontal Japanese dialogue OCR

The game-specific capture path supports only left-to-right, horizontal Japanese
dialogue blocks. It loads `jpn` with Tesseract's `SINGLE_BLOCK` segmentation.
There is no vertical layout selector, vertical recognition pass, or automatic
orientation pass. The build no longer downloads or bundles the vertical Japanese
model, and preparation deletes its stale generated copies.

This is a processing scope, not an orientation classifier: vertical text within
a captured region could still produce incorrect horizontal OCR output. Crop
around the horizontal NPC dialogue rather than the entire game display.

## Developer-specified target fonts

The developer identifies the following game dialogue font files:

| File | Family |
| --- | --- |
| `msgothic.ttc` | MS Gothic |
| `malgun.ttf` | Malgun Gothic |
| `simsun.ttc` | SimSun |

These supersede the earlier MS Gothic/MS Mincho target list. The app does not
install, download, or redistribute these proprietary font files.

## What the current engine can and cannot do

Tesseract recognizes rasterized glyphs using trained language data. Font files
are not OCR models, and it has no runtime font-family whitelist. The bundled
Japanese model is therefore **not restricted to, or newly trained on, these
three fonts**. Rendering the app UI in these fonts would not change recognition.
No new font-specific speed or accuracy improvement has been measured.

The previous horizontal setting already loaded only `jpn`. Removing the
vertical option prevents an inappropriate mode and reduces packaged assets;
it does not establish a speed improvement over that existing horizontal mode.

## Deferred follow-up: font-focused model training

The developer requested this as a potential task for later development, not
part of the current Windows release. The follow-up has two stages: establish
a verified training workflow, then compare the tuned model against standard
Japanese OCR using unseen dialogue and measured recognition latency.

A font-focused model would require legally usable font inputs, verified
training tools, labeled horizontal dialogue examples, and held-out evaluation
against the current model. Synthetic glyph matching or unvalidated preprocessing
must not replace the current recognizer or be described as successful training.
Even a specialized model would not reliably identify or reject every other font.
