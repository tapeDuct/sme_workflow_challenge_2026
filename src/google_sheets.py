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


def _sanitize_value(v: Any) -> str:
    import math
    if v is None:
        return ""
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return ""
    if isinstance(v, str) and v.lower() in ("nan", "none", "nat"):
        return ""
    return str(v)


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

        sanitized = [[_sanitize_value(v) for v in row] for row in values]

        body = {"values": sanitized}
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


class DriveManager:
    """Manages Google Drive folders and file operations."""

    def __init__(self, sheets_client: GoogleSheetsClient):
        self.sheets = sheets_client

    def _get_drive_service(self):
        creds = _load_credentials(self.sheets.credentials_path, self.sheets.token_path)
        return build("drive", "v3", credentials=creds)

    def setup_folders(self, root_name: str = "The Social Space — Workflow") -> dict[str, str]:
        """Create the full folder hierarchy. Returns folder IDs keyed by name."""
        drive = self._get_drive_service()
        root_id = self._find_or_create(drive, root_name)
        folders = {
            "Add CSV for Processing": (root_id, None),
            "Archive Combined Files": (root_id, None),
            "Archive CSV": (root_id, None),
            "Reports": (root_id, None),
        }
        result = {"root": root_id}
        for name, (parent, _) in folders.items():
            fid = self._find_or_create(drive, name, parent)
            result[name] = fid
        return result

    def _find_or_create(self, drive, name: str, parent_id: str = None) -> str:
        query = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        if parent_id:
            query += f" and '{parent_id}' in parents"
        existing = drive.files().list(q=query, fields="files(id)", pageSize=1).execute()
        if existing.get("files"):
            return existing["files"][0]["id"]

        body = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
        if parent_id:
            body["parents"] = [parent_id]
        return drive.files().create(body=body, fields="id").execute()["id"]

    def create_dated_folder(self, parent_id: str, prefix: str = "") -> str:
        """Create a folder named YYYY-MM-DD inside parent_id."""
        from datetime import date
        name = f"{prefix}{date.today().isoformat()}" if prefix else date.today().isoformat()
        drive = self._get_drive_service()
        return self._find_or_create(drive, name, parent_id)

    def move_file_to_folder(self, file_id: str, folder_id: str) -> None:
        """Move a Drive file to a folder."""
        drive = self._get_drive_service()
        file = drive.files().get(fileId=file_id, fields="parents").execute()
        prev_parents = ",".join(file.get("parents", []))
        drive.files().update(
            fileId=file_id,
            addParents=folder_id,
            removeParents=prev_parents,
            fields="id, parents",
        ).execute()

    def move_spreadsheet_to_folder(self, spreadsheet_id: str, folder_id: str) -> None:
        """Move a Google Sheet into a Drive folder."""
        self.move_file_to_folder(spreadsheet_id, folder_id)

    def list_files_in_folder(self, folder_id: str) -> list[dict]:
        """List non-trashed files in a Drive folder."""
        drive = self._get_drive_service()
        query = f"'{folder_id}' in parents and trashed=false"
        results = drive.files().list(q=query, fields="files(id, name, mimeType, webViewLink)", pageSize=100).execute()
        return results.get("files", [])


sheets_client = GoogleSheetsClient()
drive_manager = DriveManager(sheets_client)

