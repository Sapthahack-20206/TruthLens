import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

from . import config
from .detector import get_detector, DeepfakeDetectorService

SERVICE_NAME = config.SERVICE_NAME
SERVICE_VERSION = config.SERVICE_VERSION
MAX_IMAGE_SIZE_BYTES = config.MAX_IMAGE_SIZE_BYTES
MAX_VIDEO_SIZE_BYTES = config.MAX_VIDEO_SIZE_BYTES
MAX_AUDIO_SIZE_BYTES = config.MAX_AUDIO_SIZE_BYTES

# Check model files existence
def get_model_status():
    errors = []
    vit_exists = config.VIT_MODEL_PATH.exists() and config.VIT_MODEL_PATH.stat().st_size > 1000000
    yunet_exists = config.YUNET_MODEL_PATH.exists() and config.YUNET_MODEL_PATH.stat().st_size > 50000

    if not vit_exists:
        errors.append(f"ViT ONNX model missing at {config.VIT_MODEL_PATH}")
    if not yunet_exists:
        errors.append(f"YuNet face detection model missing at {config.YUNET_MODEL_PATH}")

    try:
        import onnxruntime
    except ImportError:
        errors.append("onnxruntime is not installed.")

    try:
        import cv2
    except ImportError:
        errors.append("cv2 (OpenCV) is not installed.")

    return {
        "available": len(errors) == 0,
        "vitModel": vit_exists,
        "yunetModel": yunet_exists,
        "vitPath": str(config.VIT_MODEL_PATH),
        "yunetPath": str(config.YUNET_MODEL_PATH),
        "errors": errors
    }

# Attempt FastAPI initialization with fallback to Starlette ASGI
USE_FASTAPI = False
try:
    from fastapi import FastAPI, UploadFile, File, Query, Depends, HTTPException, Request, status
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from .schemas import (
        HealthResponse,
        ModelAvailabilityResponse,
        ModelImageResponse,
        ModelVideoResponse,
        ModelAudioResponse
    )
    from .security import verify_api_key
    USE_FASTAPI = True
except Exception:
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route
    from starlette.middleware.cors import CORSMiddleware
    from starlette.requests import Request
    USE_FASTAPI = False

if USE_FASTAPI:
    app = FastAPI(
        title=SERVICE_NAME,
        version=SERVICE_VERSION,
        description="TruthLens Production Microservice for ONNX Vision Transformer Deepfake Detection and YuNet Face Localization"
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthResponse, tags=["Diagnostics"])
    def health_check():
        return {"status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION}

    @app.get("/api/v1/models/availability", response_model=ModelAvailabilityResponse, tags=["Diagnostics"])
    def model_availability():
        return get_model_status()

    @app.post("/api/v1/analyze/image", response_model=ModelImageResponse, dependencies=[Depends(verify_api_key)], tags=["Forensic Inference"])
    async def analyze_image_fastapi(file: UploadFile = File(...)):
        content = await file.read()
        if len(content) > MAX_IMAGE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail=f"Image exceeds maximum size of {MAX_IMAGE_SIZE_BYTES // (1024*1024)} MB")
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty (0 bytes).")
        detector = get_detector()
        return detector.analyze_image_bytes(content, filename=file.filename or "evidence.jpg")

    @app.post("/api/v1/analyze/video", response_model=ModelVideoResponse, dependencies=[Depends(verify_api_key)], tags=["Forensic Inference"])
    async def analyze_video_fastapi(
        file: UploadFile = File(...),
        sample_fps: float = Query(1.0, ge=0.1, le=10.0),
        max_frames: int = Query(45, ge=1, le=150)
    ):
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file.filename or 'video.mp4'}")
        total = 0
        try:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > MAX_VIDEO_SIZE_BYTES:
                    raise HTTPException(status_code=413, detail="Video exceeds size limit.")
                tmp.write(chunk)
            tmp.flush()
            tmp.close()
            if total == 0:
                raise HTTPException(status_code=400, detail="Uploaded video is empty.")
            detector = get_detector()
            return detector.analyze_video_path(tmp.name, sample_fps=sample_fps, max_frames=max_frames)
        finally:
            if os.path.exists(tmp.name):
                try: os.remove(tmp.name)
                except Exception: pass

    @app.post("/api/v1/analyze/audio", response_model=ModelAudioResponse, dependencies=[Depends(verify_api_key)], tags=["Forensic Inference"])
    async def analyze_audio_fastapi(file: UploadFile = File(...)):
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file.filename or 'audio.wav'}")
        total = 0
        try:
            while True:
                chunk = await file.read(512 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > MAX_AUDIO_SIZE_BYTES:
                    raise HTTPException(status_code=413, detail="Audio exceeds size limit.")
                tmp.write(chunk)
            tmp.flush()
            tmp.close()
            if total == 0:
                raise HTTPException(status_code=400, detail="Uploaded audio is empty.")
            detector = get_detector()
            return detector.analyze_audio_path(tmp.name)
        finally:
            if os.path.exists(tmp.name):
                try: os.remove(tmp.name)
                except Exception: pass

else:
    # Pure Starlette ASGI Implementation (Active on Windows Host when pydantic_core DLL is blocked)
    async def health_endpoint(request: Request):
        return JSONResponse({"status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION})

    async def availability_endpoint(request: Request):
        return JSONResponse(get_model_status())

    def check_starlette_auth(request: Request):
        if not config.AI_SERVICE_API_KEY:
            return True
        key = request.headers.get("x-api-key")
        auth = request.headers.get("authorization")
        bearer = auth[7:] if (auth and auth.startswith("Bearer ")) else None
        token = key or bearer
        return bool(token and token == config.AI_SERVICE_API_KEY)

    async def analyze_image_endpoint(request: Request):
        if not check_starlette_auth(request):
            return JSONResponse({"status": "error", "message": "Unauthorized: Invalid or missing API key"}, status_code=401)
        form = await request.form()
        file = form.get("file")
        if not file or not hasattr(file, "read"):
            return JSONResponse({"status": "error", "message": "Missing 'file' in multipart form data"}, status_code=400)
        content = await file.read()
        if len(content) == 0:
            return JSONResponse({"status": "error", "message": "Uploaded file is empty (0 bytes)."}, status_code=400)
        if len(content) > MAX_IMAGE_SIZE_BYTES:
            return JSONResponse({"status": "error", "message": "Image exceeds maximum allowed size"}, status_code=413)

        try:
            detector = get_detector()
            res = detector.analyze_image_bytes(content, filename=getattr(file, "filename", "evidence.jpg"))
            return JSONResponse(res)
        except Exception as e:
            return JSONResponse({"status": "error", "message": str(e)}, status_code=500)

    async def analyze_video_endpoint(request: Request):
        if not check_starlette_auth(request):
            return JSONResponse({"status": "error", "message": "Unauthorized: Invalid or missing API key"}, status_code=401)
        form = await request.form()
        file = form.get("file")
        if not file or not hasattr(file, "read"):
            return JSONResponse({"status": "error", "message": "Missing 'file' in multipart form data"}, status_code=400)

        sample_fps = float(request.query_params.get("sample_fps", 1.0))
        max_frames = int(request.query_params.get("max_frames", 45))

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f"_{getattr(file, 'filename', 'video.mp4')}")
        total = 0
        try:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > MAX_VIDEO_SIZE_BYTES:
                    return JSONResponse({"status": "error", "message": "Video exceeds size limit"}, status_code=413)
                tmp.write(chunk)
            tmp.flush()
            tmp.close()

            if total == 0:
                return JSONResponse({"status": "error", "message": "Uploaded video is empty"}, status_code=400)

            detector = get_detector()
            res = detector.analyze_video_path(tmp.name, sample_fps=sample_fps, max_frames=max_frames)
            return JSONResponse(res)
        except Exception as e:
            return JSONResponse({"status": "error", "message": str(e)}, status_code=500)
        finally:
            if os.path.exists(tmp.name):
                try: os.remove(tmp.name)
                except Exception: pass

    async def analyze_audio_endpoint(request: Request):
        if not check_starlette_auth(request):
            return JSONResponse({"status": "error", "message": "Unauthorized: Invalid or missing API key"}, status_code=401)
        form = await request.form()
        file = form.get("file")
        if not file or not hasattr(file, "read"):
            return JSONResponse({"status": "error", "message": "Missing 'file' in multipart form data"}, status_code=400)

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f"_{getattr(file, 'filename', 'audio.wav')}")
        total = 0
        try:
            while True:
                chunk = await file.read(512 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > MAX_AUDIO_SIZE_BYTES:
                    return JSONResponse({"status": "error", "message": "Audio exceeds size limit"}, status_code=413)
                tmp.write(chunk)
            tmp.flush()
            tmp.close()

            if total == 0:
                return JSONResponse({"status": "error", "message": "Uploaded audio is empty"}, status_code=400)

            detector = get_detector()
            res = detector.analyze_audio_path(tmp.name)
            return JSONResponse(res)
        except Exception as e:
            return JSONResponse({"status": "error", "message": str(e)}, status_code=500)
        finally:
            if os.path.exists(tmp.name):
                try: os.remove(tmp.name)
                except Exception: pass

    routes = [
        Route("/health", health_endpoint, methods=["GET"]),
        Route("/api/v1/models/availability", availability_endpoint, methods=["GET"]),
        Route("/api/v1/analyze/image", analyze_image_endpoint, methods=["POST"]),
        Route("/api/v1/analyze/video", analyze_video_endpoint, methods=["POST"]),
        Route("/api/v1/analyze/audio", analyze_audio_endpoint, methods=["POST"]),
    ]

    app = Starlette(routes=routes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
