FROM python:3.13-slim

WORKDIR /app

# ping butuh iputils (di Debian/Ubuntu). Slim punya ping via procps? tetap install.
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["python", "main.py"]
