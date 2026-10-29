# MHFZ dialogue font OCR: standard recognizer and historical evaluation

## Scope and status

The developer identifies **MS Gothic Regular and MS Mincho Regular** as target
dialogue fonts. The developer has withdrawn the custom-training and testing
requirement and requests standard-font recognition instead. Additional samples,
font identification and per-font benchmarks are not prerequisites for this
revised scope.

The application retains the standard bundled Japanese Tesseract recognizer
(`jpn` for horizontal dialogue), which recognizes pixels rather than loading
installed fonts. Tesseract does not accept MS Gothic or MS Mincho font files as
recognition models and has no runtime font-family selector. These font names
describe the intended input, not a font-specific recognition setting or a
verified accuracy guarantee. Installing fonts or changing the application's
display font would not specialize the OCR model.

**No custom neural OCR model has been trained or shipped.** The application still
uses its existing Japanese Tesseract model. An experimental preprocessing
candidate is deliberately confined to developer scripts because it regressed
on held-out images.

## Local corpus

- Ten user-supplied NPC dialogue screenshots; seven development, three held out.
- User reports gameplay at 1920 × 1080 with 100% Windows scaling. Uploaded PNGs
  are 2553–2559 × 1438; treat them as the actual benchmark input dimensions,
  not proof of pixel-perfect native-resolution captures.
- Provisional Japanese transcriptions were made visually by the assistant and
  are **not user-verified ground truth**.
- The green game cursor obscures some characters. Removing the green pixels
  cannot reconstruct the hidden strokes; training must exclude occluded lines.
- Screenshots, crops, labels and raw results remain local under
  `generated-artifacts/mhfz-ocr/`, excluded from Git and deployment.
- Local labels currently target both font families but sample-specific font
  labels are unknown. Do not claim balanced font coverage.

## Comparison

### Additional font references

Two additional user-supplied images are font previews, not native gameplay
captures. The user identifies the first as MS Gothic Regular and the second
as MS Mincho Regular. The first preview's visible title agrees with MS Gothic;
the second visibly reads **AppliMincho Regular**, leaving its identification
as MS Mincho unresolved.

These references are 399 × 336 and 666 × 460 pixels and display the same sample
passage. Neither establishes the font used in any of the ten gameplay captures,
and neither is an independent held-out dialogue sample. Keep them outside the
training and validation splits pending provenance clarification; do not infer
MS Mincho coverage from a visually similar serif font. No font binaries were
provided or are needed for collecting game screenshots.

Under the original training proposal, fresh gameplay, reviewed transcripts and
unseen validation dialogue would have been required. That proposal is no longer
being pursued at the developer's request. The font-preview uploads remain
references only; no private screenshots or Microsoft font files are bundled or
published as part of this work.

### Historical preprocessing results

Both variants use the same normalized dialogue-body crop. The baseline
approximates the existing manual-region scaling/gray-contrast behavior using
Sharp and Tesseract.js; it is **not** a measurement of the complete browser
capture pipeline, native gameplay, or full-screen OCR.

The candidate locates horizontal text bands and recognizes each separately.
Its deterministic bilinear grayscale input code is shared with the benchmark.
Character error rate (CER) uses edit distance after NFKC normalization, removing
spaces and punctuation while retaining letters and numbers. These scores are
therefore not exact punctuation/layout accuracy.

| Split | Characters | Baseline errors / CER | Candidate errors / CER |
| --- | ---: | ---: | ---: |
| Development (7 screenshots) | 403 | 71 / 17.62% | 43 / 10.67% |
| Held out (3 screenshots) | 150 | 28 / 18.67% | 33 / 22.00% |

**Decision:** reject the candidate for application use. Development improvement
does not outweigh a regression on the reserved screenshots. Those screenshots
are now an observed validation set, not a fresh test set for further tuning.

## Reproduce

Use Node 22.18+ or 24 and the existing workspace dependencies:

```sh
node artifacts/kotoba-overlay/scripts/benchmark-mhfz-ocr.mjs \
  generated-artifacts/mhfz-ocr/labels.json attached_assets train
node artifacts/kotoba-overlay/scripts/benchmark-mhfz-ocr.mjs \
  generated-artifacts/mhfz-ocr/labels.json attached_assets holdout
node --test artifacts/kotoba-overlay/scripts/mhfz-ocr-experiment.test.mjs
```

The labels file contains `train` and `holdout` arrays with `{id, text}` records.
Screenshot basenames start with the matching `id_`. Optional `filenameIncludes`
disambiguates captures; `targetFonts` lists target families and
`sampleFontsVerified` records whether font identification has been confirmed.
The script uses local Japanese language data and never calls OpenAI.

## Historical training proposal — not part of the current scope

The following steps are retained as context only. Do not resume them or request
more samples unless the developer explicitly reopens custom model training.

1. Review the provisional Japanese transcriptions, identify both font families
   where possible, and collect more unobstructed, unscaled dialogue samples.
   Reserve fresh screenshots not used during preprocessing selection.
2. Prepare per-line images and verified transcripts for supervised training,
   with a representative mix of MS Gothic/MS Mincho, sizes, white/yellow text
   and backgrounds. Do not redistribute Microsoft's font files.
3. Use a floating-point Japanese starter model with Tesseract's actual
   `lstmtraining`/`combine_tessdata` tools. Installing the runtime alone did not
   provide these tools here; source-build attempts exceeded execution limits.
   No resulting model weights were produced.
4. Compare trained weights with the original recognizer on fresh held-out data,
   including unseen kanji and separate results for each verified font family.
   Bundle a custom model only if accuracy and runtime cost justify it.
