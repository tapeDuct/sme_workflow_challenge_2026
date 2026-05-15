from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Qwen / Alibaba Cloud
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen-plus"

    # Bitdeer AI
    bitdeer_api_key: str = ""
    bitdeer_endpoint: str = ""

    # FPT AI Factory
    fpt_api_key: str = ""
    fpt_endpoint: str = ""

    # Integrations
    brave_api_key: str = ""
    apollo_api_key: str = ""
    zapier_webhook_url: str = ""

    # Email / Human-in-the-Loop
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    hitl_approval_email: str = ""

    # App
    database_url: str = "sqlite:///data/app.db"
    extraction_confidence_threshold: float = 0.85
    max_auto_retries: int = 3

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
