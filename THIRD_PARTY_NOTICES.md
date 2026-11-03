# Third-party notices

Ghostgrid runs three machine-learning models on the phone. This file lists them, who made them and under which licence
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

## HT-Demucs drums (downloaded on request, not bundled)

- What: drum separation, sub-model 0 of `htdemucs_ft`, ONNX export by StemSplit, 316 MB.
  <https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx>
- Original: Simon Rouard, Francisco Massa, Alexandre Défossez, "Hybrid Transformers for Music Source Separation", ICASSP 2023.
  <https://github.com/facebookresearch/demucs> (archived 1 Jan 2025; fork <https://github.com/adefossez/demucs>).
- Licence: StemSplit states the export is MIT "matching the original HT-Demucs". The Demucs repository is MIT; it does not
  state separate terms for the pretrained weights.

## Onsets and Frames Drums (downloaded on request, not bundled)

- What: drum transcription, ONNX build at <https://huggingface.co/thebluescreen/oaf-drums-onnx>.
- Original: Magenta Onsets and Frames Drums, E-GMD checkpoint.
- Licence: Apache-2.0 according to the comment in `songs.ts`; **not yet re-checked against the publisher's page**.

## Open points

1. HT-Demucs weights: whether MIT really covers the pretrained weights (a public question on the weights' Hugging Face
   page, <https://huggingface.co/adefossez/HTDemucs/discussions/1>, is unanswered). Written answer requested from the
   publisher and the original author before any paid release.
2. Onsets and Frames Drums: confirm the licence and, if Apache-2.0, add the licence text and NOTICE if it is ever bundled.
3. Training data of all three models: see the caveat above for Beat This!.
