"""
TruthLens Advanced Video Forensic Analyzer (OpenCV + YuNet Face Detection)

Performs:
1. Frame extraction at suitable intervals.
2. Face detection using OpenCV YuNet DNN.
3. Facial manipulation indicators (boundary blending, Laplacian variance disparity, landmark jitter).
4. Frame-level temporal inconsistencies.
5. Suspicious timestamps with frame numbers, explanations, and thumbnail previews.
6. Visual timeline segmentation.
7. Robust error handling for corrupted or unsupported video streams.
"""

import sys
import os
import json
import base64
import math
from pathlib import Path
import cv2
import numpy as np

def format_time(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    ms = int((seconds % 1) * 100)
    return f"{mins:02d}:{secs:02d}.{ms:02d}"

def encode_frame_to_base64(frame, max_width=440, quality=75) -> str:
    h, w = frame.shape[:2]
    if w > max_width:
        scale = max_width / float(w)
        frame = cv2.resize(frame, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA)
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    success, buffer = cv2.imencode('.jpg', frame, encode_param)
    if not success:
        return ""
    return f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('ascii')}"

def analyze_video(video_path: str, sample_interval_sec: float = 0.5, max_sample_frames: int = 25) -> dict:
    if not os.path.exists(video_path):
        return {
            "error": f"Video file not found at: {video_path}",
            "status": "failed",
            "isCorrupted": False
        }

    # Verify file is not empty
    if os.path.getsize(video_path) == 0:
        return {
            "error": "Corrupted video file: 0-byte file uploaded.",
            "status": "failed",
            "isCorrupted": True
        }

    # Attempt to open video with OpenCV VideoCapture
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {
            "error": "Corrupted or unsupported video stream: OpenCV could not demux or decode video frames.",
            "status": "failed",
            "isCorrupted": True
        }

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0 or math.isnan(fps):
        fps = 24.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration_sec = total_frames / fps if total_frames > 0 else 0.0

    if total_frames <= 0 or width <= 0 or height <= 0:
        cap.release()
        return {
            "error": "Corrupted video container: zero or invalid frame dimensions / frame count.",
            "status": "failed",
            "isCorrupted": True
        }

    # Locate and initialize YuNet Face Detector
    model_paths = [
        os.path.join(os.path.dirname(__file__), '..', '..', 'models', 'face_detection_yunet.onnx'),
        os.path.join(os.getcwd(), 'models', 'face_detection_yunet.onnx'),
        'models/face_detection_yunet.onnx'
    ]
    yunet_model = None
    for p in model_paths:
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            yunet_model = p
            break

    face_detector = None
    if yunet_model:
        try:
            face_detector = cv2.FaceDetectorYN_create(yunet_model, "", (width, height), score_threshold=0.6, nms_threshold=0.3)
        except Exception:
            face_detector = None

    # Step interval calculation
    frame_step = max(1, int(round(fps * sample_interval_sec)))
    if total_frames // frame_step > max_sample_frames:
        frame_step = max(1, total_frames // max_sample_frames)

    sampled_frames = []
    suspicious_timestamps = []
    previous_gray = None
    previous_face_box = None
    total_faces_detected = 0

    frame_idx = 0
    sampled_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_step == 0:
            current_time_sec = frame_idx / fps
            timestamp_str = format_time(current_time_sec)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            annotated_frame = frame.copy()

            frame_flags = []
            frame_reasons = []
            severity = 'info'
            has_suspicious_features = False
            detected_faces = []

            # 1. Face detection
            if face_detector is not None:
                try:
                    _, faces = face_detector.detect(frame)
                    if faces is not None and len(faces) > 0:
                        for face_data in faces:
                            fx, fy, fw, fh = int(face_data[0]), int(face_data[1]), int(face_data[2]), int(face_data[3])
                            conf = float(face_data[14])
                            # Landmarks: right eye, left eye, nose, right mouth, left mouth
                            landmarks = []
                            for l_idx in range(4, 14, 2):
                                landmarks.append((int(face_data[l_idx]), int(face_data[l_idx+1])))
                            detected_faces.append({
                                "box": (fx, fy, fw, fh),
                                "confidence": conf,
                                "landmarks": landmarks
                            })
                except Exception:
                    pass

            if len(detected_faces) > 0:
                total_faces_detected += len(detected_faces)
                for f_info in detected_faces:
                    fx, fy, fw, fh = f_info["box"]
                    conf = f_info["confidence"]

                    # Clamp to frame bounds
                    fx_c = max(0, fx)
                    fy_c = max(0, fy)
                    fw_c = min(width - fx_c, fw)
                    fh_c = min(height - fy_c, fh)

                    if fw_c < 20 or fh_c < 20:
                        continue

                    # Draw subtle bounding box and landmark points
                    cv2.rectangle(annotated_frame, (fx_c, fy_c), (fx_c + fw_c, fy_c + fh_c), (0, 215, 255), 2)
                    cv2.putText(annotated_frame, f"Face: {conf:.2f}", (fx_c, max(15, fy_c - 5)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 215, 255), 1)

                    for lx, ly in f_info["landmarks"]:
                        cv2.circle(annotated_frame, (lx, ly), 3, (0, 255, 120), -1)

                    # Facial Manipulation Indicator 1: Texture Disparity (Laplacian Variance)
                    face_roi = gray[fy_c:fy_c+fh_c, fx_c:fx_c+fw_c]
                    face_var = float(cv2.Laplacian(face_roi, cv2.CV_64F).var())

                    pad = int(min(fw_c, fh_c) * 0.35)
                    oy1 = max(0, fy_c - pad)
                    oy2 = min(height, fy_c + fh_c + pad)
                    ox1 = max(0, fx_c - pad)
                    ox2 = min(width, fx_c + fw_c + pad)
                    outer_roi = gray[oy1:oy2, ox1:ox2]
                    outer_var = float(cv2.Laplacian(outer_roi, cv2.CV_64F).var())

                    if outer_var > 20.0 and face_var > 0:
                        ratio = face_var / outer_var
                        if ratio < 0.22:
                            frame_flags.append('facial_texture_smoothing')
                            frame_reasons.append(
                                f"Facial texture variance ({face_var:.1f}) is abnormally smooth relative to context background ({outer_var:.1f}). Characteristic of generative blending or auto-encoder smoothing."
                            )
                            severity = 'medium'
                            has_suspicious_features = True
                        elif ratio > 4.2:
                            frame_flags.append('facial_noise_disparity')
                            frame_reasons.append(
                                f"Facial region exhibits elevated noise profile ({face_var:.1f}) inconsistent with background sensor noise ({outer_var:.1f})."
                            )
                            severity = 'low'
                            has_suspicious_features = True

                    # Facial Manipulation Indicator 2: Boundary Blending / Seam Gradient
                    # Check edge gradient around perimeter of facial bounding box
                    top_edge = gray[max(0, fy_c-3):min(height, fy_c+3), fx_c:fx_c+fw_c]
                    if top_edge.shape[0] > 2 and top_edge.shape[1] > 4:
                        edge_grad = cv2.Sobel(top_edge, cv2.CV_64F, 0, 1, ksize=3)
                        edge_energy = float(np.mean(np.abs(edge_grad)))
                        if edge_energy > 58.0:
                            frame_flags.append('boundary_seam_discontinuity')
                            frame_reasons.append(
                                f"Elevated edge gradient along facial perimeter ({edge_energy:.1f}). Characteristic of cut-and-paste face swap seam artifacts."
                            )
                            severity = 'medium'
                            has_suspicious_features = True

                    # Facial Manipulation Indicator 3: Temporal Location Displacement (Jitter)
                    if previous_face_box is not None:
                        p_x, p_y, p_w, p_h = previous_face_box
                        pos_shift = math.sqrt((fx_c - p_x)**2 + (fy_c - p_y)**2)
                        size_ratio = abs(fw_c - p_w) / float(max(1, p_w))
                        if pos_shift > (fw_c * 0.65) and size_ratio < 0.2:
                            frame_flags.append('temporal_face_displacement')
                            frame_reasons.append(
                                f"Abrupt spatial face coordinate displacement ({pos_shift:.1f}px) across adjacent sampled interval."
                            )
                            severity = 'low'
                            has_suspicious_features = True

                    previous_face_box = (fx_c, fy_c, fw_c, fh_c)
            else:
                previous_face_box = None

            # Frame-level Inconsistency Indicator: Inter-frame intensity delta
            if previous_gray is not None:
                diff = cv2.absdiff(gray, previous_gray)
                diff_mean = float(np.mean(diff))
                if diff_mean > 48.0:
                    frame_flags.append('frame_level_inconsistency')
                    frame_reasons.append(
                        f"Abrupt temporal intensity shift ({diff_mean:.1f} mean delta) between successive sampled intervals."
                    )
                    severity = 'low'
                    has_suspicious_features = True

            previous_gray = gray.copy()

            # Encode frame thumbnail
            thumbnail_b64 = encode_frame_to_base64(annotated_frame, max_width=400, quality=75)
            sampled_frames.append({
                "frameNumber": frame_idx,
                "timestamp": timestamp_str,
                "timeSeconds": round(current_time_sec, 2),
                "facesDetected": len(detected_faces),
                "hasSuspiciousFeatures": has_suspicious_features,
                "flags": frame_flags,
                "thumbnailUrl": thumbnail_b64
            })

            # Record suspicious timestamp if anomalies exist
            if has_suspicious_features:
                suspicious_timestamps.append({
                    "timestamp": timestamp_str,
                    "timeSeconds": round(current_time_sec, 2),
                    "frameIndex": frame_idx,
                    "label": " · ".join([f.replace('_', ' ').capitalize() for f in frame_flags]),
                    "description": " ".join(frame_reasons),
                    "evidenceRef": f"Frame #{frame_idx} ({len(detected_faces)} face(s) tracked)",
                    "severity": severity,
                    "frameThumbnailUrl": thumbnail_b64,
                    "indicators": frame_flags
                })

            sampled_count += 1
            if sampled_count >= max_sample_frames:
                break

        frame_idx += 1

    cap.release()

    # Generate visual timeline segments
    seg_step = max(0.5, duration_sec / 16.0) if duration_sec > 0 else 1.0
    current_seg_start = 0.0
    timeline_segments = []

    while current_seg_start < duration_sec:
        current_seg_end = min(duration_sec, current_seg_start + seg_step)
        matching_sus = [
            s for s in suspicious_timestamps
            if current_seg_start <= s["timeSeconds"] < current_seg_end
        ]

        status = 'suspicious' if len(matching_sus) > 0 else 'normal'
        reasons = [s["label"] for s in matching_sus if s.get("label")]

        timeline_segments.append({
            "startSeconds": round(current_seg_start, 2),
            "endSeconds": round(current_seg_end, 2),
            "startFormatted": format_time(current_seg_start),
            "endFormatted": format_time(current_seg_end),
            "status": status,
            "suspiciousCount": len(matching_sus),
            "reasons": reasons
        })
        current_seg_start = current_seg_end

    return {
        "status": "completed",
        "durationSeconds": round(duration_sec, 2),
        "durationFormatted": format_time(duration_sec),
        "totalFrames": total_frames,
        "sampledFrameCount": len(sampled_frames),
        "fps": round(fps, 2),
        "dimensions": {"width": width, "height": height},
        "totalFacesDetected": total_faces_detected,
        "faceDetectorUsed": "OpenCV YuNet Deep Neural Network" if face_detector is not None else "None (Model unavailable)",
        "sampledFrames": sampled_frames,
        "suspiciousTimestamps": suspicious_timestamps,
        "timelineSegments": timeline_segments
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python video_face_analyzer.py <video_path>"}))
        sys.exit(1)

    video_input = sys.argv[1]
    res = analyze_video(video_input)
    print(json.dumps(res))
