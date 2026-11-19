import os
from pathlib import Path

# Resolve base directories
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_MODELS_DIR = ROOT_DIR / "models"
CONTAINER_MODELS_DIR = Path("/app/models")

def get_models_dir() -> Path:
    env_path = os.environ.get("MODELS_DIR")
    if env_path and Path(env_path).exists():
        return Path(env_path)
    if CONTAINER_MODELS_DIR.exists():
        return CONTAINER_MODELS_DIR
    if DEFAULT_MODELS_DIR.exists():
        return DEFAULT_MODELS_DIR
    return Path("./models").resolve()

MODELS_DIR = get_models_dir()
VIT_MODEL_PATH = MODELS_DIR / "deepfake_vit_quantized.onnx"
YUNET_MODEL_PATH = MODELS_DIR / "face_detection_yunet_2023mar.onnx"

# Backup YuNet name check
if not YUNET_MODEL_PATH.exists() and (MODELS_DIR / "face_detection_yunet.onnx").exists():
    YUNET_MODEL_PATH = MODELS_DIR / "face_detection_yunet.onnx"

# Service Configuration
SERVICE_NAME = "TruthLens-AI-Inference-Engine"
SERVICE_VERSION = "1.0.0"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))

# Security
AI_SERVICE_API_KEY = os.environ.get("AI_SERVICE_API_KEY", "")

# Request Limits
MAX_IMAGE_SIZE_BYTES = int(os.environ.get("MAX_IMAGE_SIZE_BYTES", 25 * 1024 * 1024))   # 25 MB
MAX_VIDEO_SIZE_BYTES = int(os.environ.get("MAX_VIDEO_SIZE_BYTES", 100 * 1024 * 1024)) # 100 MB
MAX_AUDIO_SIZE_BYTES = int(os.environ.get("MAX_AUDIO_SIZE_BYTES", 50 * 1024 * 1024))  # 50 MB
