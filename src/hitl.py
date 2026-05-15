import smtplib
import uuid
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from src.config import settings
from src.models import ApprovalRequest, ApprovalResponse


class EmailHandler:
    def __init__(self):
        self.smtp_host = settings.smtp_host
        self.smtp_port = settings.smtp_port
        self.smtp_user = settings.smtp_user
        self.smtp_password = settings.smtp_password
        self.approval_email = settings.hitl_approval_email
        self.base_url = "http://localhost:8000"
        self._sessions: dict[str, dict[str, Any]] = {}

    def _connect(self) -> smtplib.SMTP:
        server = smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=10)
        server.starttls()
        server.login(self.smtp_user, self.smtp_password)
        return server

    def send_approval_request(self, request: ApprovalRequest) -> str:
        session_id = str(uuid.uuid4())[:8]
        approve_url = f"{self.base_url}/hitl/email-approve/{session_id}?task_id={request.task_id}"
        reject_url = f"{self.base_url}/hitl/email-reject/{session_id}?task_id={request.task_id}"

        self._sessions[session_id] = {
            "task_id": request.task_id,
            "request": request.model_dump(),
        }

        body_html = self._render_email(request, approve_url, reject_url)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[Action Required] Workflow Review — {request.task_type} (Task #{request.task_id})"
        msg["From"] = self.smtp_user
        msg["To"] = self.approval_email
        msg.attach(MIMEText(body_html, "html"))

        try:
            server = self._connect()
            server.send_message(msg)
            server.quit()
        except Exception:
            pass

        return session_id

    def process_response(self, session_id: str, decision: str, task_id: int) -> ApprovalResponse:
        return ApprovalResponse(
            task_id=task_id,
            decision=decision,
        )

    def _render_email(self, request: ApprovalRequest, approve_url: str, reject_url: str) -> str:
        low_conf_section = ""
        if request.low_confidence_fields:
            items = "".join(f"<li>{f}</li>" for f in request.low_confidence_fields)
            low_conf_section = f"<p><strong>Fields requiring attention:</strong></p><ul>{items}</ul>"

        return f"""
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Workflow Review Required</h2>
            <p><strong>Task:</strong> #{request.task_id} — {request.task_type}</p>
            <p><strong>AI Confidence:</strong> {request.confidence_score:.1%}</p>
            <p><strong>Summary:</strong> {request.summary}</p>

            <h3>Extracted Data</h3>
            <pre style="background: #f3f4f6; padding: 12px; border-radius: 6px;">
{_format_data(request.extracted_data)}
            </pre>
            {low_conf_section}
            <hr style="margin: 24px 0;">
            <div style="display: flex; gap: 12px;">
                <a href="{approve_url}" style="background: #16a34a; color: white; padding: 10px 20px;
                   text-decoration: none; border-radius: 6px; font-weight: bold;">Approve</a>
                <a href="{reject_url}" style="background: #dc2626; color: white; padding: 10px 20px;
                   text-decoration: none; border-radius: 6px; font-weight: bold;">Reject</a>
            </div>
            <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">
                This is an automated workflow notification. Reply to this email with corrections if needed.
            </p>
        </body>
        </html>
        """


def _format_data(data: dict[str, Any]) -> str:
    import json

    return json.dumps(data, indent=2, default=str)


email_handler = EmailHandler()
