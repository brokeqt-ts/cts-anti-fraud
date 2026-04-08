"""
XGBoost ban predictor with SHAP-based feature importance.

Model state is persisted to the `_meta` PostgreSQL table (key: ml_xgboost_state)
as a base64-encoded pickle, matching the pattern used by the TypeScript logistic
regression model.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import pickle
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import shap
import xgboost as xgb
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_sample_weight

from .db import get_conn
from .features import (
    FEATURE_NAMES,
    FEATURE_LABELS,
    extract_training_data,
    features_to_vector,
)

logger = logging.getLogger(__name__)

META_KEY = "ml_xgboost_state"


# ─── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class FactorExplanation:
    feature: str
    label: str
    contribution: float
    value: float
    direction: str  # 'increases_risk' | 'decreases_risk'


@dataclass
class PredictionResult:
    ban_probability: float
    risk_level: str  # 'low' | 'medium' | 'high' | 'critical'
    confidence: float
    top_factors: list[FactorExplanation]
    predicted_days_to_ban: int | None
    model_version: str


@dataclass
class TrainingResult:
    accuracy: float
    precision: float
    recall: float
    f1: float
    sample_count: int
    positive_count: int
    negative_count: int
    model_version: str
    warnings: list[str]
    feature_importance: dict[str, float]


@dataclass
class ModelState:
    model_bytes: bytes   # pickled XGBClassifier
    explainer_bytes: bytes  # pickled TreeExplainer
    model_version: str
    trained_at: str
    sample_count: int
    feature_names: list[str] = field(default_factory=list)


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _risk_level(prob: float) -> str:
    if prob < 0.25:
        return "low"
    if prob < 0.5:
        return "medium"
    if prob < 0.75:
        return "high"
    return "critical"


# ─── XGBoost Predictor ─────────────────────────────────────────────────────────

class XGBoostPredictor:
    def __init__(self) -> None:
        self._model: xgb.XGBClassifier | None = None
        self._explainer: shap.TreeExplainer | None = None
        self._model_version: str = "untrained"
        self._sample_count: int = 0

    # ── Training ──

    def train(self) -> TrainingResult:
        warnings: list[str] = []

        logger.info("Loading training data...")
        rows = extract_training_data()

        if len(rows) < 10:
            return TrainingResult(
                accuracy=0, precision=0, recall=0, f1=0,
                sample_count=len(rows), positive_count=0, negative_count=0,
                model_version="insufficient_data",
                warnings=["Недостаточно данных для обучения (< 10 аккаунтов)"],
                feature_importance={},
            )

        X = np.array([features_to_vector(r) for r in rows], dtype=np.float32)
        y = np.array([r["is_banned"] for r in rows], dtype=np.int32)

        positive_count = int(y.sum())
        negative_count = int(len(y) - positive_count)

        if positive_count == 0:
            warnings.append("Нет забаненных аккаунтов — добавьте данные о банах")
        if len(rows) < 50:
            warnings.append(f"Мало данных ({len(rows)}) — модель может быть ненадёжной")

        # Train/validation split (stratified when possible)
        stratify = y if positive_count >= 2 else None
        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=stratify
        )

        # Class weights for imbalance
        sample_weights = compute_sample_weight("balanced", y_train)

        scale_pos_weight = max(negative_count / max(positive_count, 1), 1.0)

        model = xgb.XGBClassifier(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=5,
            gamma=0.1,
            reg_alpha=0.1,
            reg_lambda=1.0,
            scale_pos_weight=scale_pos_weight,
            use_label_encoder=False,
            eval_metric="logloss",
            random_state=42,
            verbosity=0,
        )

        model.fit(
            X_train, y_train,
            sample_weight=sample_weights,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

        # Metrics
        y_pred = model.predict(X_val)
        y_prob = model.predict_proba(X_val)[:, 1]

        accuracy = float(accuracy_score(y_val, y_pred))
        precision = float(precision_score(y_val, y_pred, zero_division=0))
        recall = float(recall_score(y_val, y_pred, zero_division=0))
        f1 = float(f1_score(y_val, y_pred, zero_division=0))

        if accuracy < 0.6:
            warnings.append(f"Точность модели низкая ({accuracy:.1%}) — нужно больше данных")

        # SHAP explainer
        explainer = shap.TreeExplainer(model)

        # Feature importance from SHAP (mean abs SHAP value on train)
        shap_values = explainer.shap_values(X_train[:min(200, len(X_train))])
        mean_abs_shap = np.abs(shap_values).mean(axis=0)
        feature_importance = {
            FEATURE_NAMES[i]: round(float(mean_abs_shap[i]), 6)
            for i in range(len(FEATURE_NAMES))
        }

        # Persist
        self._model = model
        self._explainer = explainer
        self._model_version = f"xgb_v1_{int(datetime.now(timezone.utc).timestamp())}"
        self._sample_count = len(rows)

        self._save_model()

        logger.info(
            "XGBoost trained: %d samples, acc=%.3f, f1=%.3f, version=%s",
            len(rows), accuracy, f1, self._model_version,
        )

        return TrainingResult(
            accuracy=round(accuracy, 4),
            precision=round(precision, 4),
            recall=round(recall, 4),
            f1=round(f1, 4),
            sample_count=len(rows),
            positive_count=positive_count,
            negative_count=negative_count,
            model_version=self._model_version,
            warnings=warnings,
            feature_importance=dict(
                sorted(feature_importance.items(), key=lambda x: -x[1])[:20]
            ),
        )

    # ── Prediction ──

    def predict(self, features: dict[str, float]) -> PredictionResult:
        if self._model is None:
            raise RuntimeError("Модель не обучена")

        x = np.array([features_to_vector(features)], dtype=np.float32)
        prob = float(self._model.predict_proba(x)[0, 1])

        top_factors = self._explain(features, x)
        confidence = min(self._sample_count / 100.0, 1.0)
        days_to_ban = max(1, round((1 - prob) * 30)) if prob > 0.5 else None

        return PredictionResult(
            ban_probability=round(prob, 4),
            risk_level=_risk_level(prob),
            confidence=round(confidence, 2),
            top_factors=top_factors[:5],
            predicted_days_to_ban=days_to_ban,
            model_version=self._model_version,
        )

    def _explain(self, features: dict[str, float], x: np.ndarray) -> list[FactorExplanation]:
        if self._explainer is None:
            return []

        try:
            shap_vals = self._explainer.shap_values(x)[0]
        except Exception:
            return []

        vector = features_to_vector(features)
        result: list[FactorExplanation] = []
        for i, name in enumerate(FEATURE_NAMES):
            contrib = float(shap_vals[i])
            result.append(FactorExplanation(
                feature=name,
                label=FEATURE_LABELS.get(name, name),
                contribution=round(abs(contrib), 6),
                value=float(vector[i]),
                direction="increases_risk" if contrib > 0 else "decreases_risk",
            ))

        return sorted(result, key=lambda x: -x.contribution)

    # ── Persistence ──

    def _save_model(self) -> None:
        assert self._model is not None
        assert self._explainer is not None

        model_buf = io.BytesIO()
        pickle.dump(self._model, model_buf)

        explainer_buf = io.BytesIO()
        pickle.dump(self._explainer, explainer_buf)

        state = {
            "model_b64": base64.b64encode(model_buf.getvalue()).decode(),
            "explainer_b64": base64.b64encode(explainer_buf.getvalue()).decode(),
            "model_version": self._model_version,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "sample_count": self._sample_count,
            "feature_names": FEATURE_NAMES,
        }

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO _meta (key, value) VALUES (%s, %s)
                       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
                    (META_KEY, json.dumps(state)),
                )

        logger.info("Model saved to DB (version=%s)", self._model_version)

    def load_model(self) -> bool:
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT value FROM _meta WHERE key = %s", (META_KEY,))
                    row = cur.fetchone()
                    if row is None:
                        return False
                    state = json.loads(row[0])

            self._model = pickle.loads(base64.b64decode(state["model_b64"]))
            self._explainer = pickle.loads(base64.b64decode(state["explainer_b64"]))
            self._model_version = state["model_version"]
            self._sample_count = state.get("sample_count", 0)
            logger.info("Model loaded from DB (version=%s)", self._model_version)
            return True
        except Exception as e:
            logger.warning("Failed to load model from DB: %s", e)
            return False

    def is_ready(self) -> bool:
        return self._model is not None

    @property
    def model_version(self) -> str:
        return self._model_version

    @property
    def sample_count(self) -> int:
        return self._sample_count
