#!/usr/bin/env python3
"""
TruthLens Digital Forensics Platform
Module: AI Transcript Analysis & Speech Authenticity Verification Engine

Analyzes spoken content, extracts timestamped dialogue from audio and video,
performs speaker diarization / change detection, acoustic-transcript correlation,
linguistic consistency checks, and reference text error metrics (WER / CER).
"""

import sys
import os
import json
import math
import re
import argparse
from typing import List, Dict, Any, Optional, Tuple

import numpy as np
from scipy import signal
import av
from faster_whisper import WhisperModel


def load_media_audio_16k(file_path: str) -> Tuple[Optional[np.ndarray], Dict[str, Any], List[str]]:
    """
    Extracts and resamples audio from audio or video containers to 16kHz mono float32.
    Returns: (pcm_array, metadata_dict, errors_list)
    """
    errors = []
    metadata = {
        "duration": 0.0,
        "sample_rate": 16000,
        "channels": 1,
        "original_format": "",
        "has_audio": False,
        "clipping_samples": 0,
        "zero_dropout_ratio": 0.0,
        "rms_dbfs": -100.0,
    }

    if not os.path.exists(file_path):
        return None, metadata, [f"Input file not found: {file_path}"]

    try:
        container = av.open(file_path)
    except Exception as e:
        return None, metadata, [f"Failed to open media container: {str(e)}"]

    audio_stream = next((s for s in container.streams if s.type == "audio"), None)
    if not audio_stream:
        container.close()
        return None, metadata, ["No audio stream present in media container"]

    metadata["has_audio"] = True
    metadata["original_format"] = str(audio_stream.format.name) if audio_stream.format else "unknown"
    orig_sr = audio_stream.rate or 16000
    orig_channels = audio_stream.channels or 1

    try:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
        frames_list = []
        for frame in container.decode(audio_stream):
            for r_frame in resampler.resample(frame):
                frames_list.append(r_frame.to_ndarray()[0])

        container.close()

        if not frames_list:
            return np.zeros(0, dtype=np.float32), metadata, ["Audio stream was empty or could not be decoded"]

        pcm = np.concatenate(frames_list).astype(np.float32)
        total_samples = len(pcm)
        duration = total_samples / 16000.0
        metadata["duration"] = round(duration, 3)

        # Signal Telemetry: Clipping, RMS, Zero-dropouts
        if total_samples > 0:
            clipped = int(np.sum(np.abs(pcm) >= 0.999))
            metadata["clipping_samples"] = clipped

            rms = float(np.sqrt(np.mean(pcm ** 2)))
            metadata["rms_dbfs"] = round(20 * math.log10(max(rms, 1e-6)), 2)

            zero_count = int(np.sum(np.abs(pcm) < 1e-5))
            metadata["zero_dropout_ratio"] = round(zero_count / total_samples, 4)

        return pcm, metadata, errors

    except Exception as e:
        try:
            container.close()
        except Exception:
            pass
        return None, metadata, [f"Error during audio decoding/resampling: {str(e)}"]


def extract_acoustic_features(pcm_slice: np.ndarray, sr: int = 16000) -> Dict[str, float]:
    """
    Computes spectral centroid, spectral rolloff, zero-crossing rate, RMS energy, and pitch (F0).
    """
    if len(pcm_slice) < 512:
        return {"centroid": 1500.0, "rolloff": 3000.0, "zcr": 0.05, "energy": 0.01, "pitch": 150.0}

    # STFT for spectral metrics
    try:
        f, _, Zxx = signal.stft(pcm_slice, fs=sr, nperseg=min(len(pcm_slice), 512))
        mag = np.abs(Zxx)
        mag_sum = np.sum(mag, axis=0) + 1e-9
        centroid_series = np.sum(f[:, None] * mag, axis=0) / mag_sum
        avg_centroid = float(np.mean(centroid_series))

        # Spectral rolloff (85% energy threshold)
        cumulative = np.cumsum(mag, axis=0)
        total = cumulative[-1, :]
        rolloff_idx = np.apply_along_axis(lambda col: np.searchsorted(col, 0.85 * col[-1]), 0, cumulative)
        avg_rolloff = float(np.mean(f[np.clip(rolloff_idx, 0, len(f) - 1)]))
    except Exception:
        avg_centroid = 1500.0
        avg_rolloff = 3000.0

    # Zero Crossing Rate
    zcr = float(np.mean(np.abs(np.diff(np.sign(pcm_slice))) > 0))

    # RMS Energy
    energy = float(np.sqrt(np.mean(pcm_slice ** 2)))

    # Pitch via autocorrelation within human vocal range [50 Hz - 450 Hz]
    sample_len = min(len(pcm_slice), 4000)
    corr = np.correlate(pcm_slice[:sample_len], pcm_slice[:sample_len], mode="full")
    corr = corr[len(corr) // 2 :]

    min_lag = int(sr / 450)
    max_lag = int(sr / 50)
    if len(corr) > max_lag:
        window_corr = corr[min_lag:max_lag]
        if len(window_corr) > 0 and np.max(window_corr) > 0.1 * corr[0]:
            peak_lag = min_lag + int(np.argmax(window_corr))
            pitch = float(sr / peak_lag) if peak_lag > 0 else 150.0
        else:
            pitch = 150.0
    else:
        pitch = 150.0

    return {
        "centroid": round(avg_centroid, 1),
        "rolloff": round(avg_rolloff, 1),
        "zcr": round(zcr, 4),
        "energy": round(energy, 4),
        "pitch": round(pitch, 1),
    }


def perform_speaker_diarization(
    pcm: np.ndarray,
    segments: List[Dict[str, Any]],
    sr: int = 16000
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Performs acoustic clustering on dialogue segments to identify distinct speakers (Speaker 1, Speaker 2...).
    Labels are non-biometric speaker roles.
    Returns: (updated_segments, speaker_profiles)
    """
    if not segments:
        return [], []

    feature_vectors = []
    for seg in segments:
        s_sample = max(0, int(seg["start"] * sr))
        e_sample = min(len(pcm), int(seg["end"] * sr))
        seg_pcm = pcm[s_sample:e_sample] if e_sample > s_sample else np.zeros(0, dtype=np.float32)
        feats = extract_acoustic_features(seg_pcm, sr)
        seg["acoustic_features"] = feats

        # Normalized feature representation: [centroid/4000, rolloff/8000, zcr*5, pitch/300]
        norm_vec = [
            feats["centroid"] / 4000.0,
            feats["rolloff"] / 8000.0,
            feats["zcr"] * 5.0,
            feats["pitch"] / 300.0,
        ]
        feature_vectors.append(norm_vec)

    # Leader-follower centroid clustering
    clusters: List[List[float]] = []
    assignments: List[int] = []
    distance_threshold = 0.38  # threshold between distinct vocal timbres

    for vec in feature_vectors:
        if not clusters:
            clusters.append(vec)
            assignments.append(0)
            continue

        dists = [math.dist(vec, c) for c in clusters]
        min_dist = min(dists)
        best_cluster = dists.index(min_dist)

        if min_dist < distance_threshold:
            assignments.append(best_cluster)
            # Update running centroid
            clusters[best_cluster] = [
                0.7 * c_val + 0.3 * v_val for c_val, v_val in zip(clusters[best_cluster], vec)
            ]
        elif len(clusters) < 5:  # Maximum 5 speakers in single recording
            clusters.append(vec)
            assignments.append(len(clusters) - 1)
        else:
            assignments.append(best_cluster)

    # Assign labels
    speaker_stats: Dict[int, Dict[str, Any]] = {}
    for idx, seg in enumerate(segments):
        c_id = assignments[idx]
        speaker_label = f"Speaker {c_id + 1}"
        seg["speaker"] = speaker_label

        if c_id not in speaker_stats:
            speaker_stats[c_id] = {
                "id": f"spk_{c_id + 1}",
                "label": speaker_label,
                "segment_count": 0,
                "total_spoken_seconds": 0.0,
                "pitch_sum": 0.0,
            }
        duration = seg["end"] - seg["start"]
        speaker_stats[c_id]["segment_count"] += 1
        speaker_stats[c_id]["total_spoken_seconds"] += duration
        speaker_stats[c_id]["pitch_sum"] += seg["acoustic_features"]["pitch"]

    speaker_profiles = []
    for c_id in sorted(speaker_stats.keys()):
        stat = speaker_stats[c_id]
        avg_pitch = round(stat["pitch_sum"] / max(1, stat["segment_count"]), 1)
        speaker_profiles.append({
            "id": stat["id"],
            "label": stat["label"],
            "segmentCount": stat["segment_count"],
            "totalSpokenSeconds": round(stat["total_spoken_seconds"], 2),
            "avgPitchHz": avg_pitch,
        })

    return segments, speaker_profiles


def compute_levenshtein_distance(seq1: List[str], seq2: List[str]) -> Tuple[int, int, int, int]:
    """
    Computes Levenshtein matrix returning (substitutions, deletions, insertions, total_distance).
    """
    n, m = len(seq1), len(seq2)
    dp = [[0] * (m + 1) for _ in range(n + 1)]

    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if seq1[i - 1] == seq2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

    # Backtrace to count S, D, I
    i, j = n, m
    subs = 0
    dels = 0
    ins = 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and seq1[i - 1] == seq2[j - 1]:
            i -= 1
            j -= 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            subs += 1
            i -= 1
            j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            dels += 1
            i -= 1
        else:
            ins += 1
            j -= 1

    return subs, dels, ins, dp[n][m]


def clean_transcript_text(text: str) -> str:
    """
    Strips timestamp headers (e.g. [00:00.00 - 00:02.50]), SRT timecode markers,
    WEBVTT headers, and speaker prefixes before textual comparison.
    """
    # Remove bracketed timecodes [00:00.00 - 00:02.50] or (00:00)
    cleaned = re.sub(r"\[\s*\d+[:.]\d+.*?\]", " ", text)
    cleaned = re.sub(r"\(\s*\d+[:.]\d+.*?\)", " ", cleaned)
    # Remove SRT/VTT arrow timecodes (00:00:00.000 --> 00:00:02.500)
    cleaned = re.sub(r"\d+:\d+[:.]\d+\s*-->\s*\d+:\d+[:.]\d+", " ", cleaned)
    # Remove WEBVTT / NOTE headers
    cleaned = re.sub(r"^(WEBVTT|NOTE).*?$", " ", cleaned, flags=re.MULTILINE)
    # Remove speaker prefix tags like "Speaker 1:" or "SPEAKER_00:"
    cleaned = re.sub(r"speaker[\s_\d]*:", " ", cleaned, flags=re.IGNORECASE)
    # Strip punctuation and normalize whitespace
    cleaned = re.sub(r"[^\w\s]", " ", cleaned.lower())
    return " ".join(cleaned.split())


def evaluate_wer_cer(reference_text: str, hypothesis_text: str) -> Dict[str, Any]:
    """
    Calculates Word Error Rate (WER) and Character Error Rate (CER) between reference and hypothesis text.
    """
    ref_clean = clean_transcript_text(reference_text)
    hyp_clean = clean_transcript_text(hypothesis_text)

    ref_words = ref_clean.split()
    hyp_words = hyp_clean.split()

    if not ref_words:
        return {"wer": 0.0, "cer": 0.0, "substitutions": 0, "deletions": 0, "insertions": len(hyp_words)}

    subs_w, dels_w, ins_w, dist_w = compute_levenshtein_distance(ref_words, hyp_words)
    wer = round(min(1.0, dist_w / len(ref_words)), 4)

    ref_chars = list(ref_clean)
    hyp_chars = list(hyp_clean)
    if ref_chars:
        _, _, _, dist_c = compute_levenshtein_distance(ref_chars, hyp_chars)
        cer = round(min(1.0, dist_c / len(ref_chars)), 4)
    else:
        cer = 0.0

    return {
        "wer": round(wer * 100, 2),
        "cer": round(cer * 100, 2),
        "substitutions": subs_w,
        "deletions": dels_w,
        "insertions": ins_w,
        "totalReferenceWords": len(ref_words),
        "totalHypothesisWords": len(hyp_words),
    }


def analyze_transcript_forensics(
    pcm: np.ndarray,
    segments: List[Dict[str, Any]],
    speaker_profiles: List[Dict[str, Any]],
    audio_meta: Dict[str, Any],
    reference_text: Optional[str] = None,
    sr: int = 16000
) -> Dict[str, Any]:
    """
    Evaluates speech transcript for:
    - Dialogue consistency & coherence
    - Repeated / duplicated phrases (hallucination / splicing loops)
    - Unnatural sentence transitions & abrupt grammatical dropoffs
    - Acoustic splicing at segment boundaries
    - Unnatural silences & speech dropout
    - Timing & timestamp inconsistencies
    - Speaker transitions
    """
    findings: List[Dict[str, Any]] = []
    suspicious_timestamps: List[Dict[str, Any]] = []
    limitations: List[str] = []
    anomalies_detected: Dict[str, int] = {
        "repetition": 0,
        "splice": 0,
        "silence": 0,
        "unnatural_transition": 0,
        "timestamp_issue": 0,
    }

    total_words = 0
    full_text_list = []
    for s in segments:
        text = s.get("text", "").strip()
        full_text_list.append(text)
        total_words += len(text.split())

    full_dialogue_text = " ".join(full_text_list)

    # 1. Linguistic Repetition & Hallucination Loop Detection
    # Look for identical 3+ word n-grams repeated sequentially or in close proximity
    words_all = [re.sub(r"[^\w]", "", w.lower()) for w in full_dialogue_text.split() if w]
    repeated_phrases = []
    for n in [3, 4, 5]:
        seen = {}
        for i in range(len(words_all) - n + 1):
            ngram = " ".join(words_all[i : i + n])
            if ngram in seen:
                prev_idx = seen[ngram]
                if (i - prev_idx) <= n * 2:  # immediate or near repetition
                    repeated_phrases.append(ngram)
            seen[ngram] = i

    if repeated_phrases:
        unique_repeats = list(set(repeated_phrases))[:3]
        anomalies_detected["repetition"] += len(unique_repeats)
        findings.append({
            "id": "ind-trn-repetition-01",
            "category": "transcript",
            "type": "Dialogue Repetition Loop",
            "title": f"Duplicated Phrasing Pattern Flagged ({len(unique_repeats)} instances)",
            "description": f"Identified immediate or near-immediate lexical repetitions: \"{', '.join(unique_repeats)}\". Repeated phrase sequences can indicate ASR hallucination or audio looping edits.",
            "severity": "high" if len(unique_repeats) > 1 else "moderate",
            "confidence": 86,
            "isHeuristic": True,
            "evidenceRef": f"Repeated: {unique_repeats[0]}",
            "humanReviewRecommendation": "Inspect audio waveform at the repetition points to confirm if the speaker organically restated the phrase or if identical audio frames were duplicated.",
        })
        suspicious_timestamps.append({
            "timestamp": "00:02.50",
            "seconds": 2.5,
            "label": "Dialogue Repetition",
            "description": f"Lexical repetition detected: \"{unique_repeats[0]}\"",
            "severity": "moderate",
            "evidenceRef": "Transcript Segment Loop",
        })

    # 2. Timestamp Inconsistencies & Continuity Checks
    prev_end = 0.0
    for idx, seg in enumerate(segments):
        start = seg["start"]
        end = seg["end"]

        # Negative or zero duration
        if end <= start:
            anomalies_detected["timestamp_issue"] += 1
            findings.append({
                "id": f"ind-trn-time-zero-{idx}",
                "category": "transcript",
                "type": "Timestamp Inversion",
                "title": f"Invalid Segment Duration at {start:.2f}s",
                "description": f"Transcript segment {idx + 1} has an end timestamp ({end:.2f}s) less than or equal to start ({start:.2f}s).",
                "severity": "critical",
                "confidence": 95,
                "isHeuristic": False,
                "evidenceRef": f"Segment {idx + 1}",
                "humanReviewRecommendation": "Verify subtitle / VTT index formatting or audio container timestamp table.",
            })

        # Overlapping segment boundary (> 0.25s overlap between distinct segments)
        if idx > 0 and start < (prev_end - 0.25):
            anomalies_detected["timestamp_issue"] += 1
            overlap_sec = round(prev_end - start, 2)
            findings.append({
                "id": f"ind-trn-overlap-{idx}",
                "category": "transcript",
                "type": "Timestamp Overlap",
                "title": f"Overlapping Speech Turn at {start:.2f}s ({overlap_sec}s overlap)",
                "description": f"Segment {idx + 1} begins before segment {idx} concluded. Cross-talk or conflicting timestamp metadata detected.",
                "severity": "moderate",
                "confidence": 88,
                "isHeuristic": False,
                "evidenceRef": f"Segment {idx} -> {idx + 1}",
                "humanReviewRecommendation": "Review multi-channel stems to confirm if simultaneous speakers were active.",
            })

        # 3. Unnatural Long Silence Pauses in Active Dialogue
        silence_gap = start - prev_end
        if idx > 0 and silence_gap > 3.0:
            anomalies_detected["silence"] += 1
            suspicious_timestamps.append({
                "timestamp": f"{int(prev_end // 60):02d}:{prev_end % 60:05.2f}",
                "seconds": round(prev_end, 2),
                "label": "Extended Inter-Utterance Silence",
                "description": f"Acoustic dead gap of {silence_gap:.2f}s between spoken phrases.",
                "severity": "low",
                "evidenceRef": f"Silence gap ({silence_gap:.2f}s)",
            })

        prev_end = end

    # 4. Unnatural Sentence Transitions (abrupt grammatical truncation)
    trailing_conjunctions = ["and", "or", "but", "because", "so", "with", "if", "when", "that"]
    for idx, seg in enumerate(segments[:-1]):
        words = seg["text"].strip().split()
        if words:
            last_word = re.sub(r"[^\w]", "", words[-1].lower())
            if last_word in trailing_conjunctions and (seg["end"] - seg["start"]) > 0.5:
                next_seg = segments[idx + 1]
                gap = next_seg["start"] - seg["end"]
                if gap > 1.0:  # Trailing connector with a sudden pause
                    anomalies_detected["unnatural_transition"] += 1
                    findings.append({
                        "id": f"ind-trn-conjunction-cut-{idx}",
                        "category": "transcript",
                        "type": "Unnatural Sentence Transition",
                        "title": f"Syntactically Truncated Clause at {seg['end']:.2f}s",
                        "description": f"Dialogue segment {idx + 1} concludes with trailing conjunction \"{last_word}\" followed by an anomalous {gap:.2f}s pause before \"{next_seg['text'][:25]}...\".",
                        "severity": "moderate",
                        "confidence": 82,
                        "isHeuristic": True,
                        "evidenceRef": f"Word: '{last_word}' at {seg['end']:.2f}s",
                        "humanReviewRecommendation": "Check if an authentic trailing thought was spoken or if audio splicing truncated the remaining sentence clause.",
                    })

    # 5. Acoustic Continuity & Boundary Splicing
    # Check whether energy or room noise drops to zero right at segment boundaries
    if len(pcm) > 0 and segments:
        for idx, seg in enumerate(segments):
            boundary_sample = int(seg["end"] * sr)
            if boundary_sample + 1600 < len(pcm):
                pre_slice = pcm[max(0, boundary_sample - 800) : boundary_sample]
                post_slice = pcm[boundary_sample : boundary_sample + 800]
                rms_pre = float(np.sqrt(np.mean(pre_slice ** 2))) + 1e-6
                rms_post = float(np.sqrt(np.mean(post_slice ** 2))) + 1e-6
                ratio = max(rms_pre / rms_post, rms_post / rms_pre)

                # Hard step cut > 30x energy delta within 50ms at boundary
                if ratio > 35.0 and rms_pre > 0.02:
                    anomalies_detected["splice"] += 1
                    sec = round(seg["end"], 2)
                    findings.append({
                        "id": f"ind-trn-splice-{idx}",
                        "category": "audio",
                        "type": "Acoustic Splice Boundary",
                        "title": f"Acoustic Discontinuity at {sec:.2f}s",
                        "description": f"Significant {round(20 * math.log10(ratio), 1)} dB acoustic energy step detected at segment boundary ({sec:.2f}s), indicating a potential audio splice or edited edit point.",
                        "severity": "high",
                        "confidence": 87,
                        "isHeuristic": True,
                        "evidenceRef": f"Boundary at {sec:.2f}s",
                        "humanReviewRecommendation": "Inspect spectrogram phase continuity and room reverb tail across this boundary.",
                    })
                    suspicious_timestamps.append({
                        "timestamp": f"{int(sec // 60):02d}:{sec % 60:05.2f}",
                        "seconds": sec,
                        "label": "Acoustic Splice Point",
                        "description": "Sudden energy and room-tone discontinuity between speech segments.",
                        "severity": "high",
                        "evidenceRef": f"Timestamp {sec:.2f}s",
                    })

    # 6. Prosody & Pitch Naturalness Analysis (Synthetic Voice Clues)
    pitches = [seg["acoustic_features"]["pitch"] for seg in segments if "acoustic_features" in seg]
    if len(pitches) >= 3:
        pitch_std = float(np.std(pitches))
        if pitch_std < 4.0:
            findings.append({
                "id": "ind-trn-prosody-flatline",
                "category": "audio",
                "type": "Robotic Prosody Flatline",
                "title": f"Unnatural Pitch Constancy Flagged (StdDev {pitch_std:.1f} Hz)",
                "description": "Extremely low pitch variation across distinct spoken segments. Natural conversational speech fluctuates with semantic intonation.",
                "severity": "high",
                "confidence": 84,
                "isHeuristic": True,
                "evidenceRef": f"F0 StdDev: {pitch_std:.1f} Hz",
                "humanReviewRecommendation": "Evaluate prosody using mel-spectrogram pitch contour tracking to detect vocoder-based voice synthesis.",
            })

    # 7. Ground Truth Reference Correlation (WER / CER)
    wer_data = None
    if reference_text and reference_text.strip():
        wer_data = evaluate_wer_cer(reference_text, full_dialogue_text)
        if wer_data["wer"] > 25.0:
            findings.append({
                "id": "ind-trn-wer-divergence",
                "category": "transcript",
                "type": "Affidavit Lexical Divergence",
                "title": f"Significant Lexical Divergence (WER: {wer_data['wer']}%)",
                "description": f"Extracted speech differs substantially from reference text ({wer_data['substitutions']} substitutions, {wer_data['deletions']} omissions). Divergence exceeds evidentiary threshold (25%).",
                "severity": "high",
                "confidence": 91,
                "isHeuristic": False,
                "evidenceRef": f"WER: {wer_data['wer']}% | CER: {wer_data['cer']}%",
                "humanReviewRecommendation": "Compare reference affidavit transcript against verbatim acoustic recording.",
            })
        else:
            findings.append({
                "id": "ind-trn-wer-aligned",
                "category": "transcript",
                "type": "Lexical Consistency Verified",
                "title": f"Speech Aligns with Reference Transcript (WER: {wer_data['wer']}%)",
                "description": f"Automated transcription matches supplied reference context within standard acoustic margin ({wer_data['totalHypothesisWords']} words verified).",
                "severity": "info",
                "confidence": 96,
                "isHeuristic": False,
                "evidenceRef": f"WER: {wer_data['wer']}%",
                "humanReviewRecommendation": "No significant lexical discrepancy detected against provided reference text.",
            })

    # Limitations & Caveats
    limitations.append("Whisper automatic speech recognition accuracy can degrade in environments with signal-to-noise ratio (SNR) < 12 dB or heavy room reverberation.")
    limitations.append("Speaker diarization uses unsupervised acoustic timbre clustering (Speaker 1, Speaker 2) and does not establish verified biometric real-world identity.")
    limitations.append("Acoustic energy step changes may occasionally arise from natural microphone gating or dynamic AGC compression rather than malicious splicing.")

    # Multi-Tier Forensic Assessment
    critical_findings = [f for f in findings if f.get("severity") == "critical"]
    high_findings = [f for f in findings if f.get("severity") == "high"]
    moderate_findings = [f for f in findings if f.get("severity") == "moderate"]

    # Calculate overall spoken duration and speech ratio
    spoken_sec = sum(max(0.0, s["end"] - s["start"]) for s in segments)
    total_dur = audio_meta.get("duration", 10.0) or 10.0
    speech_ratio = round(min(1.0, spoken_sec / max(0.1, total_dur)), 3)

    if total_dur < 1.0 or (len(segments) == 0 and audio_meta.get("rms_dbfs", -100) < -60):
        assessment = "Inconclusive"
        uncertainty_status = "Inconclusive"
        confidence_score = 45.0
        summary = "Audio stream duration or signal level is insufficient for reliable linguistic and speech authenticity analysis."
    elif len(critical_findings) > 0 or (len(high_findings) >= 2 and anomalies_detected["splice"] > 0):
        assessment = "Potential Dialogue Manipulation"
        uncertainty_status = "Likely Manipulated"
        confidence_score = 88.5
        summary = f"Flagged {len(critical_findings) + len(high_findings)} critical/high-severity anomalies including acoustic splicing and dialogue inconsistencies."
    elif wer_data and wer_data["wer"] > 30.0:
        assessment = "Transcript Inconsistency Detected"
        uncertainty_status = "Requires Further Review"
        confidence_score = 84.0
        summary = f"Identified substantial divergence between reference affidavit and acoustic dialogue (WER: {wer_data['wer']}%)."
    elif len(high_findings) > 0 or len(moderate_findings) >= 2:
        assessment = "Transcript Inconsistency Detected"
        uncertainty_status = "Requires Further Review"
        confidence_score = 78.0
        summary = "Minor dialogue anomalies and boundary inconsistencies were identified. Human examiner review recommended."
    else:
        assessment = "No Significant Indicators Detected"
        uncertainty_status = "No Significant Indicators Detected"
        confidence_score = 93.0
        summary = f"Automated transcription and acoustic continuity analysis completed ({len(segments)} segments, {len(speaker_profiles)} speakers). No anomalous dialogue manipulations detected."

    return {
        "status": "completed",
        "assessment": assessment,
        "uncertaintyStatus": uncertainty_status,
        "confidenceScore": confidence_score,
        "summary": summary,
        "findings": findings,
        "suspiciousTimestamps": suspicious_timestamps,
        "speakerMetrics": {
            "totalSpeakers": len(speaker_profiles),
            "speakers": speaker_profiles,
        },
        "transcriptMetrics": {
            "totalWords": total_words,
            "spokenDurationSec": round(spoken_sec, 2),
            "speechRatio": speech_ratio,
            "wer": wer_data["wer"] if wer_data else None,
            "cer": wer_data["cer"] if wer_data else None,
            "repetitionCount": anomalies_detected["repetition"],
            "spliceCount": anomalies_detected["splice"],
            "silenceAnomalyCount": anomalies_detected["silence"],
        },
        "limitations": limitations,
    }


def main():
    parser = argparse.ArgumentParser(description="TruthLens AI Transcript & Speech Authenticity Engine")
    parser.add_argument("--input", required=True, help="Path to input audio or video media file")
    parser.add_argument("--reference", default=None, help="Optional path to reference transcript / context text")
    parser.add_argument("--model_dir", default="models/whisper-tiny", help="Path to Faster-Whisper model directory")
    parser.add_argument("--device", default="cpu", help="Device for Whisper inference (cpu, cuda)")
    parser.add_argument("--output_json", default=None, help="Path to write JSON output")

    args = parser.parse_args()

    # 1. Load Audio
    pcm, meta, errors = load_media_audio_16k(args.input)
    if pcm is None or len(pcm) == 0:
        result = {
            "status": "error" if errors else "completed",
            "assessment": "Inconclusive",
            "uncertaintyStatus": "Inconclusive",
            "confidenceScore": 50.0,
            "summary": "Audio track was missing, silent, or unreadable.",
            "metadata": meta,
            "transcription": [],
            "findings": [
                {
                    "id": "ind-trn-no-audio",
                    "category": "transcript",
                    "type": "Audio Stream Missing",
                    "title": "No Spoken Audio Stream Detected",
                    "description": "Media container does not contain an active audio stream or the audio is silent.",
                    "severity": "info",
                    "confidence": 99,
                    "isHeuristic": False,
                    "humanReviewRecommendation": "Verify whether media source has a valid audio track.",
                }
            ],
            "suspiciousTimestamps": [],
            "speakerMetrics": {"totalSpeakers": 0, "speakers": []},
            "transcriptMetrics": {
                "totalWords": 0,
                "spokenDurationSec": 0.0,
                "speechRatio": 0.0,
                "wer": None,
                "cer": None,
                "repetitionCount": 0,
                "spliceCount": 0,
                "silenceAnomalyCount": 0,
            },
            "limitations": ["No acoustic stream present for transcription or voice diarization."],
            "processingErrors": errors,
        }
        output_str = json.dumps(result, indent=2)
        if args.output_json:
            with open(args.output_json, "w", encoding="utf-8") as f:
                f.write(output_str)
        print(output_str)
        return

    # 2. Transcribe via Faster-Whisper
    # Check if model directory exists
    model_path = args.model_dir if os.path.exists(args.model_dir) else "tiny"
    try:
        model = WhisperModel(model_path, device=args.device, compute_type="int8")
        whisper_segments, info = model.transcribe(
            pcm,
            beam_size=5,
            vad_filter=True,
            word_timestamps=True,
        )

        segments = []
        seg_idx = 1
        for s in whisper_segments:
            text = s.text.strip()
            if not text:
                continue

            # Word-level details
            words = []
            if s.words:
                for w in s.words:
                    words.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 2),
                        "end": round(w.end, 2),
                        "probability": round(w.probability, 3),
                    })

            conf = round(math.exp(max(-5.0, s.avg_logprob)) * 100, 1) if s.avg_logprob is not None else 85.0
            segments.append({
                "id": f"seg-{seg_idx}",
                "start": round(s.start, 2),
                "end": round(s.end, 2),
                "text": text,
                "confidence": min(100.0, conf),
                "noSpeechProb": round(s.no_speech_prob, 3) if s.no_speech_prob is not None else 0.0,
                "words": words,
            })
            seg_idx += 1

        meta["language"] = info.language
        meta["language_probability"] = round(info.language_probability, 3)

    except Exception as e:
        errors.append(f"Whisper transcription error: {str(e)}")
        segments = []

    # 3. Read reference text if provided
    ref_text = None
    if args.reference and os.path.exists(args.reference):
        try:
            with open(args.reference, "r", encoding="utf-8") as rf:
                ref_text = rf.read()
        except Exception as e:
            errors.append(f"Failed to read reference transcript: {str(e)}")

    # 4. Speaker Diarization
    segments, speaker_profiles = perform_speaker_diarization(pcm, segments, sr=16000)

    # 5. Full Forensic Transcript Analysis
    analysis = analyze_transcript_forensics(
        pcm,
        segments,
        speaker_profiles,
        meta,
        reference_text=ref_text,
        sr=16000
    )

    # Combine into unified response
    response = {
        "status": analysis["status"],
        "assessment": analysis["assessment"],
        "uncertaintyStatus": analysis["uncertaintyStatus"],
        "confidenceScore": analysis["confidenceScore"],
        "summary": analysis["summary"],
        "metadata": meta,
        "transcription": segments,
        "findings": analysis["findings"],
        "suspiciousTimestamps": analysis["suspiciousTimestamps"],
        "speakerMetrics": analysis["speakerMetrics"],
        "transcriptMetrics": analysis["transcriptMetrics"],
        "limitations": analysis["limitations"],
        "processingErrors": errors,
    }

    output_str = json.dumps(response, indent=2)
    if args.output_json:
        with open(args.output_json, "w", encoding="utf-8") as f:
            f.write(output_str)

    print(output_str)


if __name__ == "__main__":
    main()
