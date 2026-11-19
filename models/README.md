# Pretrained Models Directory

This directory stores neural deepfake and face detection ONNX models utilized by the TruthLens analysis engine.

## Required Models

1. **`deepfake_vit_quantized.onnx`** (~87 MB)
   - Architecture: Vision Transformer (`google/vit-base-patch16-224-in21k` fine-tuned on `Deepfake-vs-Real`)
   - Source: [HuggingFace - prithivMLmods/Deepfake-Detection-Exp-02-21-ONNX](https://huggingface.co/prithivMLmods/Deepfake-Detection-Exp-02-21-ONNX)
   - Function: Classifies image / video frame patches into `Deepfake` vs `Real`.

2. **`face_detection_yunet_2023mar.onnx`** (~232 KB)
   - Architecture: YuNet Face Detector
   - Source: [OpenCV Zoo](https://github.com/opencv/opencv_zoo)
   - Function: High-speed facial localization, bounding box detection, and landmark extraction.

3. **`aasist.onnx`** (~1.6 MB)
   - Architecture: AASIST (Audio Anti-Spoofing using Integrated Spectro-Temporal Graph Attention Networks)
   - Source: [HuggingFace - SpeechAntiSpoofingBenchmarks/AASIST](https://huggingface.co/SpeechAntiSpoofingBenchmarks/AASIST)
   - Function: Classifies raw 16kHz speech waveforms for voice spoofing, synthetic speech (TTS), and cloned voice detection.

4. **`whisper-tiny`** (Faster-Whisper int8 CTranslate2 Model)
   - Architecture: OpenAI Whisper Tiny (Multilingual)
   - Source: [Systran/faster-whisper-tiny](https://huggingface.co/Systran/faster-whisper-tiny)
   - Function: High-speed speech-to-text transcription, word-level timestamps, and dialogue forensic analysis.

*Note: Model binaries (`*.onnx`, `*.bin`) are excluded from Git tracking via `.gitignore`.*
