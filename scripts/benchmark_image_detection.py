import os
import sys
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import io

# Add lib/backend-engine/python-engine to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lib', 'backend-engine', 'python-engine')))
from deepfake_detector import DeepfakeDetector

def create_synthetic_ai_sample(filepath):
    """Creates an image simulating generative diffusion: high-frequency checkerboard / spectral spikes + prompt metadata."""
    w, h = 512, 512
    x = np.linspace(0, 1, w)
    y = np.linspace(0, 1, h)
    xx, yy = np.meshgrid(x, y)
    arr = (np.sin(xx * 10) * np.cos(yy * 10) * 127 + 128).astype(np.uint8)
    
    # Add high-frequency periodic grid (characteristic of conv transpose / diffusion upsamplers)
    grid = ((np.sin(xx * 128 * np.pi) * np.sin(yy * 128 * np.pi) > 0) * 18).astype(np.uint8)
    arr = np.clip(arr.astype(np.int16) + grid, 0, 255).astype(np.uint8)
    
    rgb = np.stack([arr, (arr * 0.8).astype(np.uint8), (255 - arr)], axis=-1)
    img = Image.fromarray(rgb)
    
    # Add embedded generation metadata
    from PIL.PngImagePlugin import PngInfo
    info = PngInfo()
    info.add_text("prompt", "masterpiece, photorealistic portrait, 8k resolution, cinematic lighting")
    info.add_text("parameters", "steps: 30, sampler: DPM++ 2M Karras, CFG scale: 7.5, seed: 4294967295")
    info.add_text("Software", "Stable Diffusion ComfyUI")
    
    img.save(filepath, format="PNG", pnginfo=info)

def create_authentic_photo_sample(filepath):
    """Creates a natural photo simulation with natural 1/f^alpha power spectrum and natural sensor noise."""
    w, h = 512, 512
    img = Image.new("RGB", (w, h), color=(180, 200, 220))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 250, 512, 512], fill=(60, 120, 50))
    draw.ellipse([150, 150, 350, 350], fill=(220, 180, 140))
    
    img = img.filter(ImageFilter.GaussianBlur(radius=3))
    
    arr = np.array(img).astype(np.float32)
    noise = np.random.normal(0, 2.5, arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    
    clean_img = Image.fromarray(arr)
    clean_img.save(filepath, format="JPEG", quality=95)

def create_edited_tampered_sample(filepath):
    """Creates an authentic image with a spliced/tampered region pasted at a different compression level."""
    w, h = 512, 512
    base = Image.new("RGB", (w, h), color=(100, 140, 180))
    d = ImageDraw.Draw(base)
    d.rectangle([50, 50, 450, 450], fill=(140, 180, 200))
    buf = io.BytesIO()
    base.save(buf, format="JPEG", quality=75)
    base = Image.open(buf)
    
    patch = Image.new("RGB", (120, 120), color=(220, 80, 80))
    d2 = ImageDraw.Draw(patch)
    d2.ellipse([10, 10, 110, 110], fill=(255, 255, 0))
    
    base.paste(patch, (200, 200))
    base.save(filepath, format="JPEG", quality=90)

def create_compressed_authentic_sample(filepath):
    """Creates a natural photo subjected to heavy recompression."""
    w, h = 512, 512
    img = Image.new("RGB", (w, h), color=(150, 170, 190))
    draw = ImageDraw.Draw(img)
    draw.polygon([(100, 400), (256, 150), (412, 400)], fill=(80, 100, 70))
    img = img.filter(ImageFilter.GaussianBlur(radius=2))
    
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=40)
    img2 = Image.open(buf)
    buf2 = io.BytesIO()
    img2.save(buf2, format="JPEG", quality=45)
    final_img = Image.open(buf2)
    final_img.save(filepath, format="JPEG", quality=40)

def run_benchmarks():
    test_dir = os.path.join(os.path.dirname(__file__), 'benchmark_samples')
    os.makedirs(test_dir, exist_ok=True)
    out_dir = os.path.join(test_dir, 'output')
    os.makedirs(out_dir, exist_ok=True)
    
    engine = DeepfakeDetector()
    
    # Prepare test suite
    test_cases = [
        # 1. AI-Generated Synthetic
        {"name": "Synthetic Diffusion ComfyUI", "type": "synthetic", "path": os.path.join(test_dir, "synthetic_comfy.png"), "create": create_synthetic_ai_sample},
        {"name": "Forensic Image Sample (Stock AI)", "type": "synthetic", "path": os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'public', 'samples', 'forensic_image_sample.jpg')), "create": None},
        # 2. Authentic Photos
        {"name": "Authentic Photo 1", "type": "authentic", "path": os.path.join(test_dir, "authentic_1.jpg"), "create": create_authentic_photo_sample},
        {"name": "Authentic Photo 2", "type": "authentic", "path": os.path.join(test_dir, "authentic_2.jpg"), "create": create_authentic_photo_sample},
        # 3. Edited / Tampered Photos
        {"name": "Edited Spliced Photo 1", "type": "edited", "path": os.path.join(test_dir, "edited_spliced.jpg"), "create": create_edited_tampered_sample},
        {"name": "Edited Spliced Photo 2", "type": "edited", "path": os.path.join(test_dir, "edited_spliced_2.jpg"), "create": create_edited_tampered_sample},
        # 4. Heavy Compressed Photos
        {"name": "Compressed Authentic Photo (Q=40)", "type": "compressed", "path": os.path.join(test_dir, "compressed_auth.jpg"), "create": create_compressed_authentic_sample},
    ]
    
    for tc in test_cases:
        if tc["create"] and not os.path.exists(tc["path"]):
            tc["create"](tc["path"])
            
    print("=" * 80)
    print("TRUTHLENS FORENSIC MULTI-TECHNIQUE BENCHMARK EVALUATION")
    print("=" * 80)
    
    results = []
    
    # Positive class = Manipulated or Synthetic (synthetic, edited)
    # Negative class = Authentic or Compressed natural photo
    tp = 0
    fp = 0
    tn = 0
    fn = 0
    
    for tc in test_cases:
        res = engine.analyze_image(tc["path"], out_dir)
        verdict = res.get("uncertaintyStatus", "Inconclusive")
        prob = res.get("deepfakeProbability", 0.0)
        conf = res.get("confidence", 0.0)
        metrics = res.get("forensicMetrics", {})
        
        is_ground_truth_manipulated = tc["type"] in ["synthetic", "edited"]
        predicted_manipulated = verdict in ["Likely AI-Generated", "Likely Manipulated"]
        
        if is_ground_truth_manipulated and predicted_manipulated:
            tp += 1
            classification_match = "CORRECT (TP)"
        elif not is_ground_truth_manipulated and not predicted_manipulated:
            tn += 1
            classification_match = "CORRECT (TN)"
        elif not is_ground_truth_manipulated and predicted_manipulated:
            fp += 1
            classification_match = "FALSE POSITIVE (FP)"
        else:
            fn += 1
            classification_match = "FALSE NEGATIVE (FN)"
            
        results.append({
            "name": tc["name"],
            "type": tc["type"],
            "verdict": verdict,
            "neural_prob": prob,
            "conf": conf,
            "metrics": metrics,
            "match": classification_match
        })
        
        print(f"Sample: {tc['name']:<35} | Type: {tc['type']:<10} | Verdict: {verdict:<30} | {classification_match}")
        print(f"   -> AI Prob: {prob*100:.1f}% | Conf: {conf}% | Software: {metrics.get('softwareSignatures')} | FFT Spikes: {metrics.get('fftSpikeScore')} | ELA Max: {metrics.get('elaMaxDiff')}")
        print("-" * 80)
        
    precision = (tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = (tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    fpr = (fp / (fp + tn)) if (fp + tn) > 0 else 0.0
    accuracy = ((tp + tn) / len(test_cases)) if len(test_cases) > 0 else 0.0
    
    print("\n" + "=" * 80)
    print("EMPIRICAL BENCHMARK METRICS SUMMARY")
    print("=" * 80)
    print(f"Total Test Cases:       {len(test_cases)}")
    print(f"True Positives (TP):    {tp}")
    print(f"True Negatives (TN):    {tn}")
    print(f"False Positives (FP):   {fp}")
    print(f"False Negatives (FN):   {fn}")
    print(f"Accuracy:               {accuracy * 100:.1f}%")
    print(f"Precision:              {precision * 100:.1f}%")
    print(f"Recall (Sensitivity):   {recall * 100:.1f}%")
    print(f"F1-Score:               {f1:.3f}")
    print(f"False Positive Rate:    {fpr * 100:.1f}%")
    print("=" * 80)

if __name__ == "__main__":
    run_benchmarks()
