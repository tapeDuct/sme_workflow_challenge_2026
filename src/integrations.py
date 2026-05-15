from typing import Any

import httpx

from src.config import settings


class BraveSearch:
    def __init__(self):
        self.api_key = settings.brave_api_key
        self.base_url = "https://api.search.brave.com/res/v1/web/search"

    async def search(self, query: str, count: int = 5) -> list[dict[str, Any]]:
        if not self.api_key:
            return []

        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": self.api_key,
        }
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                self.base_url,
                params={"q": query, "count": count},
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                results = resp.json().get("web", {}).get("results", [])
                return [{"title": r["title"], "url": r["url"], "description": r.get("description", "")} for r in results]
            return []


class Apollo:
    def __init__(self):
        self.api_key = settings.apollo_api_key
        self.base_url = "https://api.apollo.io/v1"

    async def enrich_company(self, domain: str) -> dict[str, Any]:
        if not self.api_key:
            return {}

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/organizations/enrich",
                params={"domain": domain},
                headers={"X-Api-Key": self.api_key},
                timeout=10,
            )
            if resp.status_code == 200:
                return resp.json()
            return {}


class Zapier:
    def __init__(self):
        self.webhook_url = settings.zapier_webhook_url

    async def trigger(self, payload: dict[str, Any]) -> bool:
        if not self.webhook_url:
            return False

        async with httpx.AsyncClient() as client:
            resp = await client.post(self.webhook_url, json=payload, timeout=10)
            return resp.status_code in (200, 201, 202, 204)


brave = BraveSearch()
apollo = Apollo()
zapier = Zapier()
