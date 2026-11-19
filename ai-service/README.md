# TruthLens AI Inference Microservice

Production-ready Python FastAPI microservice for deepfake classification and facial manipulation localization, powered by a pre-trained **Vision Transformer (ViT)** ONNX model and the **YuNet** neural face detector.

---

## 1. System Architecture & Capabilities

The TruthLens AI service provides decoupled, high-performance inference:
- **Vision Transformer (`deepfake_vit_quantized.onnx`)**: Quantized INT8 ViT classifier (87.3 MB) evaluating patch-level tampering, synthetic diffusion textures, and facial boundary artifacts.
- **YuNet Face Detector (`face_detection_yunet_2023mar.onnx`)**: Ultra-lightweight (232 KB) neural face detector localizing multiple faces with bounding boxes and landmark points.
- **Temporal Video Forensics**: Uniform temporal frame extraction, frame-by-frame ViT inference, facial contour tracking, and anomaly timestamp flagging.
- **Acoustic Spectral Forensics**: Short-Time Fourier Transform (STFT) spectral flux, high-frequency ratio inspection, and vocoder attenuation detection.

---

## 2. Infrastructure & Resource Sizing

| Metric | Minimum Requirement | Recommended (Production) | High-Concurrency |
|---|---|---|---|
| **CPU** | 1 vCPU (x86_64 or ARM64) | 2 vCPUs | 4+ vCPUs |
| **RAM** | 1.0 GB | 2.0 GB | 4.0 GB |
| **Disk Storage** | 500 MB (models + image) | 1.5 GB | 5.0 GB |
| **Accelerator** | CPU Execution Provider | CPU Execution Provider | ONNX Runtime CUDA / TensorRT |
| **Max Payload** | 25 MB (images) | 100 MB (videos) | Configurable via ENV |

### Model Storage Footprint
- `models/deepfake_vit_quantized.onnx`: **87.3 MB**
- `models/face_detection_yunet_2023mar.onnx`: **232 KB**
- Base Docker Image (`python:3.12-slim` + system libs): **~320 MB**

---

## 3. Endpoints & API Reference

All protected inference endpoints support authentication via the `X-API-Key` header or `Authorization: Bearer <token>`.

### Diagnostics & Readiness
- **`GET /health`**: Liveness probe returning service name and version.
- **`GET /models`** or **`GET /api/v1/models`**: Models inventory listing loaded ONNX classifiers, architectures, input shapes, and operational status.
- **`GET /api/v1/models/availability`**: Readiness probe checking whether ONNX ViT and YuNet models are loaded and operational.

### Forensic Inference
- **`POST /api/v1/analyze/image`**:
  - Request: `multipart/form-data` with `file: Binary`.
  - Response: `ModelImageResponse` containing `deepfakeProbability`, `realProbability`, `confidence`, `predictedLabel`, `faces`, and localized `suspiciousRegions`.
- **`POST /api/v1/analyze/video`**:
  - Request: `multipart/form-data` with `file: Binary`.
  - Query Params: `sample_fps: float = 1.0`, `max_frames: int = 45`.
  - Response: `ModelVideoResponse` containing `totalFramesAnalyzed`, `maxDeepfakeScore`, `meanDeepfakeScore`, `anomalousFrames`, and `suspiciousTimestamps`.
- **`POST /api/v1/analyze/audio`**:
  - Request: `multipart/form-data` with `file: Binary` (WAV preferred).
  - Response: `ModelAudioResponse` with `syntheticProbability`, `highFreqRatio`, `spectralFlux`, and forensic reasons.

---

## 4. Local Execution & Testing

### Running with Python (Development)
```bash
# Navigate to microservice directory
cd ai-service

# Install dependencies
pip install -r requirements.txt

# Start uvicorn server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive OpenAPI documentation is available at: `http://localhost:8000/docs`.

### Running with Docker & Compose
```bash
# Build and run container
cd ai-service
docker compose up --build
```

---

## 5. Next.js Application Integration

In your Next.js application (`.env.production` or Vercel Environment Variables):

```env
# URL of the deployed Python inference microservice
AI_SERVICE_URL=https://truthlens-ai-production.up.railway.app
PYTHON_INFERENCE_URL=https://truthlens-ai-production.up.railway.app

# Shared secret key configured in the microservice
AI_SERVICE_API_KEY=your-secure-ai-service-token-here
```

When `AI_SERVICE_URL` is omitted, TruthLens seamlessly falls back to local Python CLI execution for local development and offline environments.
