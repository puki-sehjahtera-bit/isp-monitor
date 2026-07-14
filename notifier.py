"""
Notifier Telegram.
Env: TG_BOT_TOKEN, TG_CHAT_ID. Kalau kosong -> cuma log (nggak kirim).
"""
import os
import logging
import httpx

logger = logging.getLogger(__name__)


async def send_telegram(message: str):
    token = os.getenv("TG_BOT_TOKEN", "")
    chat = os.getenv("TG_CHAT_ID", "")
    if not token or not chat:
        logger.info("[notify off] %s", message.replace("\n", " | ")[:160])
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat, "text": message, "parse_mode": "Markdown"},
            )
        logger.info("Telegram terkirim: %s", message.replace("\n", " ")[:60])
    except Exception as e:
        logger.warning("Telegram gagal: %s", str(e)[:80])
