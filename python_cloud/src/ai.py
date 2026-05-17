from __future__ import annotations

import asyncio
from typing import Any, Optional

from openai import OpenAI
from pydantic import BaseModel

from src.config import settings


class AIProvider:
    def __init__(self):
        self._client: OpenAI | None = None

    @property
    def client(self) -> OpenAI:
        if self._client is None:
            self._client = OpenAI(
                api_key=settings.qwen_api_key,
                base_url=settings.qwen_base_url,
            )
        return self._client

    async def chat(self, messages: list[dict], response_format: type[BaseModel] | None = None, **kwargs) -> str:
        model = kwargs.pop("model", settings.qwen_model)
        extra = {}
        if response_format:
            extra["response_format"] = {"type": "json_object"}
        resp = await asyncio.to_thread(
            self.client.chat.completions.create,
            model=model,
            messages=messages,
            temperature=0.1,
            max_tokens=4096,
            **extra,
            **kwargs,
        )
        return resp.choices[0].message.content or ""

    async def structured_extract(self, prompt: str, schema: type[BaseModel], content: str) -> tuple[Optional[dict[str, Any]], float, list[str]]:
        system = (
            "You are an expert data extraction assistant. Extract the requested fields "
            "from the provided content. Return valid JSON matching the schema exactly. "
            "For each field, include a confidence score between 0 and 1.\n\n"
            f"Schema:\n{schema.model_json_schema()}"
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"{prompt}\n\nContent:\n{content}"},
        ]
        output = await self.chat(messages, response_format=schema)
        data, confidence, low_conf = self._parse_json_with_confidence(output, schema)
        return data, confidence, low_conf

    def _parse_json_with_confidence(self, raw: str, schema: type[BaseModel]) -> tuple[Optional[dict], float, list[str]]:
        import json

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None, 0.0, ["json_parse_error"]

        confidence_scores = data.pop("_confidence", {}) if isinstance(data, dict) else {}
        if isinstance(confidence_scores, list):
            confidence_scores = {k: v for k, v in zip(data.keys(), confidence_scores)}
        elif not isinstance(confidence_scores, dict):
            confidence_scores = {}

        avg_conf = (
            sum(float(v) for v in confidence_scores.values()) / len(confidence_scores)
            if confidence_scores
            else 0.8
        )

        low_conf = [k for k, v in confidence_scores.items() if float(v) < 0.7]

        return data, min(avg_conf, 1.0), low_conf


class Assurance:
    @staticmethod
    def detect_pii(text: str) -> list[str]:
        import re

        found: list[str] = []
        patterns = {
            "credit_card": r"\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b",
            "nric": r"\b[STFG]\d{7}[A-Z]\b",
            "phone": r"\b[89]\d{7}\b",
            "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
        }
        for label, pattern in patterns.items():
            if re.search(pattern, text, re.IGNORECASE):
                found.append(label)
        return found

    @staticmethod
    def mask_pii(text: str) -> str:
        import re

        text = re.sub(r"\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b", "[CARD REDACTED]", text)
        text = re.sub(r"\b[STFG]\d{7}[A-Z]\b", "[NRIC REDACTED]", text)
        text = re.sub(r"\b[89]\d{7}\b", "[PHONE REDACTED]", text)
        text = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", "[EMAIL REDACTED]", text)
        return text

    @staticmethod
    def should_escalate(confidence: float, threshold: float | None = None) -> bool:
        threshold = threshold or settings.extraction_confidence_threshold
        return confidence < threshold

    @staticmethod
    def explain_low_confidence(fields: list[str], data: dict[str, Any]) -> str:
        if not fields:
            return "All fields extracted with high confidence."
        lines = [f"- {field}: value={data.get(field, 'N/A')} — flagged for review" for field in fields]
        return "Fields requiring human verification:\n" + "\n".join(lines)

    @classmethod
    def sanitize(cls, text: str) -> tuple[str, list[str]]:
        pii = cls.detect_pii(text)
        return cls.mask_pii(text), pii


ai = AIProvider()
assurance = Assurance()
