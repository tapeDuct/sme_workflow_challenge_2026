from __future__ import annotations

from typing import Any

from googleapiclient.errors import HttpError


class CommentManager:
    """Manages Google Sheets comments for AI review workflow."""

    def __init__(self, sheets_service):
        self.service = sheets_service

    def add_comment(
        self,
        spreadsheet_id: str,
        sheet_id: int,
        row: int,
        col: int,
        content: str,
        quoted_value: str = "",
    ) -> dict[str, Any]:
        """Add a comment to a specific cell in a Google Sheet."""
        try:
            requests = [
                {
                    "addComment": {
                        "comment": {
                            "content": content,
                            "quotedFileContent": {
                                "value": quoted_value or str(content)[:100],
                                "mimeType": "text/plain",
                            },
                        },
                        "cell": {
                            "sheetId": sheet_id,
                            "rowIndex": row,
                            "columnIndex": col,
                        },
                    }
                }
            ]
            result = (
                self.service.spreadsheets()
                .batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests})
                .execute()
            )
            reply = result.get("replies", [{}])[0]
            comment = reply.get("addComment", {}).get("comment", {})
            return {
                "comment_id": comment.get("commentId", ""),
                "anchor": comment.get("anchor"),
                "content": content,
            }
        except HttpError as e:
            return {"error": str(e), "content": content}

    def add_ai_comment(
        self,
        spreadsheet_id: str,
        sheet_id: int,
        row: int,
        col: int,
        issue: str,
        context: str,
        column_name: str = "",
        current_value: str = "",
    ) -> dict[str, Any]:
        """Add a structured AI review comment."""
        col_label = f"'{column_name}'" if column_name else f"column {col}"
        content = (
            f"AI Review Issue: {issue}\n\n"
            f"Context: {context}\n\n"
            f"Current value in {col_label}: {current_value}\n\n"
            f"Action: Please correct this cell directly, or reply to this comment "
            f"with the correct value and the AI will update it."
        )
        return self.add_comment(
            spreadsheet_id, sheet_id, row, col, content, current_value
        )

    def get_comments(self, spreadsheet_id: str, sheet_id: int = 0) -> list[dict[str, Any]]:
        """Get all comments on a sheet."""
        try:
            result = (
                self.service.spreadsheets()
                .get(spreadsheetId=spreadsheet_id, fields="sheets/data/rowData/values/note,sheets/data/rowData/values/effectiveValue,sheets/data/rowData/values/userEnteredValue")
                .execute()
            )
            comments = []
            sheets_data = result.get("sheets", [])
            if sheet_id < len(sheets_data):
                rows = sheets_data[sheet_id].get("data", [{}])[0].get("rowData", [])
                for r, row_data in enumerate(rows):
                    for c, cell_data in enumerate(row_data.get("values", [])):
                        note = cell_data.get("note", "")
                        if note:
                            comments.append({
                                "row": r,
                                "col": c,
                                "note": note,
                                "value": str(cell_data.get("effectiveValue", {}).get("stringValue", cell_data.get("effectiveValue", {}))),
                            })
            return comments
        except HttpError:
            return []

    def delete_comment(self, spreadsheet_id: str, comment_id: str) -> bool:
        """Delete a comment by ID."""
        try:
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": [{"deleteComment": {"commentId": comment_id}}]},
            ).execute()
            return True
        except HttpError:
            return False

    def resolve_issues(
        self,
        spreadsheet_id: str,
        sheet_id: int,
        corrections: list[dict[str, Any]],
    ) -> int:
        """Apply a batch of cell corrections. Each correction: {row, col, new_value}."""
        requests = []
        for corr in corrections:
            requests.append({
                "updateCells": {
                    "rows": [{"values": [{"userEnteredValue": {"stringValue": str(corr["new_value"])}}]}],
                    "fields": "userEnteredValue",
                    "start": {
                        "sheetId": sheet_id,
                        "rowIndex": corr["row"],
                        "columnIndex": corr["col"],
                    },
                }
            })

        if requests:
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": requests},
            ).execute()

        return len(requests)
