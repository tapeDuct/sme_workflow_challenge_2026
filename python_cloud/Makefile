.PHONY: setup run test lint demo clean

VENV = .venv
PYTHON = $(VENV)/bin/python
PIP = $(VENV)/bin/pip
UVICORN = $(VENV)/bin/uvicorn

setup:
	/usr/bin/python3 -m venv $(VENV)
	$(PIP) install -r requirements.txt
	cp -n .env.example .env || true
	mkdir -p data/output
	touch data/output/.gitkeep
	@echo "Setup complete. Edit .env with your API keys."

run:
	$(UVICORN) src.main:app --reload --port 8000

test:
	$(PYTHON) -m pytest tests/ -v

lint:
	$(VENV)/bin/ruff check src/ tests/

demo:
	$(UVICORN) src.main:app --port 8000

clean:
	rm -rf $(VENV) __pycache__ .pytest_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
