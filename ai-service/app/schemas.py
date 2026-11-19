from typing import List, Optional, Tuple, Dict, Any

try:
    from pydantic import BaseModel, Field

    class HealthResponse(BaseModel):
        status: str = "ok"
        service: str
        version: str

    class ModelAvailabilityResponse(BaseModel):
        available: bool = Field(..., alias="available")
        vitModel: bool
        yunetModel: bool
        vitPath: str
        yunetPath: str
        errors: List[str]
        models: Optional[List[Dict[str, Any]]] = None

        class Config:
            populate_by_name = True

    class SuspiciousRegion(BaseModel):
        id: str
        box: List[int]
        deepfakeProbability: float
        label: str
        description: str
        confidence: float

    class VisualizationItem(BaseModel):
        label: str
        url: str

    class ModelImageResponse(BaseModel):
        status: str
        modelName: str
        modelVersion: str
        deepfakeProbability: float
        realProbability: float
        confidence: float
        predictedLabel: str
        assessment: str
        uncertaintyStatus: str
        facesCount: int
        faces: List[Dict[str, Any]]
        suspiciousRegions: List[SuspiciousRegion]
        visualizations: List[VisualizationItem]
        limitations: List[str]
        message: Optional[str] = None

    class AnomalousFrame(BaseModel):
        frameIndex: int
        timestamp: str
        seconds: float
        score: float
        facesCount: int

    class SuspiciousTimestamp(BaseModel):
        timestamp: str
        seconds: float
        label: str
        description: str
        evidenceRef: Optional[str] = None
        severity: str

    class ModelVideoResponse(BaseModel):
        status: str
        modelName: str
        modelVersion: str
        totalFramesAnalyzed: int
        nativeFps: float
        durationSec: float
        maxDeepfakeScore: float
        meanDeepfakeScore: float
        anomalousFrameCount: int
        anomalousFrames: List[AnomalousFrame]
        suspiciousTimestamps: List[SuspiciousTimestamp]
        visualizations: List[VisualizationItem]
        limitations: List[str]
        message: Optional[str] = None

    class ModelAudioResponse(BaseModel):
        status: str
        sampleRate: int
        channels: int
        durationSec: float
        syntheticProbability: float
        highFreqRatio: float
        spectralFlux: float
        reasons: List[str]
        visualizations: List[VisualizationItem]
        limitations: List[str]
        message: Optional[str] = None

except Exception:
    # Fallback placeholder classes when pydantic_core native DLL is blocked on Windows host
    class HealthResponse: pass
    class ModelAvailabilityResponse: pass
    class ModelImageResponse: pass
    class ModelVideoResponse: pass
    class ModelAudioResponse: pass
