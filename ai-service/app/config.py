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
AASIST_MODEL_PATH = MODELS_DIR / "aasist.onnx"

# Backup YuNet name check
if not YUNET_MODEL_PATH.exists() and (MODELS_DIR / "face_detection_yunet.onnx").exists():
    YUNET_MODEL_PATH = MODELS_DIR / "face_detection_yunet.onnx"

# Service Configuration
SERVICE_NAME = "TruthLens-AI-Inference-Engine"
SERVICE_VERSION = "1.0.0"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))

# Security & Environment
AI_SERVICE_API_KEY = os.environ.get("AI_SERVICE_API_KEY", "")
ENVIRONMENT = os.environ.get("ENVIRONMENT", os.environ.get("NODE_ENV", "development")).lower()
IS_PRODUCTION = ENVIRONMENT == "production"

# Configured Trusted Origins (no wildcards with credentials)
ALLOWED_ORIGINS_RAW = os.environ.get(
    "ALLOWED_ORIGIN",
    os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
)
ALLOWED_ORIGINS = [orig.strip() for orig in ALLOWED_ORIGINS_RAW.split(",") if orig.strip()]

# Request Limits
MAX_IMAGE_SIZE_BYTES = int(os.environ.get("MAX_IMAGE_SIZE_BYTES", 25 * 1024 * 1024))   # 25 MB
MAX_VIDEO_SIZE_BYTES = int(os.environ.get("MAX_VIDEO_SIZE_BYTES", 100 * 1024 * 1024)) # 100 MB
MAX_AUDIO_SIZE_BYTES = int(os.environ.get("MAX_AUDIO_SIZE_BYTES", 50 * 1024 * 1024))  # 50 MB
