# [START dockerfile]
# ---- build stage: install pinned dependencies into a virtualenv -------------
FROM python:3.12-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
RUN python -m venv /venv
COPY requirements.lock .
RUN /venv/bin/pip install --require-hashes -r requirements.lock 2>/dev/null \
 || /venv/bin/pip install -r requirements.lock          # lock has versions; add hashes with pip-compile --generate-hashes
COPY pyproject.toml README.md ./
COPY src ./src
RUN /venv/bin/pip install --no-deps .

# ---- runtime stage: no compilers, no pip cache, non-root -------------------
FROM python:3.12-slim
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
COPY --from=build /venv /venv
ENV PATH=/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    ATLAS_TRANSPORT=http \
    ATLAS_HOST=0.0.0.0 \
    ATLAS_PORT=8000 \
    ATLAS_BACKEND=live
USER 10001:10001
EXPOSE 8000
# Container-level health check for docker run; Kubernetes uses its own probes.
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=2).status==200 else 1)"
ENTRYPOINT ["python", "-m", "atlas_mcp"]
# [END dockerfile]
