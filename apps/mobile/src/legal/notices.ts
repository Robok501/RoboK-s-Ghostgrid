/**
 * Credits and licence texts for the models and code Ghostgrid uses (shown in Settings → Licences).
 * Keep THIRD_PARTY_NOTICES.md in the repository root in step with this file.
 */
export interface Credit { name: string; what: string; by: string; licence: string; bundled: boolean }

export const CREDITS: Credit[] = [
  {
    name: 'Beat This!',
    what: 'Finds the beats and the "1" of a song (final0 checkpoint, ONNX build with the mel front end inside; 82 MB).',
    by: 'Francesco Foscarin, Jan Schlüter, Gerhard Widmer (JKU Linz). ONNX conversion by the Silly MIDI Tools scripts, published by thebluescreen.',
    licence: 'MIT',
    bundled: true,
  },
  {
    name: 'Spleeter',
    what: 'A lighter way to separate the drums from a song (4-stem model, converted to ONNX; 157 MB).',
    by: 'Deezer Research (Romain Hennequin, Anis Khlif, Felix Voituret, Manuel Moussallam). ONNX conversion made for Ghostgrid from the original checkpoint.',
    licence: 'MIT (code); models trained by Deezer on its own data',
    bundled: true,
  },
  {
    name: 'HT-Demucs (drums)',
    what: 'Separates the drums from a song (downloaded on request).',
    by: 'Simon Rouard, Francisco Massa, Alexandre Défossez (Meta AI). ONNX export by StemSplit.',
    licence: 'code MIT; licence of the trained weights not confirmed (for testing only)',
    bundled: false,
  },
  {
    name: 'Onsets and Frames Drums',
    what: 'Recognises which drum was hit when (downloaded on request).',
    by: 'Magenta (Google). ONNX build published by thebluescreen.',
    licence: 'Apache-2.0, as stated by the publisher of the ONNX build',
    bundled: false,
  },
];

export const SPLEETER_CITATION =
  'Romain Hennequin, Anis Khlif, Felix Voituret, Manuel Moussallam. "Spleeter: a fast and efficient music source separation tool with pre-trained models." Journal of Open Source Software 5(50), 2154, 2020. https://doi.org/10.21105/joss.02154';

export const SPLEETER_LICENCE = `MIT License

Copyright (c) 2019-present, Deezer SA.

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
SOFTWARE.`;

export const SPLEETER_CHANGES =
  'The four U-Nets of the 4-stem checkpoint were rebuilt in TensorFlow from the original weights and exported to ONNX (the network only; the STFT, mask and inverse STFT are done in the app). The result was checked against the original TensorFlow graph. No weights were changed.';

export const SPLEETER_NOTE =
  'Deezer states that the Spleeter code is MIT-licensed; it does not state separate terms for the pretrained models. They were trained on Deezer\'s own data (not MUSDB) and published by Deezer without research-only wording.';

export const BEAT_THIS_CITATION =
  'Francesco Foscarin, Jan Schlüter, Gerhard Widmer. "Beat this! Accurate beat tracking without DBN postprocessing." Proceedings of the 25th International Society for Music Information Retrieval Conference (ISMIR), San Francisco, 2024.';

export const BEAT_THIS_CHANGES =
  'The PyTorch checkpoint was converted to ONNX. The log-mel front end (22.05 kHz, 1024-sample window, 441-sample hop) and the six zero frames the reference adds at the ends of a piece are part of the graph. No weights were modified or fine-tuned. Peak picking is done in the app; the Dynamic Bayesian Network post-processing is not used.';

export const BEAT_THIS_NOTE =
  'The authors note that some of the training files of Beat This! are fully copyrighted or under limited Creative Commons licences, and that it is up to the user to assess whether this may impact their use case.';

export const BEAT_THIS_LICENCE = `MIT License

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
SOFTWARE.`;
