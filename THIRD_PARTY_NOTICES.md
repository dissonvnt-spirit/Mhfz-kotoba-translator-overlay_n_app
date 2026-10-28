# Third-party translation and OCR resources

Kotoba Overlay's own source is licensed under the MIT License in `LICENSE`.
The following resources retain their own licenses.

## Offline Japanese-to-English translation

- Model: [Helsinki-NLP/opus-mt-ja-en](https://huggingface.co/Helsinki-NLP/opus-mt-ja-en)
- ONNX conversion: [Xenova/opus-mt-ja-en](https://huggingface.co/Xenova/opus-mt-ja-en)
- Pinned conversion revision: `1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16`
- Original model license: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- Runtime: Transformers.js and ONNX Runtime, Apache-2.0 and MIT respectively.

Model weights are downloaded directly from Hugging Face only when the player
chooses **Prepare local model**. Kotoba does not send game dialogue to Hugging
Face. Downloaded files are stored in the app origin's IndexedDB storage.
Removing app/site data removes the model and requires another download.

OPUS-MT is a general translation model, not a game-specific glossary. Names,
specialized terms and long dialogue may need correction.

## Japanese OCR

Tesseract.js, Tesseract and the Japanese trained data use Apache-2.0 licenses.
The build includes horizontal and vertical Japanese language resources from
the [Tesseract language-data distribution](https://tessdata.projectnaptha.com/).

Other dependencies retain their package licenses. This notice does not
relicense third-party components as MIT.
