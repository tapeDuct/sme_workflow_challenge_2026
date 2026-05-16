from __future__ import annotations

import os
from typing import Any, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]


def _load_credentials(creds_path: str, token_path: str) -> Credentials:
    creds: Credentials | None = None

    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
            creds = flow.run_local_server(port=0)

        os.makedirs(os.path.dirname(token_path), exist_ok=True)
        with open(token_path, "w") as token_file:
            token_file.write(creds.to_json())

    return creds


class GoogleSheetsClient:
    def __init__(self, credentials_path: Optional[str] = None, token_path: Optional[str] = None):
        self.credentials_path = credentials_path or "data/google-credentials.json"
        self.token_path = token_path or "data/google-token.json"
        self._service = None

    def _get_service(self):
        if self._service is None:
            creds = _load_credentials(self.credentials_path, self.token_path)
            self._service = build("sheets", "v4", credentials=creds)
        return self._service

    def create_spreadsheet(self, title: str, parent_folder_id: Optional[str] = None) -> dict[str, str]:
        service = self._get_service()
        spreadsheet_body = {"properties": {"title": title}}

        spreadsheet = service.spreadsheets().create(body=spreadsheet_body, fields="spreadsheetId").execute()
        spreadsheet_id = spreadsheet.get("spreadsheetId")

        if parent_folder_id:
            drive_service = build("drive", "v3", credentials=service._http.credentials)
            drive_service.files().update(
                fileId=spreadsheet_id,
                addParents=parent_folder_id,
                fields="id, parents",
            ).execute()

        return {
            "spreadsheet_id": spreadsheet_id,
            "url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}",
        }

    def write_data(
        self,
        spreadsheet_id: str,
        range_name: str,
        values: list[list[Any]],
        sheet_name: Optional[str] = None,
    ) -> int:
        service = self._get_service()

        if sheet_name:
            try:
                service.spreadsheets().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={
                        "requests": [{"addSheet": {"properties": {"title": sheet_name}}}]
                    },
                ).execute()
            except HttpError:
                pass
            range_name = f"'{sheet_name}'!{range_name}"

        body = {"values": values}
        result = (
            service.spreadsheets()
            .values()
            .update(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption="RAW",
                body=body,
            )
            .execute()
        )
        return result.get("updatedCells", 0)

    def read_data(self, spreadsheet_id: str, range_name: str) -> list[list[Any]]:
        service = self._get_service()
        result = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=range_name)
            .execute()
        )
        return result.get("values", [])

    def format_header(self, spreadsheet_id: str, sheet_id: int = 0) -> None:
        service = self._get_service()
        requests = [
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                    },
                    "cell": {
                        "userEnteredFormat": {"textFormat": {"bold": True}}
                    },
                    "fields": "userEnteredFormat.textFormat.bold",
                }
            }
        ]
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": requests},
        ).execute()

    def create_hyperlink(self, text: str, url: str) -> str:
        return f'=HYPERLINK("{url}", "{text}")'


sheets_client = GoogleSheetsClient()
