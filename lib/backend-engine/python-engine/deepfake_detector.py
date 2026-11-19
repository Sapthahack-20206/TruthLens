#!/usr/bin/env python3
"""
TruthLens Neural Deepfake Detection Engine
Provides pre-trained ONNX ViT deepfake classification, YuNet face region localization,
frame-by-frame video forensics, and acoustic spectral analysis.
"""

import sys
import os

# Suppress OpenCV DNN and FFmpeg warning outputs before importing cv2
os.environ["OPENCV_LOG_LEVEL"] = "FATAL"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"

import json
import argparse
import math
from pathlib import Path

# Paths to models
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
MODELS_DIR = BASE_DIR / "models"
VIT_MODEL_PATH = MODELS_DIR / "deepfake_vit_quantized.onnx"
YUNET_MODEL_PATH = (
    MODELS_DIR / "face_detection_yunet_2023mar.onnx"
    if (MODELS_DIR / "face_detection_yunet_2023mar.onnx").exists()
    else MODELS_DIR / "face_detection_yunet.onnx"
)

def eprint(*args, **kwargs):
    """Log to stderr to keep stdout pristine for JSON output."""
    print(*args, file=sys.stderr, **kwargs)

def check_models_available():
    """Verify presence of pre-trained model files and required libraries."""
    errors = []
    vit_exists = VIT_MODEL_PATH.exists() and VIT_MODEL_PATH.stat().st_size > 1000000
    yunet_exists = YUNET_MODEL_PATH.exists() and YUNET_MODEL_PATH.stat().st_size > 50000

    if not vit_exists:
        errors.append(f"ViT ONNX deepfake model missing at {VIT_MODEL_PATH}")
    if not yunet_exists:
        errors.append(f"YuNet face detection model missing at {YUNET_MODEL_PATH}")

    try:
        import onnxruntime
    except ImportError:
        errors.append("onnxruntime Python library is not installed.")

    try:
        import cv2
        if hasattr(cv2, 'utils') and hasattr(cv2.utils, 'logging'):
            cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)
    except ImportError:
        errors.append("OpenCV (cv2) Python library is not installed.")

    try:
        import numpy
    except ImportError:
        errors.append("numpy Python library is not installed.")

    try:
        from PIL import Image
    except ImportError:
        errors.append("Pillow (PIL) Python library is not installed.")

    return {
        "available": len(errors) == 0,
        "vitModel": vit_exists,
        "yunetModel": yunet_exists,
        "vitPath": str(VIT_MODEL_PATH),
        "yunetPath": str(YUNET_MODEL_PATH),
        "errors": errors
    }

class DeepfakeDetector:
    def __init__(self):
        import onnxruntime as ort
        import cv2

        if hasattr(cv2, 'utils') and hasattr(cv2.utils, 'logging'):
            cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)

        self.cv2 = cv2
        self.ort = ort

        # Load ViT deepfake classifier
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 2
        opts.intra_op_num_threads = 4
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self.vit_session = ort.InferenceSession(str(VIT_MODEL_PATH), opts, providers=['CPUExecutionProvider'])
        self.vit_input_name = self.vit_session.get_inputs()[0].name
        self.vit_output_name = self.vit_session.get_outputs()[0].name

        # YuNet face detector initialized lazily per input resolution
        self.yunet_path = str(YUNET_MODEL_PATH)

    def detect_faces(self, image_bgr, score_threshold=0.6):
        """Locate face regions in BGR image using OpenCV FaceDetectorYN."""
        h, w, _ = image_bgr.shape
        detector = self.cv2.FaceDetectorYN_create(
            self.yunet_path,
            "",
            (w, h),
            score_threshold=score_threshold,
            nms_threshold=0.3,
            top_k=5000
        )
        _, faces = detector.detect(image_bgr)
        results = []
        if faces is not None:
            for face in faces:
                x, y, bw, bh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
                conf = float(face[14])
                # Ensure bounding box is within image bounds
                x = max(0, x)
                y = max(0, y)
                bw = min(w - x, bw)
                bh = min(h - y, bh)
                if bw > 10 and bh > 10:
                    results.append({
                        "box": [x, y, bw, bh],
                        "confidence": conf
                    })
        return results

    def preprocess_image(self, img_rgb):
        """Preprocess an RGB numpy image for ViT (224x224, normalized mean 0.5, std 0.5)."""
        import numpy as np
        resized = self.cv2.resize(img_rgb, (224, 224), interpolation=self.cv2.INTER_LINEAR)
        # Rescale to [0, 1]
        norm = resized.astype(np.float32) / 255.0
        # Normalize: (pixel - mean) / std -> mean=0.5, std=0.5
        norm = (norm - 0.5) / 0.5
        # HWC -> CHW -> NCHW
        transposed = np.transpose(norm, (2, 0, 1))
        batch = np.expand_dims(transposed, axis=0).astype(np.float32)
        return batch

    def predict_patch(self, img_rgb):
        """Run ViT inference on an RGB image/patch and return (prob_deepfake, prob_real)."""
        import numpy as np
        tensor = self.preprocess_image(img_rgb)
        logits = self.vit_session.run([self.vit_output_name], {self.vit_input_name: tensor})[0][0]
        # Softmax
        exp_l = np.exp(logits - np.max(logits))
        probs = exp_l / np.sum(exp_l)
        prob_deepfake = float(probs[0])
        prob_real = float(probs[1])
        return prob_deepfake, prob_real

    def analyze_image(self, image_path, output_dir=None):
        """Comprehensive deepfake analysis for single image with face region localization."""
        import cv2
        import numpy as np

        image_path = Path(image_path)
        if not image_path.exists():
            return {"status": "error", "message": f"Image file not found: {image_path}"}

        img_bgr = cv2.imread(str(image_path))
        if img_bgr is None:
            return {"status": "error", "message": f"Could not decode image: {image_path}. Unsupported or corrupt format."}

        h, w, c = img_bgr.shape
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # 1. Full-image inference
        full_df_prob, full_real_prob = self.predict_patch(img_rgb)

        # 2. Face detection
        faces = self.detect_faces(img_bgr)
        suspicious_regions = []
        annotated_image_url = None

        highest_face_df_prob = 0.0
        most_suspicious_box = None

        # Check each face region
        for idx, f in enumerate(faces):
            bx, by, bw, bh = f["box"]
            # Add 15% margin around face to include boundary blending artifacts
            pad_x = int(bw * 0.15)
            pad_y = int(bh * 0.15)
            crop_x1 = max(0, bx - pad_x)
            crop_y1 = max(0, by - pad_y)
            crop_x2 = min(w, bx + bw + pad_x)
            crop_y2 = min(h, by + bh + pad_y)

            face_crop = img_rgb[crop_y1:crop_y2, crop_x1:crop_x2]
            if face_crop.shape[0] >= 20 and face_crop.shape[1] >= 20:
                face_df_prob, face_real_prob = self.predict_patch(face_crop)
                if face_df_prob > highest_face_df_prob:
                    highest_face_df_prob = face_df_prob
                    most_suspicious_box = [crop_x1, crop_y1, crop_x2 - crop_x1, crop_y2 - crop_y1]

                if face_df_prob >= 0.50:
                    suspicious_regions.append({
                        "id": f"region-face-{idx + 1}",
                        "box": [crop_x1, crop_y1, crop_x2 - crop_x1, crop_y2 - crop_y1],
                        "deepfakeProbability": round(face_df_prob * 100, 1),
                        "label": f"Facial Region #{idx + 1}: Manipulation Detected",
                        "description": f"Neural classifier detected deepfake artifacts within facial region (probability: {round(face_df_prob * 100, 1)}%). Look for boundary blending seams and eye/mouth texture discrepancies.",
                        "confidence": round(face_df_prob * 100, 1)
                    })

        # Calculate final combined model deepfake probability
        if len(faces) > 0:
            # When faces are present, weigh facial analysis heavily
            final_df_prob = max(highest_face_df_prob, full_df_prob)
        else:
            final_df_prob = full_df_prob

        final_real_prob = 1.0 - final_df_prob
        confidence_pct = round(max(final_df_prob, final_real_prob) * 100, 1)

        # 3. Generate visual annotation overlay if output_dir specified
        visualizations = []
        if output_dir:
            out_path = Path(output_dir)
            out_path.mkdir(parents=True, exist_ok=True)
            vis_filename = f"deepfake_model_{image_path.stem}.jpg"
            save_path = out_path / vis_filename

            annotated_bgr = img_bgr.copy()

            # Draw boxes for all detected faces
            for idx, f in enumerate(faces):
                bx, by, bw, bh = f["box"]
                is_flagged = any(sr["box"][0] <= bx and sr["box"][1] <= by for sr in suspicious_regions)
                
                color = (0, 0, 230) if is_flagged or final_df_prob > 0.6 else (0, 200, 240) if final_df_prob > 0.4 else (0, 200, 80)
                cv2.rectangle(annotated_bgr, (bx, by), (bx + bw, by + bh), color, 3)

                label_text = f"Face #{idx+1} (DF: {round(highest_face_df_prob*100)}%)" if is_flagged else f"Face #{idx+1}"
                cv2.putText(annotated_bgr, label_text, (bx, max(20, by - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)

            # Global header banner on visualization
            status_text = f"TruthLens ViT Model: {'DEEPFAKE / SYNTHETIC' if final_df_prob >= 0.50 else 'AUTHENTIC / NATURAL'} ({confidence_pct}%)"
            banner_bg = (15, 23, 42)
            cv2.rectangle(annotated_bgr, (0, 0), (w, 36), banner_bg, -1)
            banner_color = (60, 60, 245) if final_df_prob >= 0.50 else (60, 220, 120)
            cv2.putText(annotated_bgr, status_text, (12, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, banner_color, 2)

            cv2.imwrite(str(save_path), annotated_bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
            visualizations.append({
                "label": "Neural Model Localization Overlay",
                "url": f"/forensic-output/{vis_filename}"
            })

        # Explainable assessment verdict
        if final_df_prob >= 0.75:
            assessment = "High probability of deepfake or synthetic face manipulation."
            uncertainty_status = "Potentially Manipulated"
        elif final_df_prob >= 0.50:
            assessment = "Moderate deepfake indicators detected by neural classifier."
            uncertainty_status = "Potentially Manipulated"
        elif final_df_prob >= 0.25:
            assessment = "Minor non-conclusive anomalies detected; falls within natural variance."
            uncertainty_status = "Requires Further Review"
        else:
            assessment = "No significant neural deepfake patterns detected across image features."
            uncertainty_status = "No Significant Indicators Detected"

        return {
            "status": "success",
            "modelName": "ViT-Deepfake-Detection-v1",
            "modelVersion": "Exp-02-21",
            "deepfakeProbability": round(final_df_prob, 4),
            "realProbability": round(final_real_prob, 4),
            "confidence": confidence_pct,
            "predictedLabel": "Deepfake" if final_df_prob >= 0.50 else "Real",
            "assessment": assessment,
            "uncertaintyStatus": uncertainty_status,
            "facesCount": len(faces),
            "faces": faces,
            "suspiciousRegions": suspicious_regions,
            "visualizations": visualizations,
            "limitations": [
                "ViT model is trained on facial tampering and diffusion synthesis datasets; low-resolution (<224px) faces or extreme compression may lower confidence.",
                "Model score reflects statistical feature alignment with known manipulation artifacts; human examiner corroboration is required."
            ]
        }

    def analyze_video(self, video_path, output_dir=None, sample_fps=1.0, max_frames=60):
        """Extract keyframes and run neural deepfake model across temporal video stream."""
        import cv2

        video_path = Path(video_path)
        if not video_path.exists():
            return {"status": "error", "message": f"Video file not found: {video_path}"}

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            return {"status": "error", "message": f"Could not open video file: {video_path}. Unsupported codec or container."}

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        native_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        duration_sec = total_frames / native_fps if native_fps > 0 else 0.0

        # Frame step interval
        step = max(1, int(round(native_fps / max(0.1, sample_fps))))

        frame_results = []
        suspicious_timestamps = []
        visualizations = []
        anomalous_frames = []

        curr_frame_idx = 0
        analyzed_count = 0
        max_df_prob = 0.0
        sum_df_prob = 0.0

        top_suspicious_frame = None
        top_suspicious_score = -1.0
        top_suspicious_time = ""
        prev_gray = None
        duplicate_frames_skipped = 0

        while cap.isOpened() and analyzed_count < max_frames:
            ret, frame_bgr = cap.read()
            if not ret:
                break

            if curr_frame_idx % step == 0:
                h, w, _ = frame_bgr.shape
                gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
                if prev_gray is not None and prev_gray.shape == gray.shape:
                    diff = float(np.mean(np.abs(gray.astype(np.float32) - prev_gray.astype(np.float32))))
                    if diff < 1.0:
                        # Avoid unnecessary processing of identical or duplicate frames
                        duplicate_frames_skipped += 1
                        curr_frame_idx += 1
                        continue
                prev_gray = gray

                analyzed_count += 1
                timestamp_sec = curr_frame_idx / native_fps
                mins = int(timestamp_sec // 60)
                secs = int(timestamp_sec % 60)
                ms = int((timestamp_sec % 1) * 100)
                timecode = f"{mins:02d}:{secs:02d}.{ms:02d}"

                img_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

                # Predict full frame
                frame_df, frame_real = self.predict_patch(img_rgb)

                # Detect faces in frame
                faces = self.detect_faces(frame_bgr)
                highest_face_df = 0.0

                for f in faces:
                    bx, by, bw, bh = f["box"]
                    pad_x = int(bw * 0.15)
                    pad_y = int(bh * 0.15)
                    crop_x1 = max(0, bx - pad_x)
                    crop_y1 = max(0, by - pad_y)
                    crop_x2 = min(w, bx + bw + pad_x)
                    crop_y2 = min(h, by + bh + pad_y)
                    face_crop = img_rgb[crop_y1:crop_y2, crop_x1:crop_x2]
                    if face_crop.shape[0] >= 20 and face_crop.shape[1] >= 20:
                        f_df, _ = self.predict_patch(face_crop)
                        if f_df > highest_face_df:
                            highest_face_df = f_df

                effective_score = max(frame_df, highest_face_df) if len(faces) > 0 else frame_df
                sum_df_prob += effective_score
                if effective_score > max_df_prob:
                    max_df_prob = effective_score

                frame_info = {
                    "frameIndex": curr_frame_idx,
                    "timestamp": timecode,
                    "seconds": round(timestamp_sec, 2),
                    "score": round(effective_score, 4),
                    "facesCount": len(faces)
                }
                frame_results.append(frame_info)

                # Keep track of top suspicious frame for keyframe preview
                if effective_score > top_suspicious_score:
                    top_suspicious_score = effective_score
                    top_suspicious_frame = frame_bgr.copy()
                    top_suspicious_time = timecode

                # Flag suspicious timestamp if score >= 0.50
                if effective_score >= 0.50:
                    anomalous_frames.append(frame_info)
                    suspicious_timestamps.append({
                        "timestamp": timecode,
                        "seconds": round(timestamp_sec, 2),
                        "label": f"Neural Deepfake Frame Anomaly ({round(effective_score * 100)}%)",
                        "description": f"ViT classifier flagged frame #{curr_frame_idx} with {round(effective_score * 100)}% manipulation probability. Potential face-swap or synthetic boundary warping.",
                        "evidenceRef": f"Frame #{curr_frame_idx} ({timecode})",
                        "severity": "critical" if effective_score >= 0.75 else "high"
                    })

            curr_frame_idx += 1

        cap.release()

        # Save annotated keyframe if suspicious frame exists
        if output_dir and top_suspicious_frame is not None and top_suspicious_score >= 0.40:
            out_path = Path(output_dir)
            out_path.mkdir(parents=True, exist_ok=True)
            kf_filename = f"keyframe_suspicious_{video_path.stem}.jpg"
            kf_save_path = out_path / kf_filename

            # Annotate keyframe
            h, w, _ = top_suspicious_frame.shape
            cv2.rectangle(top_suspicious_frame, (0, 0), (w, 36), (15, 23, 42), -1)
            cv2.putText(
                top_suspicious_frame,
                f"Flagged Keyframe at {top_suspicious_time} (Manipulation Score: {round(top_suspicious_score*100)}%)",
                (12, 25),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (60, 60, 245) if top_suspicious_score >= 0.50 else (60, 200, 240),
                2
            )
            cv2.imwrite(str(kf_save_path), top_suspicious_frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            visualizations.append({
                "label": f"Flagged Suspicious Keyframe ({top_suspicious_time})",
                "url": f"/forensic-output/{kf_filename}"
            })

        avg_score = (sum_df_prob / analyzed_count) if analyzed_count > 0 else 0.0

        return {
            "status": "success",
            "modelName": "ViT-Deepfake-Detection-v1",
            "modelVersion": "Exp-02-21",
            "totalFramesAnalyzed": analyzed_count,
            "duplicateFramesSkipped": duplicate_frames_skipped,
            "nativeFps": round(native_fps, 2),
            "durationSec": round(duration_sec, 2),
            "maxDeepfakeScore": round(max_df_prob, 4),
            "meanDeepfakeScore": round(avg_score, 4),
            "anomalousFrameCount": len(anomalous_frames),
            "anomalousFrames": anomalous_frames,
            "suspiciousTimestamps": suspicious_timestamps,
            "visualizations": visualizations,
            "limitations": [
                f"Evaluated {analyzed_count} representative keyframes sampled uniformly at {sample_fps} fps.",
                "Neural detector analyzes 2D spatial face artifacts; temporal motion jitter and lip-sync alignment require cross-modal correlation."
            ]
        }

    def analyze_audio(self, audio_path, output_dir=None):
        """Perform acoustic frequency spectrum and vocoder artifact analysis."""
        import wave
        import numpy as np

        audio_path = Path(audio_path)
        if not audio_path.exists():
            return {"status": "error", "message": f"Audio file not found: {audio_path}"}

        try:
            with wave.open(str(audio_path), 'rb') as wf:
                channels = wf.getnchannels()
                sample_width = wf.getsampwidth()
                framerate = wf.getframerate()
                n_frames = wf.getnframes()
                raw_bytes = wf.readframes(n_frames)

            # Convert to numpy array
            if sample_width == 2:
                dtype = np.int16
            elif sample_width == 4:
                dtype = np.int32
            else:
                dtype = np.uint8

            data = np.frombuffer(raw_bytes, dtype=dtype)
            if channels > 1:
                data = data.reshape(-1, channels).mean(axis=1)

            # Normalize to [-1.0, 1.0]
            max_val = float(np.iinfo(dtype).max) if dtype != np.uint8 else 255.0
            data_norm = data.astype(np.float32) / max(max_val, 1.0)
            duration_sec = len(data_norm) / framerate if framerate > 0 else 0.0

            # 1. Compute FFT / Spectrogram metrics
            # Look at frequency energy distribution
            n_fft = 2048
            hop = 512
            if len(data_norm) > n_fft:
                # Simple windowed FFT
                window = np.hanning(n_fft)
                num_windows = min(200, (len(data_norm) - n_fft) // hop)
                specs = []
                for i in range(num_windows):
                    segment = data_norm[i * hop : i * hop + n_fft] * window
                    fft_res = np.abs(np.fft.rfft(segment))
                    specs.append(fft_res)
                spec_arr = np.array(specs) # shape: (num_windows, n_fft//2 + 1)
                
                # Frequency bins
                freqs = np.fft.rfftfreq(n_fft, 1.0 / framerate)
                
                # Detect artificial high-frequency vocoder cutoff (> 8000 Hz sharp drop)
                high_cutoff_idx = np.searchsorted(freqs, 8000)
                if high_cutoff_idx < len(freqs):
                    low_energy = np.mean(spec_arr[:, :high_cutoff_idx])
                    high_energy = np.mean(spec_arr[:, high_cutoff_idx:])
                    hf_ratio = float(high_energy / (low_energy + 1e-9))
                else:
                    hf_ratio = 0.5

                # Detect unnatural pitch flatness / robotic variance
                frame_stds = np.std(spec_arr, axis=0)
                mean_flux = float(np.mean(frame_stds))
            else:
                hf_ratio = 0.5
                mean_flux = 0.5

            # Calculate synthetic acoustic probability based on spectral properties
            synthetic_score = 0.0
            reasons = []

            # Synthetic speech models often lack high frequency harmonics above 8kHz
            if framerate >= 22050 and hf_ratio < 0.015:
                synthetic_score += 0.45
                reasons.append("Steep acoustic attenuation above 8 kHz (characteristic of neural vocoders like HiFi-GAN / MelGAN).")

            # Extremely low spectral flux can indicate robotic TTS
            if mean_flux < 0.02 and duration_sec > 1.0:
                synthetic_score += 0.35
                reasons.append("Unnaturally uniform spectral flux indicates synthesized acoustic timbre.")

            synthetic_score = min(0.95, max(0.05, synthetic_score))

            # 2. Render Spectrogram visualization
            visualizations = []
            if output_dir and len(data_norm) > n_fft:
                out_path = Path(output_dir)
                out_path.mkdir(parents=True, exist_ok=True)
                spec_filename = f"spectrogram_{audio_path.stem}.png"
                spec_save_path = out_path / spec_filename

                from PIL import Image, ImageOps
                # Downsample spectrogram into an image (width = num_windows, height = 256)
                img_data = np.log1p(spec_arr[:, :min(512, spec_arr.shape[1])])
                img_data = (img_data - np.min(img_data)) / (np.max(img_data) - np.min(img_data) + 1e-9)
                img_data = (img_data * 255).astype(np.uint8).T  # Transpose so freq is vertical
                img_data = np.flipud(img_data) # Low freq at bottom

                pil_img = Image.fromarray(img_data, mode='L')
                pil_img = pil_img.resize((600, 240), Image.Resampling.BILINEAR)
                # Colorize with cyan/indigo forensic theme
                colored = ImageOps.colorize(pil_img, black="#0f172a", white="#38bdf8", mid="#6366f1")
                colored.save(str(spec_save_path))

                visualizations.append({
                    "label": "Acoustic Spectrogram (STFT Frequency Map)",
                    "url": f"/forensic-output/{spec_filename}"
                })

            return {
                "status": "success",
                "sampleRate": framerate,
                "channels": channels,
                "durationSec": round(duration_sec, 2),
                "syntheticProbability": round(synthetic_score, 3),
                "highFreqRatio": round(hf_ratio, 4),
                "spectralFlux": round(mean_flux, 4),
                "reasons": reasons,
                "visualizations": visualizations,
                "limitations": [
                    "Acoustic spectral analysis evaluates vocoder frequency attenuation and timbre consistency.",
                    "Lossy compression codecs (e.g. MP3/AAC 64kbps) can also attenuate high frequencies; compare against clean reference."
                ]
            }
        except Exception as e:
            return {"status": "error", "message": f"Audio spectral analysis failed: {str(e)}"}

def main():
    parser = argparse.ArgumentParser(description="TruthLens Deepfake Detection Engine")
    parser.add_argument("--action", required=True, choices=["ping", "analyze_image", "analyze_video", "analyze_audio", "extract_frames"])
    parser.add_argument("--input", help="Path to input media file")
    parser.add_argument("--output_dir", help="Path to save forensic visualizations/outputs")
    parser.add_argument("--sample_fps", type=float, default=1.0, help="Frame extraction rate for video")
    parser.add_argument("--max_frames", type=int, default=60, help="Maximum video frames to sample")

    args = parser.parse_args()

    if args.action == "ping":
        status = check_models_available()
        print(json.dumps(status))
        sys.exit(0)

    # Verify model readiness
    status = check_models_available()
    if not status["available"]:
        print(json.dumps({"status": "error", "message": "Pre-trained models unavailable", "details": status["errors"]}))
        sys.exit(1)

    try:
        detector = DeepfakeDetector()
        if args.action == "analyze_image":
            if not args.input:
                print(json.dumps({"status": "error", "message": "Missing --input"}))
                sys.exit(1)
            result = detector.analyze_image(args.input, args.output_dir)
            print(json.dumps(result))

        elif args.action == "analyze_video":
            if not args.input:
                print(json.dumps({"status": "error", "message": "Missing --input"}))
                sys.exit(1)
            result = detector.analyze_video(args.input, args.output_dir, args.sample_fps, args.max_frames)
            print(json.dumps(result))

        elif args.action == "analyze_audio":
            if not args.input:
                print(json.dumps({"status": "error", "message": "Missing --input"}))
                sys.exit(1)
            result = detector.analyze_audio(args.input, args.output_dir)
            print(json.dumps(result))

        elif args.action == "extract_frames":
            # Direct video frame extraction via OpenCV
            import cv2
            cap = cv2.VideoCapture(args.input)
            if not cap.isOpened():
                print(json.dumps({"status": "error", "message": f"Cannot open video: {args.input}"}))
                sys.exit(1)

            out_dir = Path(args.output_dir or ".")
            out_dir.mkdir(parents=True, exist_ok=True)
            native_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            step = max(1, int(round(native_fps / max(0.1, args.sample_fps))))

            frame_idx = 0
            extracted = []
            while cap.isOpened() and len(extracted) < args.max_frames:
                ret, frame = cap.read()
                if not ret:
                    break
                if frame_idx % step == 0:
                    frame_name = f"frame_{len(extracted):04d}.jpg"
                    frame_path = out_dir / frame_name
                    cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                    extracted.append(str(frame_path))
                frame_idx += 1
            cap.release()
            print(json.dumps({"status": "success", "extractedFrames": extracted}))

    except Exception as ex:
        eprint(f"Exception during detection: {ex}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"status": "error", "message": str(ex)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
