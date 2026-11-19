"""
TruthLens Advanced Video Forensic Engine
Extracts video frames via FFmpeg, detects faces, analyzes biometric and visual manipulation indicators,
computes inter-frame temporal continuity, and produces structured forensic telemetry.
"""

import os
import sys
import json
import base64
import subprocess
from io import BytesIO
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage

def format_time(seconds):
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    ms = int(round((seconds % 1) * 100))
    return f"{mins:02d}:{secs:02d}.{ms:02d}"

def make_thumbnail(img, bbox=None, max_width=320):
    w, h = img.size
    scale = min(1.0, max_width / max(w, 1))
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    thumb = img.resize((new_w, new_h), Image.Resampling.BILINEAR).copy()

    if bbox:
        # Draw bounding box
        draw = ImageDraw.Draw(thumb)
        bx = int(bbox["x"] * scale)
        by = int(bbox["y"] * scale)
        bw = int(bbox["w"] * scale)
        bh = int(bbox["h"] * scale)
        # Red / Orange alert box
        draw.rectangle([bx, by, bx + bw, by + bh], outline="#f97316", width=2)
        # Corner brackets
        corner_len = min(8, bw // 3, bh // 3)
        draw.line([(bx, by), (bx + corner_len, by)], fill="#06b6d4", width=3)
        draw.line([(bx, by), (bx, by + corner_len)], fill="#06b6d4", width=3)
        draw.line([(bx + bw, by), (bx + bw - corner_len, by)], fill="#06b6d4", width=3)
        draw.line([(bx + bw, by), (bx + bw, by + corner_len)], fill="#06b6d4", width=3)

    buf = BytesIO()
    thumb.save(buf, format="JPEG", quality=75)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

def extract_frames(video_path, frames_dir, ffmpeg_path, fps=1, max_frames=60):
    os.makedirs(frames_dir, exist_ok=True)
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

def compute_laplacian_variance(gray_arr):
    # Laplacian filter: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
    lap = ndimage.laplace(gray_arr)
    return float(np.var(lap))

def compute_blockiness(gray_arr):
    # Detect 8x8 block boundary artifact energy (indicates re-compression / compression disparity)
    H, W = gray_arr.shape
    if H < 16 or W < 16:
        return 0.0
    # Horizontal difference across 8-pixel boundaries
    h_diff = np.abs(gray_arr[:, 7:W-1:8] - gray_arr[:, 8:W:8])
    # Horizontal difference within blocks (e.g. column 3 vs 4)
    h_intra = np.abs(gray_arr[:, 3:W-1:8] - gray_arr[:, 4:W:8])
    denom = float(np.mean(h_intra)) + 1e-4
    return float(np.mean(h_diff)) / denom

def detect_face(arr_rgb):
    # arr_rgb is (H, W, 3) float32
    H, W, _ = arr_rgb.shape
    R = arr_rgb[:, :, 0]
    G = arr_rgb[:, :, 1]
    B = arr_rgb[:, :, 2]

    Y = 0.299 * R + 0.587 * G + 0.114 * B
    Cb = -0.168736 * R - 0.331264 * G + 0.5 * B + 128
    Cr = 0.5 * R - 0.418688 * G - 0.081312 * B + 128

    # Skin color threshold
    skin_mask = (Cb >= 80) & (Cb <= 126) & (Cr >= 134) & (Cr <= 172) & (Y >= 40)

    # Morphological cleaning
    struct = np.ones((5, 5))
    opened = ndimage.binary_opening(skin_mask, structure=struct)
    closed = ndimage.binary_closing(opened, structure=struct)

    labeled, num_features = ndimage.label(closed)
    slices = ndimage.find_objects(labeled)

    min_area = (H * W) * 0.003
    max_area = (H * W) * 0.65

    candidate_faces = []
    for sl in slices:
        y_slice, x_slice = sl
        h = y_slice.stop - y_slice.start
        w = x_slice.stop - x_slice.start
        area = h * w
        if area < min_area or area > max_area:
            continue

        ratio = h / max(w, 1)
        if 0.8 <= ratio <= 2.4:
            face_roi_y = Y[y_slice, x_slice]
            y_std = float(np.std(face_roi_y))
            if y_std > 7.0:
                candidate_faces.append({
                    "x": int(x_slice.start),
                    "y": int(y_slice.start),
                    "w": int(w),
                    "h": int(h),
                    "area": int(area),
                    "aspect_ratio": round(ratio, 2),
                    "y_std": round(y_std, 2)
                })

    if not candidate_faces:
        return None

    # Pick the most prominent face candidate
    candidate_faces.sort(key=lambda f: f["area"], reverse=True)
    return candidate_faces[0]

def analyze_video(video_path, ffmpeg_path, fps=1, max_frames=60):
    results = {
        "status": "completed",
        "metadata": {},
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

    temp_id = os.path.splitext(os.path.basename(video_path))[0]
    frames_dir = os.path.join(os.environ.get("TEMP", "/tmp"), "truthlens-forensics", f"py_frames_{temp_id}")

    frame_files, exit_code, stderr = extract_frames(video_path, frames_dir, ffmpeg_path, fps=fps, max_frames=max_frames)

    if exit_code != 0 and len(frame_files) == 0:
        results["status"] = "failed"
        results["processing_errors"].append(f"FFmpeg extraction failed (exit code {exit_code}): {stderr.strip()[:200]}")
        return results

    if len(frame_files) == 0:
        results["status"] = "failed"
        results["processing_errors"].append("No valid frames could be decoded from video file. Container may be corrupted or codec unsupported.")
        return results

    results["metrics"]["total_frames_sampled"] = len(frame_files)

    # Frame processing loop
    prev_gray = None
    prev_face = None
    prev_blockiness = 0.0
    prev_luminance = 0.0
    interframe_diffs = []
    blockiness_history = []

    for idx, fpath in enumerate(frame_files):
        frame_num = idx + 1
        sec = idx / float(fps)
        timecode = format_time(sec)

        try:
            pil_img = Image.open(fpath).convert("RGB")
        except Exception as e:
            results["processing_errors"].append(f"Frame #{frame_num} is unreadable or corrupted: {str(e)}")
            continue

        arr = np.array(pil_img, dtype=np.float32)
        H, W, _ = arr.shape
        R, G, B = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
        gray = 0.299 * R + 0.587 * G + 0.114 * B
        mean_lum = float(np.mean(gray))
        lum_std = float(np.std(gray))

        blockiness = compute_blockiness(gray)
        blockiness_history.append(blockiness)

        # Detect face
        face = detect_face(arr)
        frame_anomalies = []

        # 1. Inter-frame difference (MSE & Temporal Splice)
        inter_mse = 0.0
        if prev_gray is not None and prev_gray.shape == gray.shape:
            inter_mse = float(np.mean((gray - prev_gray) ** 2))
            interframe_diffs.append(inter_mse)

            if inter_mse > 45.0:
                frame_anomalies.append({
                    "type": "temporal_splice",
                    "label": "Abrupt Inter-Frame Discontinuity",
                    "description": f"Mean squared error between consecutive frames spiked to {inter_mse:.1f}. Indicates possible scene splice, abrupt edit, or dropped frames.",
                    "severity": "moderate" if inter_mse < 80.0 else "high",
                    "metric": f"MSE={inter_mse:.1f}"
                })

            # Check sudden lighting / exposure flash
            lum_jump = abs(mean_lum - prev_luminance)
            if lum_jump > 30.0:
                frame_anomalies.append({
                    "type": "exposure_jump",
                    "label": "Sudden Exposure / Luminance Jump",
                    "description": f"Average frame luminance changed by {lum_jump:.1f} units in 1 frame interval.",
                    "severity": "low",
                    "metric": f"Delta-Y={lum_jump:.1f}"
                })

            # Check compression disparity
            if prev_blockiness > 0:
                block_ratio = abs(blockiness - prev_blockiness) / prev_blockiness
                if block_ratio > 2.8:
                    frame_anomalies.append({
                        "type": "compression_shift",
                        "label": "Compression Artifact Inconsistency",
                        "description": f"Quantization block boundary variance shifted by {block_ratio * 100:.0f}% relative to prior frame.",
                        "severity": "moderate",
                        "metric": f"Ratio={block_ratio:.2f}"
                    })

        # 2. Facial Biometric & Manipulation Analysis
        if face:
            results["metrics"]["faces_detected_count"] += 1
            fx, fy, fw, fh = face["x"], face["y"], face["w"], face["h"]
            face_roi_gray = gray[fy:fy+fh, fx:fx+fw]
            
            # Non-face background region (outer bounding region)
            bg_mask = np.ones((H, W), dtype=bool)
            pad_y1 = max(0, fy - 10)
            pad_y2 = min(H, fy + fh + 10)
            pad_x1 = max(0, fx - 10)
            pad_x2 = min(W, fx + fw + 10)
            bg_mask[pad_y1:pad_y2, pad_x1:pad_x2] = False
            bg_roi_gray = gray[bg_mask]

            # Texture Frequency Disparity (Laplacian variance ratio)
            face_lap_var = compute_laplacian_variance(face_roi_gray)
            bg_lap_var = compute_laplacian_variance(bg_roi_gray) if bg_roi_gray.size > 100 else 1.0
            lap_ratio = face_lap_var / max(bg_lap_var, 1.0)

            if lap_ratio < 0.25:
                frame_anomalies.append({
                    "type": "facial_texture",
                    "label": "Facial Texture Disparity (Oversmoothing)",
                    "description": f"High-frequency Laplacian variance in face ({face_lap_var:.1f}) is {lap_ratio:.2f}x of surrounding background ({bg_lap_var:.1f}). Characteristic of generative face-swap blending filters.",
                    "severity": "high",
                    "metric": f"TextureRatio={lap_ratio:.2f}"
                })
            elif lap_ratio > 3.8:
                frame_anomalies.append({
                    "type": "facial_texture",
                    "label": "Facial Texture Disparity (High-Frequency Ringing)",
                    "description": f"Facial region exhibits {lap_ratio:.1f}x higher spectral edge variance than background. Often observed with neural GAN upsampling or unsharp masking.",
                    "severity": "moderate",
                    "metric": f"TextureRatio={lap_ratio:.2f}"
                })

            # Boundary Edge Discontinuity (Warping / Alpha Mask seam)
            # Sample border perimeter of face
            sobel_y = np.abs(ndimage.sobel(gray, axis=0))
            sobel_x = np.abs(ndimage.sobel(gray, axis=1))
            sobel_mag = sobel_y + sobel_x

            # Inner edge band vs outer edge band along face perimeter
            band_inner = sobel_mag[fy:fy+fh, fx:fx+fw]
            mean_inner_edge = float(np.mean(band_inner)) if band_inner.size > 0 else 1.0
            
            # Sample boundary box perimeter (3-pixel thickness border)
            border_mask = np.zeros((H, W), dtype=bool)
            border_mask[max(0, fy-2):min(H, fy+3), fx:fx+fw] = True
            border_mask[max(0, fy+fh-3):min(H, fy+fh+2), fx:fx+fw] = True
            border_mask[fy:fy+fh, max(0, fx-2):min(W, fx+3)] = True
            border_mask[fy:fy+fh, max(0, fx+fw-3):min(W, fx+fw+2)] = True
            boundary_edge = float(np.mean(sobel_mag[border_mask])) if np.sum(border_mask) > 0 else 1.0

            edge_disparity = boundary_edge / max(mean_inner_edge, 1.0)
            if edge_disparity > 2.5:
                frame_anomalies.append({
                    "type": "facial_boundary",
                    "label": "Facial Boundary Edge Discontinuity",
                    "description": f"Perimeter seam gradient ({boundary_edge:.1f}) is {edge_disparity:.2f}x higher than internal facial texture. Potential indicator of composite mask boundary or Poisson blending seam.",
                    "severity": "high",
                    "metric": f"BoundaryRatio={edge_disparity:.2f}"
                })

            # Inter-Frame Face Jitter / Displacement without Camera Pan
            if prev_face is not None and prev_gray is not None:
                dx = abs(face["x"] - prev_face["x"]) / float(W)
                dy = abs(face["y"] - prev_face["y"]) / float(H)
                disp = np.sqrt(dx**2 + dy**2)
                area_ratio = abs(face["area"] - prev_face["area"]) / float(prev_face["area"])

                # If face jumped significantly but background stayed mostly stable
                if disp > 0.10 and inter_mse < 20.0:
                    frame_anomalies.append({
                        "type": "facial_jitter",
                        "label": "Inter-Frame Facial Jitter",
                        "description": f"Face location shifted by {disp*100:.1f}% across 1 frame while overall background remained stationary. Indicates temporal tracking flutter common in per-frame synthetic face replacement.",
                        "severity": "critical" if disp > 0.18 else "high",
                        "metric": f"Displacement={disp*100:.1f}%"
                    })

            prev_face = face
        else:
            prev_face = None

        prev_gray = gray
        prev_blockiness = blockiness
        prev_luminance = mean_lum

        # Generate base64 thumbnail for timeline & preview
        has_anomalies = len(frame_anomalies) > 0
        # Include thumbnails for anomalous frames or periodic keyframes
        thumb_b64 = make_thumbnail(pil_img, bbox=face if face else None, max_width=280)

        # Record timeline item
        worst_severity = "info"
        if any(a["severity"] == "critical" for a in frame_anomalies):
            worst_severity = "critical"
        elif any(a["severity"] == "high" for a in frame_anomalies):
            worst_severity = "high"
        elif any(a["severity"] == "moderate" for a in frame_anomalies):
            worst_severity = "moderate"
        elif any(a["severity"] == "low" for a in frame_anomalies):
            worst_severity = "low"

        timeline_item = {
            "frameNumber": frame_num,
            "seconds": round(sec, 2),
            "timestamp": timecode,
            "isSuspicious": has_anomalies,
            "anomalyCount": len(frame_anomalies),
            "faceDetected": face is not None,
            "faceBoundingBox": {
                "x": round(face["x"] / W, 4),
                "y": round(face["y"] / H, 4),
                "width": round(face["w"] / W, 4),
                "height": round(face["h"] / H, 4)
            } if face else None,
            "severity": worst_severity,
            "indicators": [a["label"] for a in frame_anomalies],
            "previewThumbnail": thumb_b64
        }
        results["timeline"].append(timeline_item)

        # Add to suspicious timestamps
        for anom in frame_anomalies:
            results["suspicious_timestamps"].append({
                "timestamp": timecode,
                "seconds": round(sec, 2),
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
                "previewThumbnail": thumb_b64
            })

    # Summary Metrics
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
        
        human_rec = "Examine uncompressed camera master. Check facial boundaries for blending seams and temporal consistency across surrounding frames."
        if atype == "temporal_splice":
            human_rec = "Inspect container metadata and audio track alignment at the indicated cut points to verify whether video was intentionally spliced."
        elif atype == "facial_jitter":
            human_rec = "Examine face landmarks in video editor frame-by-frame. Verify whether subject motion matches head inertia."

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
            "humanReviewRecommendation": human_rec
        })

    # Mandatory limitations
    results["limitations"].append(
        "Heuristic video forensic indicators (boundary gradients, texture disparity, inter-frame shifts) reflect statistical anomalies and do not prove manipulation."
    )
    results["limitations"].append(
        "Video compression, camera motion, variable lighting, or re-encoding can induce false-positive boundary or texture disparity."
    )

    # Clean up extracted frame files
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

    video_path = sys.argv[1]
    ffmpeg_path = sys.argv[2]
    fps = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    max_frames = int(sys.argv[4]) if len(sys.argv) > 4 else 60

    output = analyze_video(video_path, ffmpeg_path, fps=fps, max_frames=max_frames)
    print(json.dumps(output))
