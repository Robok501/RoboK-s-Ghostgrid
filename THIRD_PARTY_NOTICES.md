# Third-party notices

Ghostgrid runs four machine-learning models on the phone. This file lists them, who made them and under which licence
they are published. The same credits are shown in the app under Settings → Licences
(`apps/mobile/src/legal/notices.ts`: keep the two in step).

Licence status below is **as stated by the publishers**. It is not legal advice; see "Open points".

## Beat This! (built into the app)

- What: beat and downbeat tracking (`final0` checkpoint), ONNX build with the log-mel front end inside, 81,837,133 bytes,
  SHA-256 `ab31b5a815e2d90c6cb523e33f0ce45590fdcf80c4181a8115394d94633be14a`.
- Authors: Francesco Foscarin, Jan Schlüter, Gerhard Widmer, Institute of Computational Perception, JKU Linz, Austria.
  Source: <https://github.com/CPJKU/beat_this> (commit `b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c` per the converter's notice).
- ONNX conversion: Silly MIDI Tools scripts (<https://github.com/Sillybit-io/silly-midi-tools>), published at
  <https://huggingface.co/thebluescreen/beat-this-onnx>.
- Licence: MIT for code and weights (README of the original repository; maintainers confirmed commercial use and
  redistribution are fine, 25 Oct 2026, <https://github.com/CPJKU/beat_this/issues/21>).
- Citation: Francesco Foscarin, Jan Schlüter, Gerhard Widmer. "Beat this! Accurate beat tracking without DBN
  postprocessing." ISMIR 2024.
- Changes: PyTorch checkpoint converted to ONNX; mel front end and edge padding are part of the graph; no weights were
  modified or fine-tuned; peak picking is done in the app.
- Caveat from the authors: some training files are fully copyrighted or under limited Creative Commons licences; it is up
  to the user to assess whether this may impact their use case.

```
MIT License

Copyright (c) 2024 Institute of Computational Perception, JKU Linz, Austria

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Spleeter (built into the app, second separator)

- What: drum separation. The four U-Nets of Deezer's 4-stem checkpoint (`4stems.tar.gz`, release v1.4.0, SHA-256
  `3adb4a50ad4eb18c7c4d65fcf4cf2367a07d48408a5eb7d03cd20067429dfaa8`) rebuilt in TensorFlow from the original weights and
  exported to ONNX by `tools/spleeter` (CI: `.github/workflows/spleeter-model.yml`), 157 MB. STFT, mask and inverse STFT are done in
  the app. The conversion is checked in CI against Deezer's own TensorFlow graph (error more than 60 dB below the signal; 75 dB when
  last run). No weights were changed.
- Authors: Romain Hennequin, Anis Khlif, Felix Voituret, Manuel Moussallam (Deezer Research). <https://github.com/deezer/spleeter>
- Licence: "The code of Spleeter is MIT-licensed" (README). Copyright (c) 2019-present, Deezer SA. The README states no separate terms
  for the pretrained models. They were trained on Deezer's own data (not MUSDB) and published by Deezer without research-only wording
  (JOSS paper: <https://doi.org/10.21105/joss.02154>). The MIT text is in `apps/mobile/src/legal/notices.ts` and shown in the app.
- Not published anywhere: the converted file is only inside the (privately built) app. Hosting it for download would be redistribution.
- Citation: Hennequin, Khlif, Voituret, Moussallam. "Spleeter: a fast and efficient music source separation tool with pre-trained
  models." JOSS 5(50), 2154, 2020.

## HT-Demucs drums (downloaded on request, not bundled)

- What: drum separation, sub-model 0 of `htdemucs_ft`, ONNX export by StemSplit, 316 MB.
  <https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx>
- Original: Simon Rouard, Francisco Massa, Alexandre Défossez, "Hybrid Transformers for Music Source Separation", ICASSP 2023.
  <https://github.com/facebookresearch/demucs> (archived 1 Jan 2025; fork <https://github.com/adefossez/demucs>).
- Licence: **not cleared; for the developer's own testing and practice only, never to be shipped, hosted or sold.** StemSplit states
  the export is MIT "matching the original HT-Demucs", but that does not override the original author, who writes in the README of
  <https://github.com/adefossez/demucs> (read 3 Nov 2026): "Demucs code is released under the MIT license ... The license of the
  weights is not clear: MusDB contains some data that were only usable for research purpose. I sadly cannot help granting a license,
  both coming from Meta custom data, or from the original MusDB data. The 6 source variant of htdemucs was trained only on Meta
  internal dataset, which likely means CC-NC-BY license is applicable, as it was the case for all models released by FAIR. Do not
  write me to ask about it, I won't be able to clarify the situation further." So: no mail to the author; the weights stay unusable
  for a public or paid app. Earlier second-hand evidence (issue #327; MIT tag removed from the model card,
  <https://huggingface.co/adefossez/HTDemucs-ft/discussions/1>) points the same way.

## Onsets and Frames Drums (downloaded on request, not bundled)

- What: drum transcription, ONNX build at <https://huggingface.co/thebluescreen/oaf-drums-onnx>.
- Original: Magenta Onsets and Frames Drums, E-GMD checkpoint.
- Licence: Apache-2.0 according to the comment in `songs.ts`; **not yet re-checked against the publisher's page**.

## Open points

1. HT-Demucs weights: cannot be cleared (the author says so himself, 3 Nov 2026). Own use only; remove the Demucs download before
   any public or paid release. StemSplit may still be asked what they claim, but their answer cannot override the original data terms.
   Spleeter is the separator for release; a model trained by us on data we may use is the route to better quality.
1b. Spleeter weights: no separate statement from Deezer; same question, but Deezer trained and published them itself.
2. Onsets and Frames Drums: confirm the licence and, if Apache-2.0, add the licence text and NOTICE if it is ever bundled.
3. Training data of all three models: see the caveat above for Beat This!.
