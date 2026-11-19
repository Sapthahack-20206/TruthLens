import sys
import os
import math
import numpy as np
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from .config import VIT_MODEL_PATH, YUNET_MODEL_PATH

# Suppress noisy C++ logging
os.environ["OPENCV_LOG_LEVEL"] = "FATAL"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"

class DeepfakeDetectorService:
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

        self.vit_session = ort.InferenceSession(
            str(VIT_MODEL_PATH),
            opts,
            providers=['CPUExecutionProvider']
        )
        self.vit_input_name = self.vit_session.get_inputs()[0].name
        self.vit_output_name = self.vit_session.get_outputs()[0].name

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
                x = max(0, x)
                y = max(0, y)
                bw = min(w - x, bw)
                bh = min(h - y, bh)
                if bw > 10 and bh > 10:
                    results.append({
                        "box": [x, y, bw, bh],
                        "confidence": round(conf, 4)
                    })
        return results

    def preprocess_image(self, img_rgb):
        """Preprocess an RGB numpy image for ViT (224x224, normalized mean 0.5, std 0.5)."""
        resized = self.cv2.resize(img_rgb, (224, 224), interpolation=self.cv2.INTER_LINEAR)
        norm = resized.astype(np.float32) / 255.0
        norm = (norm - 0.5) / 0.5
        transposed = np.transpose(norm, (2, 0, 1))
        batch = np.expand_dims(transposed, axis=0).astype(np.float32)
        return batch

    def predict_patch(self, img_rgb) -> Tuple[float, float]:
        """Run ViT inference on an RGB image/patch and return (prob_deepfake, prob_real)."""
        tensor = self.preprocess_image(img_rgb)
        logits = self.vit_session.run([self.vit_output_name], {self.vit_input_name: tensor})[0][0]
        exp_l = np.exp(logits - np.max(logits))
        probs = exp_l / np.sum(exp_l)
        prob_deepfake = float(probs[0])
        prob_real = float(probs[1])
        return prob_deepfake, prob_real

    def analyze_image_bytes(self, image_bytes: bytes, filename: str = "image.jpg") -> Dict[str, Any]:
        """Analyze an image from raw bytes in-memory."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img_bgr = self.cv2.imdecode(nparr, self.cv2.IMREAD_COLOR)

        if img_bgr is None:
            raise ValueError(f"Could not decode image buffer for '{filename}'. Unsupported or corrupted format.")

        h, w, _ = img_bgr.shape
        img_rgb = self.cv2.cvtColor(img_bgr, self.cv2.COLOR_BGR2RGB)

        # 1. Full-image inference
        full_df_prob, full_real_prob = self.predict_patch(img_rgb)

        # 2. Face detection
        faces = self.detect_faces(img_bgr)
        suspicious_regions = []
        highest_face_df_prob = 0.0

        for idx, f in enumerate(faces):
            bx, by, bw, bh = f["box"]
            pad_x = int(bw * 0.15)
            pad_y = int(bh * 0.15)
            crop_x1 = max(0, bx - pad_x)
            crop_y1 = max(0, by - pad_y)
            crop_x2 = min(w, bx + bw + pad_x)
            crop_y2 = min(h, by + bh + pad_y)

            face_crop = img_rgb[crop_y1:crop_y2, crop_x1:crop_x2]
            if face_crop.shape[0] >= 20 and face_crop.shape[1] >= 20:
                face_df_prob, _ = self.predict_patch(face_crop)
                if face_df_prob > highest_face_df_prob:
                    highest_face_df_prob = face_df_prob

                if face_df_prob >= 0.50:
                    suspicious_regions.append({
                        "id": f"region-face-{idx + 1}",
                        "box": [crop_x1, crop_y1, crop_x2 - crop_x1, crop_y2 - crop_y1],
                        "deepfakeProbability": round(face_df_prob * 100, 1),
                        "label": f"Facial Region #{idx + 1}: Manipulation Detected",
                        "description": f"Neural classifier detected deepfake artifacts within facial region (probability: {round(face_df_prob * 100, 1)}%). Look for boundary blending seams and eye/mouth texture discrepancies.",
                        "confidence": round(face_df_prob * 100, 1)
                    })

        if len(faces) > 0:
            final_df_prob = max(highest_face_df_prob, full_df_prob)
        else:
            final_df_prob = full_df_prob

        final_real_prob = 1.0 - final_df_prob
        confidence_pct = round(max(final_df_prob, final_real_prob) * 100, 1)

        # Explainable verdict
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
            "visualizations": [],
            "limitations": [
                "ViT model is trained on facial tampering and diffusion synthesis datasets; low-resolution (<224px) faces or extreme compression may lower confidence.",
                "Model score reflects statistical feature alignment with known manipulation artifacts; human examiner corroboration is required."
            ]
        }

    def analyze_video_path(self, video_path: str, sample_fps: float = 1.0, max_frames: int = 45) -> Dict[str, Any]:
        """Analyze temporal frames of a video file."""
        cap = self.cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video file '{video_path}'. Unsupported codec or container.")

        total_frames = int(cap.get(self.cv2.CAP_PROP_FRAME_COUNT))
        native_fps = cap.get(self.cv2.CAP_PROP_FPS) or 25.0
        duration_sec = total_frames / native_fps if native_fps > 0 else 0.0

        step = max(1, int(round(native_fps / max(0.1, sample_fps))))

        frame_results = []
        suspicious_timestamps = []
        anomalous_frames = []

        curr_frame_idx = 0
        analyzed_count = 0
        max_df_prob = 0.0
        sum_df_prob = 0.0

        while cap.isOpened() and analyzed_count < max_frames:
            ret, frame_bgr = cap.read()
            if not ret:
                break

            if curr_frame_idx % step == 0:
                analyzed_count += 1
                timestamp_sec = curr_frame_idx / native_fps
                mins = int(timestamp_sec // 60)
                secs = int(timestamp_sec % 60)
                ms = int((timestamp_sec % 1) * 100)
                timecode = f"{mins:02d}:{secs:02d}.{ms:02d}"

                img_rgb = self.cv2.cvtColor(frame_bgr, self.cv2.COLOR_BGR2RGB)
                frame_df, _ = self.predict_patch(img_rgb)

                faces = self.detect_faces(frame_bgr)
                highest_face_df = 0.0

                for f in faces:
                    bx, by, bw, bh = f["box"]
                    pad_x = int(bw * 0.15)
                    pad_y = int(bh * 0.15)
                    crop_x1 = max(0, bx - pad_x)
                    crop_y1 = max(0, by - pad_y)
                    crop_x2 = min(frame_bgr.shape[1], bx + bw + pad_x)
                    crop_y2 = min(frame_bgr.shape[0], by + bh + pad_y)
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
        avg_score = (sum_df_prob / analyzed_count) if analyzed_count > 0 else 0.0

        return {
            "status": "success",
            "modelName": "ViT-Deepfake-Detection-v1",
            "modelVersion": "Exp-02-21",
            "totalFramesAnalyzed": analyzed_count,
            "nativeFps": round(native_fps, 2),
            "durationSec": round(duration_sec, 2),
            "maxDeepfakeScore": round(max_df_prob, 4),
            "meanDeepfakeScore": round(avg_score, 4),
            "anomalousFrameCount": len(anomalous_frames),
            "anomalousFrames": anomalous_frames,
            "suspiciousTimestamps": suspicious_timestamps,
            "visualizations": [],
            "limitations": [
                f"Evaluated {analyzed_count} representative keyframes sampled uniformly at {sample_fps} fps.",
                "Neural detector analyzes 2D spatial face artifacts; temporal motion jitter and lip-sync alignment require cross-modal correlation."
            ]
        }

    def analyze_audio_path(self, audio_path: str) -> Dict[str, Any]:
        """Perform acoustic frequency spectrum and vocoder artifact analysis."""
        import wave

        try:
            with wave.open(audio_path, 'rb') as wf:
                channels = wf.getnchannels()
                sample_width = wf.getsampwidth()
                framerate = wf.getframerate()
                n_frames = wf.getnframes()
                raw_bytes = wf.readframes(n_frames)
        except Exception as e:
            raise ValueError(f"Could not open audio file as standard WAV: {str(e)}")

        duration = n_frames / float(framerate) if framerate > 0 else 0.0

        if sample_width == 2:
            samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        elif sample_width == 1:
            samples = (np.frombuffer(raw_bytes, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        else:
            samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        if channels > 1:
            samples = samples[::channels]

        if len(samples) < 512:
            return {
                "status": "success",
                "sampleRate": framerate,
                "channels": channels,
                "durationSec": round(duration, 2),
                "syntheticProbability": 0.15,
                "highFreqRatio": 0.5,
                "spectralFlux": 0.0,
                "reasons": ["Audio sample duration is too short for acoustic spectral triangulation."],
                "visualizations": [],
                "limitations": ["Audio sample duration must exceed 0.5 seconds for spectral triangulation."]
            }

        fft_size = 1024
        window = np.hanning(fft_size)
        hop_size = 512

        stft_frames = []
        for i in range(0, len(samples) - fft_size, hop_size):
            chunk = samples[i:i + fft_size] * window
            spectrum = np.abs(np.fft.rfft(chunk))
            stft_frames.append(spectrum)

        if not stft_frames:
            stft_frames = [np.abs(np.fft.rfft(samples[:min(len(samples), fft_size)]))]

        stft_matrix = np.array(stft_frames)
        mean_spec = np.mean(stft_matrix, axis=0)

        n_bins = len(mean_spec)
        split_bin = int(n_bins * 0.75)
        low_energy = float(np.sum(mean_spec[:split_bin]))
        high_energy = float(np.sum(mean_spec[split_bin:]))
        total_energy = low_energy + high_energy + 1e-12

        hf_ratio = high_energy / total_energy

        diffs = np.diff(stft_matrix, axis=0)
        flux_per_frame = np.sqrt(np.sum(np.maximum(0, diffs) ** 2, axis=1)) if len(diffs) > 0 else np.array([0.0])
        mean_flux = float(np.mean(flux_per_frame)) if len(flux_per_frame) > 0 else 0.0

        synthetic_score = 0.12
        reasons = []

        if hf_ratio < 0.015:
            synthetic_score += 0.38
            reasons.append("Severe high-frequency cutoff detected above 6 kHz (characteristic of older neural neural vocoders or low-bitrate compression).")
        elif hf_ratio < 0.035:
            synthetic_score += 0.18
            reasons.append("Attenuated high-frequency band energy detected; typical in synthetic speech generation.")

        if mean_flux < 0.04 and duration > 1.5:
            synthetic_score += 0.28
            reasons.append("Unnaturally low spectral flux across phonetic transitions (suggests robotic prosody or uniform acoustic synthesis).")

        synthetic_score = min(0.95, max(0.05, synthetic_score))

        return {
            "status": "success",
            "sampleRate": framerate,
            "channels": channels,
            "durationSec": round(duration, 2),
            "syntheticProbability": round(synthetic_score, 3),
            "highFreqRatio": round(hf_ratio, 4),
            "spectralFlux": round(mean_flux, 4),
            "reasons": reasons,
            "visualizations": [],
            "limitations": [
                "Acoustic spectral analysis evaluates vocoder frequency attenuation and timbre consistency.",
                "Lossy compression codecs (e.g. MP3/AAC 64kbps) can also attenuate high frequencies; compare against clean reference."
            ]
        }

def get_detector() -> DeepfakeDetectorService:
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = DeepfakeDetectorService()
    return _detector_instance

_detector_instance: Optional[DeepfakeDetectorService] = None
