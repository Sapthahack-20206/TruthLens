"""
TruthLens Advanced Video Forensic Engine
Extracts video frames via OpenCV / FFmpeg, detects faces using OpenCV YuNet DNN,
analyzes biometric and visual manipulation indicators (boundary seams, Laplacian texture variance, jitter),
computes inter-frame temporal continuity, and produces structured forensic telemetry.
"""

import os
import sys

# Suppress noisy OpenCV / FFmpeg C++ warnings before importing cv2
os.environ["OPENCV_LOG_LEVEL"] = "FATAL"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"

import json
import base64
import math
import subprocess
import numpy as np

try:
    import cv2
    if hasattr(cv2, 'utils') and hasattr(cv2.utils, 'logging'):
        cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)
except ImportError:
    cv2 = None

def format_time(seconds):
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    ms = int(round((seconds % 1) * 100))
    return f"{mins:02d}:{secs:02d}.{ms:02d}"

def make_thumbnail_cv(frame_bgr, bbox=None, max_width=320):
    if cv2 is None or frame_bgr is None:
        return ""
    h, w = frame_bgr.shape[:2]
    scale = min(1.0, max_width / max(w, 1))
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    thumb = cv2.resize(frame_bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)

    if bbox:
        bx = int(bbox["x"] * scale)
        by = int(bbox["y"] * scale)
        bw = int(bbox["w"] * scale)
        bh = int(bbox["h"] * scale)
        # Bounding box in BGR (Orange)
        cv2.rectangle(thumb, (bx, by), (bx + bw, by + bh), (22, 115, 249), 2)
        # Corner brackets (Cyan)
        c_len = min(8, bw // 3, bh // 3)
        cv2.line(thumb, (bx, by), (bx + c_len, by), (212, 182, 6), 3)
        cv2.line(thumb, (bx, by), (bx, by + c_len), (212, 182, 6), 3)
        cv2.line(thumb, (bx + bw, by), (bx + bw - c_len, by), (212, 182, 6), 3)
        cv2.line(thumb, (bx + bw, by), (bx + bw, by + c_len), (212, 182, 6), 3)

    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 75]
    success, buffer = cv2.imencode('.jpg', thumb, encode_param)
    if not success:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buffer).decode("ascii")

def extract_frames(video_path, frames_dir, ffmpeg_path, fps=1, max_frames=60):
    os.makedirs(frames_dir, exist_ok=True)

    # 1. Try OpenCV VideoCapture first (handles native decoding without ffmpeg binary)
    if cv2 is not None:
        try:
            cap = cv2.VideoCapture(video_path)
            if cap.isOpened():
                total_f = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                v_fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
                step = max(1, int(round(v_fps / float(max(1, fps)))))

                frame_files = []
                idx = 0
                saved_count = 0
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    if idx % step == 0:
                        out_name = os.path.join(frames_dir, f"frame_{saved_count+1:04d}.jpg")
                        cv2.imwrite(out_name, frame)
                        frame_files.append(out_name)
                        saved_count += 1
                        if saved_count >= max_frames:
                            break
                    idx += 1
                cap.release()
                if len(frame_files) > 0:
                    return frame_files, 0, ""
        except Exception:
            pass

    # 2. Fallback to FFmpeg if available
    if ffmpeg_path and os.path.exists(ffmpeg_path):
        pattern = os.path.join(frames_dir, "frame_%04d.jpg")
        cmd = [
            ffmpeg_path,
            "-i", video_path,
            "-vf", f"fps={fps}",
            "-q:v", "2",
            "-frames:v", str(max_frames),
            pattern,
            "-y"
        ]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        frame_files = sorted([
            os.path.join(frames_dir, f)
            for f in os.listdir(frames_dir)
            if f.startswith("frame_") and f.endswith(".jpg")
        ])
        return frame_files, proc.returncode, proc.stderr

    return [], 1, "No working video decoder available (OpenCV or FFmpeg required)."

def compute_laplacian_variance(gray_arr):
    if cv2 is not None:
        return float(cv2.Laplacian(gray_arr.astype(np.uint8), cv2.CV_64F).var())
    # Pure numpy 2D Laplacian convolution fallback
    lap = (
        np.roll(gray_arr, 1, axis=0) + np.roll(gray_arr, -1, axis=0) +
        np.roll(gray_arr, 1, axis=1) + np.roll(gray_arr, -1, axis=1) -
        4 * gray_arr
    )
    return float(np.var(lap))

def compute_blockiness(gray_arr):
    H, W = gray_arr.shape
    if H < 16 or W < 16:
        return 0.0
    h_diff = np.abs(gray_arr[:, 7:W-1:8] - gray_arr[:, 8:W:8])
    h_intra = np.abs(gray_arr[:, 3:W-1:8] - gray_arr[:, 4:W:8])
    denom = float(np.mean(h_intra)) + 1e-4
    return float(np.mean(h_diff)) / denom

def detect_face_yunet_or_color(img_bgr, face_detector):
    H, W = img_bgr.shape[:2]
    if face_detector is not None:
        try:
            _, faces = face_detector.detect(img_bgr)
            if faces is not None and len(faces) > 0:
                f0 = faces[0]
                bx, by, bw, bh = int(f0[0]), int(f0[1]), int(f0[2]), int(f0[3])
                bx = max(0, min(W - 10, bx))
                by = max(0, min(H - 10, by))
                bw = max(10, min(W - bx, bw))
                bh = max(10, min(H - by, bh))
                return {
                    "bbox": {"x": bx, "y": by, "w": bw, "h": bh},
                    "confidence": float(f0[14]),
                    "area": bw * bh,
                    "center": (bx + bw // 2, by + bh // 2)
                }
        except Exception:
            pass

    # Color threshold fallback
    arr_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) if cv2 is not None else img_bgr.astype(np.float32)
    R, G, B = arr_rgb[:, :, 0], arr_rgb[:, :, 1], arr_rgb[:, :, 2]
    Y = 0.299 * R + 0.587 * G + 0.114 * B
    Cb = -0.168736 * R - 0.331264 * G + 0.5 * B + 128
    Cr = 0.5 * R - 0.418688 * G - 0.081312 * B + 128

    skin_mask = (Cb >= 80) & (Cb <= 126) & (Cr >= 134) & (Cr <= 172) & (Y >= 40)
    total_skin = int(np.sum(skin_mask))
    if total_skin < (H * W * 0.015):
        return None

    y_indices, x_indices = np.where(skin_mask)
    if len(y_indices) == 0:
        return None

    min_x, max_x = int(np.percentile(x_indices, 5)), int(np.percentile(x_indices, 95))
    min_y, max_y = int(np.percentile(y_indices, 5)), int(np.percentile(y_indices, 95))
    w_box = max_x - min_x
    h_box = max_y - min_y
    if w_box < 20 or h_box < 20:
        return None

    return {
        "bbox": {"x": min_x, "y": min_y, "w": w_box, "h": h_box},
        "confidence": min(0.9, total_skin / float(H * W * 0.15)),
        "area": w_box * h_box,
        "center": (min_x + w_box // 2, min_y + h_box // 2)
    }

def analyze_video(video_path, ffmpeg_path, fps=1, max_frames=60):
    results = {
        "status": "completed",
        "findings": [],
        "suspicious_timestamps": [],
        "timeline": [],
        "metrics": {
            "total_frames_sampled": 0,
            "faces_detected_count": 0,
            "average_interframe_diff": 0.0,
            "compression_variance": 0.0
        },
        "limitations": [],
        "processing_errors": []
    }

    if not os.path.exists(video_path):
        results["status"] = "failed"
        results["processing_errors"].append(f"Target video file not found at: {video_path}")
        return results

    # Initialize OpenCV Face Detector (YuNet)
    model_paths = [
        os.path.join(os.path.dirname(__file__), '..', '..', 'models', 'face_detection_yunet.onnx'),
        os.path.join(os.getcwd(), 'models', 'face_detection_yunet.onnx'),
        'models/face_detection_yunet.onnx'
    ]
    face_detector = None
    if cv2 is not None:
        for mp in model_paths:
            if os.path.exists(mp) and os.path.getsize(mp) > 1000:
                try:
                    face_detector = cv2.FaceDetectorYN_create(mp, "", (320, 320), score_threshold=0.6, nms_threshold=0.3)
                    break
                except Exception:
                    pass

    frames_dir = os.path.join(os.path.dirname(video_path), f"py_frames_{os.getpid()}")
    frame_files, code, err = extract_frames(video_path, frames_dir, ffmpeg_path, fps=fps, max_frames=max_frames)

    if not frame_files:
        results["status"] = "failed"
        results["processing_errors"].append(f"Frame extraction failed: {err}")
        results["limitations"].append("OpenCV / FFmpeg frame extractor could not decode frames.")
        return results

    results["metrics"]["total_frames_sampled"] = len(frame_files)

    prev_gray = None
    prev_face = None
    interframe_diffs = []
    blockiness_history = []

    for idx, f_path in enumerate(frame_files):
        time_sec = idx * (1.0 / max(1, fps))
        timecode = format_time(time_sec)
        frame_num = idx + 1

        img_bgr = cv2.imread(f_path) if cv2 is not None else None
        if img_bgr is None:
            continue

        H, W = img_bgr.shape[:2]
        if face_detector is not None:
            try:
                face_detector.setInputSize((W, H))
            except Exception:
                pass

        gray_arr = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY) if cv2 is not None else np.mean(img_bgr, axis=2).astype(np.uint8)

        # 1. Face detection
        face = detect_face_yunet_or_color(img_bgr, face_detector)

        timeline_item = {
            "frameNumber": frame_num,
            "seconds": round(time_sec, 2),
            "timestamp": timecode,
            "isSuspicious": False,
            "anomalyCount": 0,
            "faceDetected": face is not None,
            "faceBoundingBox": face["bbox"] if face else None,
            "severity": "info",
            "indicators": [],
            "previewThumbnail": None
        }

        frame_anomalies = []

        # 2. Interframe delta
        if prev_gray is not None and prev_gray.shape == gray_arr.shape:
            diff = float(np.mean(np.abs(gray_arr.astype(np.float32) - prev_gray.astype(np.float32))))
            interframe_diffs.append(diff)
            if diff > 48.0:
                frame_anomalies.append({
                    "type": "temporal_splice",
                    "severity": "low",
                    "label": "Inter-Frame Intensity Discontinuity",
                    "description": f"Abrupt luminance transition ({diff:.1f} mean delta) between adjacent sampled frames.",
                    "metric": f"{diff:.1f} delta"
                })

        # 3. Compression blockiness
        blk = compute_blockiness(gray_arr)
        blockiness_history.append(blk)

        # 4. Facial manipulation indicators
        if face is not None:
            results["metrics"]["faces_detected_count"] += 1
            bx, by, bw, bh = face["bbox"]["x"], face["bbox"]["y"], face["bbox"]["w"], face["bbox"]["h"]
            face_roi = gray_arr[by:by+bh, bx:bx+bw]

            if face_roi.size > 100:
                face_lap = compute_laplacian_variance(face_roi)

                pad = int(min(bw, bh) * 0.35)
                oy1, oy2 = max(0, by - pad), min(H, by + bh + pad)
                ox1, ox2 = max(0, bx - pad), min(W, bx + bw + pad)
                outer_roi = gray_arr[oy1:oy2, ox1:ox2]
                outer_lap = compute_laplacian_variance(outer_roi)

                if outer_lap > 20.0 and face_lap > 0:
                    ratio = face_lap / outer_lap
                    if ratio < 0.22:
                        frame_anomalies.append({
                            "type": "facial_texture_smoothing",
                            "severity": "moderate",
                            "label": "Facial Texture Smoothing Disparity",
                            "description": f"Facial region variance ({face_lap:.1f}) is abnormally smooth relative to context ({outer_lap:.1f}). Characteristic of autoencoder blending.",
                            "metric": f"Laplacian ratio {ratio:.2f}"
                        })

            # Check perimeter edge seam gradient
            top_edge = gray_arr[max(0, by-3):min(H, by+3), bx:bx+bw]
            if top_edge.shape[0] > 2 and top_edge.shape[1] > 4:
                edge_grad = np.abs(np.diff(top_edge.astype(np.float32), axis=0))
                edge_energy = float(np.mean(edge_grad))
                if edge_energy > 42.0:
                    frame_anomalies.append({
                        "type": "boundary_seam",
                        "severity": "moderate",
                        "label": "Facial Boundary Seam Discontinuity",
                        "description": f"Elevated edge energy along facial perimeter ({edge_energy:.1f}). Characteristic of composite face swap boundary artifacts.",
                        "metric": f"{edge_energy:.1f} edge gradient"
                    })

            # Face jitter
            if prev_face is not None:
                dx = face["center"][0] - prev_face["center"][0]
                dy = face["center"][1] - prev_face["center"][1]
                shift = math.sqrt(dx*dx + dy*dy)
                if shift > (bw * 0.65):
                    frame_anomalies.append({
                        "type": "facial_jitter",
                        "severity": "low",
                        "label": "Facial Coordinate Spatial Jitter",
                        "description": f"Abrupt spatial face displacement ({shift:.1f}px) across adjacent sampled interval.",
                        "metric": f"{shift:.1f}px shift"
                    })

            prev_face = face

        prev_gray = gray_arr.copy()

        # Update timeline item
        if frame_anomalies:
            timeline_item["isSuspicious"] = True
            timeline_item["anomalyCount"] = len(frame_anomalies)
            timeline_item["indicators"] = [a["type"] for a in frame_anomalies]
            has_mod = any(a["severity"] == "moderate" for a in frame_anomalies)
            timeline_item["severity"] = "moderate" if has_mod else "low"

            thumb_b64 = make_thumbnail_cv(img_bgr, face["bbox"] if face else None, max_width=320)
            timeline_item["previewThumbnail"] = thumb_b64

            for anom in frame_anomalies:
                results["suspicious_timestamps"].append({
                    "timestamp": timecode,
                    "seconds": round(time_sec, 2),
                    "frameNumber": frame_num,
                    "label": anom["label"],
                    "description": anom["description"],
                    "evidenceRef": f"Frame #{frame_num} ({timecode})",
                    "severity": anom["severity"],
                    "anomalyType": anom["type"],
                    "metricValue": anom.get("metric"),
                    "isHeuristic": True,
                    "faceDetected": face is not None,
                    "faceBoundingBox": timeline_item["faceBoundingBox"],
                    "previewThumbnail": thumb_b64,
                    "frameThumbnailUrl": thumb_b64
                })

        results["timeline"].append(timeline_item)

    if interframe_diffs:
        results["metrics"]["average_interframe_diff"] = round(float(np.mean(interframe_diffs)), 2)
    if blockiness_history:
        results["metrics"]["compression_variance"] = round(float(np.var(blockiness_history)), 4)

    # Convert anomalies into overarching DetectionIndicator objects
    anomaly_type_groups = {}
    for st in results["suspicious_timestamps"]:
        atype = st.get("anomalyType", "general")
        if atype not in anomaly_type_groups:
            anomaly_type_groups[atype] = []
        anomaly_type_groups[atype].append(st)

    for atype, items in anomaly_type_groups.items():
        highest_severity = "info"
        if any(i["severity"] == "critical" for i in items):
            highest_severity = "critical"
        elif any(i["severity"] == "high" for i in items):
            highest_severity = "high"
        elif any(i["severity"] == "moderate" for i in items):
            highest_severity = "moderate"
        elif any(i["severity"] == "low" for i in items):
            highest_severity = "low"

        count = len(items)
        sample = items[0]
        results["findings"].append({
            "id": f"ind-vid-py-{atype}",
            "category": "video",
            "type": atype.replace("_", " ").title(),
            "title": f"{sample['label']} ({count} instances)",
            "description": f"Algorithmic heuristic analysis detected {count} frame instances of {sample['label'].lower()}. {sample['description']}",
            "timestamp": sample["timestamp"],
            "frameNumber": sample["frameNumber"],
            "evidenceRef": f"{count} frames (first at {sample['timestamp']})",
            "severity": highest_severity,
            "isHeuristic": True,
            "humanReviewRecommendation": "Examine uncompressed camera master. Check facial boundaries for blending seams and temporal consistency across surrounding frames."
        })

    results["limitations"].append(
        "Heuristic video forensic indicators (boundary gradients, texture disparity, inter-frame shifts) reflect statistical anomalies and do not prove manipulation."
    )
    results["limitations"].append(
        "Video compression, camera motion, variable lighting, or re-encoding can induce false-positive boundary or texture disparity."
    )

    try:
        for f in frame_files:
            if os.path.exists(f):
                os.unlink(f)
        if os.path.exists(frames_dir):
            os.rmdir(frames_dir)
    except Exception:
        pass

    return results

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python video_forensics.py <video_path> <ffmpeg_path> [fps] [max_frames]"}))
        sys.exit(1)

    v_path = sys.argv[1]
    ff_path = sys.argv[2]
    fps_val = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    m_frames = int(sys.argv[4]) if len(sys.argv) > 4 else 60

    out = analyze_video(v_path, ff_path, fps=fps_val, max_frames=m_frames)
    print(json.dumps(out))
