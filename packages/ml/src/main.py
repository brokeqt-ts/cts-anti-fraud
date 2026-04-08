"""
CTS Anti-Fraud — ML Service (XGBoost)

FastAPI service that:
  POST /train          — train XGBoost on data from PostgreSQL
  POST /predict        — predict ban probability for one account
  POST /predict-batch  — predict for a list of accounts
  GET  /health         — liveness probe
  GET  /model-info     — model metadata
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .features import extract_features, extract_bulk_features, FEATURE_LABELS
from .predictor import XGBoostPredictor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

# ─── Singleton predictor ───────────────────────────────────────────────────────

predictor = XGBoostPredictor()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting ML service — loading model from DB...")
    loaded = predictor.load_model()
    if loaded:
        logger.info("Model loaded: version=%s", predictor.model_version)
    else:
        logger.info("No saved model found — train via POST /train")
    yield


app = FastAPI(title="CTS Anti-Fraud ML Service", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Schemas ───────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    account_google_id: str


class PredictBatchRequest(BaseModel):
    account_google_ids: list[str]
    user_id: str | None = None


class ReorderRequest(BaseModel):
    pass  # Not used — kept for route symmetry


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_ready": predictor.is_ready(),
        "model_version": predictor.model_version,
        "sample_count": predictor.sample_count,
    }


@app.get("/model-info")
def model_info():
    return {
        "model_version": predictor.model_version,
        "sample_count": predictor.sample_count,
        "is_ready": predictor.is_ready(),
        "feature_count": len(FEATURE_LABELS),
        "features": FEATURE_LABELS,
    }


@app.post("/train")
def train():
    """Train XGBoost on all available account data. May take 10-60 seconds."""
    logger.info("Training started")
    try:
        result = predictor.train()
        logger.info("Training done: version=%s", result.model_version)
        return {
            "accuracy": result.accuracy,
            "precision": result.precision,
            "recall": result.recall,
            "f1": result.f1,
            "sample_count": result.sample_count,
            "positive_count": result.positive_count,
            "negative_count": result.negative_count,
            "model_version": result.model_version,
            "warnings": result.warnings,
            "feature_importance": result.feature_importance,
        }
    except Exception as e:
        logger.exception("Training failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict")
def predict(req: PredictRequest):
    """Predict ban probability for a single account."""
    if not predictor.is_ready():
        raise HTTPException(status_code=400, detail="Модель не обучена. Вызовите POST /train")

    features = extract_features(req.account_google_id)
    if features is None:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")

    result = predictor.predict(features)
    return {
        "ban_probability": result.ban_probability,
        "risk_level": result.risk_level,
        "confidence": result.confidence,
        "predicted_days_to_ban": result.predicted_days_to_ban,
        "model_version": result.model_version,
        "top_factors": [asdict(f) for f in result.top_factors],
    }


@app.post("/predict-batch")
def predict_batch(req: PredictBatchRequest):
    """
    Predict for multiple accounts (or all active if no IDs given).
    Pass user_id to restrict to that user's accounts.
    """
    if not predictor.is_ready():
        raise HTTPException(status_code=400, detail="Модель не обучена. Вызовите POST /train")

    if req.account_google_ids:
        # Specific accounts
        all_features = []
        for gid in req.account_google_ids:
            f = extract_features(gid)
            if f is not None:
                f["account_google_id"] = gid
                all_features.append(f)
    else:
        # All active accounts (optionally filtered by user)
        all_features = extract_bulk_features(req.user_id)

    predictions = []
    count_by_level: dict[str, int] = {"low": 0, "medium": 0, "high": 0, "critical": 0}

    for feat in all_features:
        gid = str(feat.get("account_google_id", ""))
        try:
            result = predictor.predict(feat)
            count_by_level[result.risk_level] = count_by_level.get(result.risk_level, 0) + 1
            predictions.append({
                "account_google_id": gid,
                "ban_probability": result.ban_probability,
                "risk_level": result.risk_level,
                "confidence": result.confidence,
                "predicted_days_to_ban": result.predicted_days_to_ban,
                "model_version": result.model_version,
                "top_factors": [asdict(f) for f in result.top_factors],
            })
        except Exception as e:
            logger.warning("Prediction failed for %s: %s", gid, e)

    return {
        "total": len(predictions),
        "count_by_level": count_by_level,
        "predictions": predictions,
    }
