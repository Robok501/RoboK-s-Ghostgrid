# Spleeter drums model for the app

`export.py` turns Deezer's Spleeter 4stems checkpoint (MIT code, trained by Deezer on its own data) into
`spleeter_drums.onnx` (157 MB): input `[N, 512, 1024, 2]` magnitude spectrogram chunk, output the drums soft mask.
`spleeter_ref.py` is the whole chain (STFT, network, mask, inverse STFT) in NumPy; the Swift code in
`apps/mobile/modules/ghostgrid-engine/ios/GGStems.swift` (`separateSpleeter`) does the same.

Built in CI by `.github/workflows/spleeter-model.yml` (Python 3.10, TensorFlow 2.9.3, tf2onnx 1.14), which also checks
the result against Deezer's own TensorFlow graph. Licence notes: see `THIRD_PARTY_NOTICES.md`.
