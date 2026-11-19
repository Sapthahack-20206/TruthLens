import os
import sys
from pathlib import Path
from starlette.testclient import TestClient

# Add ai-service to path
SERVICE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))

from app.main import app
from app import config

client = TestClient(app)

ROOT_DIR = SERVICE_DIR.parent
SAMPLE_IMAGE = ROOT_DIR / "public" / "samples" / "forensic_image_sample.jpg"
SAMPLE_VIDEO = ROOT_DIR / "public" / "samples" / "forensic_video_sample.mp4"
SAMPLE_AUDIO = ROOT_DIR / "public" / "samples" / "forensic_audio_sample.wav"

def test_health_check():
    """Verify /health returns 200 with service information."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "service" in data
    assert "version" in data
    print("✓ Health check endpoint PASSED")

def test_models_availability():
    """Verify /api/v1/models/availability reports ViT and YuNet model status."""
    response = client.get("/api/v1/models/availability")
    assert response.status_code == 200
    data = response.json()
    assert data["available"] is True
    assert data["vitModel"] is True
    assert data["yunetModel"] is True
    assert len(data["errors"]) == 0
    print(f"✓ Model availability check PASSED (ViT: {data['vitPath']}, YuNet: {data['yunetPath']})")

def test_analyze_real_image():
    """Verify image analysis endpoint on genuine forensic sample image."""
    assert SAMPLE_IMAGE.exists(), f"Sample image missing at {SAMPLE_IMAGE}"
    with open(SAMPLE_IMAGE, "rb") as f:
        response = client.post(
            "/api/v1/analyze/image",
            files={"file": ("forensic_sample.jpg", f, "image/jpeg")}
        )
    assert response.status_code == 200, f"Got error: {response.text}"
    data = response.json()
    assert data["status"] == "success"
    assert data["modelName"] == "ViT-Deepfake-Detection-v1"
    assert 0.0 <= data["deepfakeProbability"] <= 1.0
    assert 0.0 <= data["realProbability"] <= 1.0
    assert 0.0 <= data["confidence"] <= 100.0
    assert data["predictedLabel"] in ["Deepfake", "Real"]
    assert "uncertaintyStatus" in data
    assert "facesCount" in data
    assert isinstance(data["faces"], list)
    assert isinstance(data["suspiciousRegions"], list)
    assert len(data["limitations"]) > 0
    print(f"✓ Image inference PASSED (Probability: {data['deepfakeProbability']}, Label: {data['predictedLabel']}, Faces: {data['facesCount']})")

def test_analyze_real_video():
    """Verify video analysis endpoint on genuine forensic sample video."""
    assert SAMPLE_VIDEO.exists(), f"Sample video missing at {SAMPLE_VIDEO}"
    with open(SAMPLE_VIDEO, "rb") as f:
        response = client.post(
            "/api/v1/analyze/video?sample_fps=1.0&max_frames=5",
            files={"file": ("forensic_sample.mp4", f, "video/mp4")}
        )
    assert response.status_code == 200, f"Got error: {response.text}"
    data = response.json()
    assert data["status"] == "success"
    assert data["modelName"] == "ViT-Deepfake-Detection-v1"
    assert data["totalFramesAnalyzed"] > 0
    assert data["nativeFps"] > 0
    assert data["durationSec"] > 0
    assert 0.0 <= data["maxDeepfakeScore"] <= 1.0
    assert isinstance(data["suspiciousTimestamps"], list)
    print(f"✓ Video inference PASSED (Frames analyzed: {data['totalFramesAnalyzed']}, Duration: {data['durationSec']}s, Max score: {data['maxDeepfakeScore']})")

def test_analyze_real_audio():
    """Verify audio spectral analysis endpoint on genuine forensic sample audio."""
    assert SAMPLE_AUDIO.exists(), f"Sample audio missing at {SAMPLE_AUDIO}"
    with open(SAMPLE_AUDIO, "rb") as f:
        response = client.post(
            "/api/v1/analyze/audio",
            files={"file": ("forensic_sample.wav", f, "audio/wav")}
        )
    assert response.status_code == 200, f"Got error: {response.text}"
    data = response.json()
    assert data["status"] == "success"
    assert data["sampleRate"] > 0
    assert data["channels"] > 0
    assert 0.0 <= data["syntheticProbability"] <= 1.0
    assert 0.0 <= data["highFreqRatio"] <= 1.0
    assert isinstance(data["reasons"], list)
    print(f"✓ Audio spectral inference PASSED (Sample rate: {data['sampleRate']}Hz, Synthetic probability: {data['syntheticProbability']})")

def test_empty_file_rejected():
    """Verify empty 0-byte file receives 400 Bad Request."""
    response = client.post(
        "/api/v1/analyze/image",
        files={"file": ("empty.jpg", b"", "image/jpeg")}
    )
    assert response.status_code == 400
    print("✓ Empty file rejected with 400 PASSED")

def test_api_key_security():
    """Verify API key authentication works when configured."""
    original_key = config.AI_SERVICE_API_KEY
    try:
        config.AI_SERVICE_API_KEY = "test-secret-token-12345"
        # 1. No key -> 401
        with open(SAMPLE_IMAGE, "rb") as f:
            res_no_key = client.post(
                "/api/v1/analyze/image",
                files={"file": ("test.jpg", f, "image/jpeg")}
            )
        assert res_no_key.status_code == 401

        # 2. Invalid key -> 401
        with open(SAMPLE_IMAGE, "rb") as f:
            res_bad_key = client.post(
                "/api/v1/analyze/image",
                files={"file": ("test.jpg", f, "image/jpeg")},
                headers={"X-API-Key": "wrong-key"}
            )
        assert res_bad_key.status_code == 401

        # 3. Valid key via X-API-Key -> 200
        with open(SAMPLE_IMAGE, "rb") as f:
            res_good_key = client.post(
                "/api/v1/analyze/image",
                files={"file": ("test.jpg", f, "image/jpeg")},
                headers={"X-API-Key": "test-secret-token-12345"}
            )
        assert res_good_key.status_code == 200

        # 4. Valid key via Authorization Bearer -> 200
        with open(SAMPLE_IMAGE, "rb") as f:
            res_bearer = client.post(
                "/api/v1/analyze/image",
                files={"file": ("test.jpg", f, "image/jpeg")},
                headers={"Authorization": "Bearer test-secret-token-12345"}
            )
        assert res_bearer.status_code == 200
        print("✓ API Key authentication security PASSED")
    finally:
        config.AI_SERVICE_API_KEY = original_key

if __name__ == "__main__":
    print("==================================================================")
    print("   TruthLens AI Inference Microservice Real Pipeline Test Suite  ")
    print("==================================================================\n")
    test_health_check()
    test_models_availability()
    test_analyze_real_image()
    test_analyze_real_video()
    test_analyze_real_audio()
    test_empty_file_rejected()
    test_api_key_security()
    print("\n==================================================================")
    print("   ALL 7 TESTS PASSED WITH REAL ONNX ViT & YuNet PREDICTIONS!    ")
    print("==================================================================")
