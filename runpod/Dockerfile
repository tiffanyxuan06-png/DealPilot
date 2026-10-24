# RunPod serverless image for DealPilot: Qwen3-VL-8B-Instruct on vLLM.
# Build:  docker build -t <dockerhub-user>/dealpilot-runpod:latest runpod/
FROM vllm/vllm-openai:v0.11.0

WORKDIR /app
COPY requirements.txt handler.py ./
RUN pip install --no-cache-dir -r requirements.txt

ENV MODEL_NAME=Qwen/Qwen3-VL-8B-Instruct
ENTRYPOINT []
CMD ["python3", "-u", "handler.py"]
