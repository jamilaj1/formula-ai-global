"""
WhatsApp bot — Twilio webhook handler that pipes messages into brain.search().
Mount this on the FastAPI app or run as a small standalone webhook.

Setup:
  1. Create a Twilio account → Messaging → WhatsApp Sandbox.
  2. In the sandbox settings, set "When a message comes in" webhook to:
       https://YOUR_DOMAIN/whatsapp/webhook   (POST)
  3. Put TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in .env.
  4. uvicorn bots.whatsapp_bot:app --port 8090
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Form
from fastapi.responses import Response
from twilio.twiml.messaging_response import MessagingResponse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

import anthropic
from supabase import create_client
from ai_brain.brain import FormulaAIBrain


supabase = create_client(os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_KEY", ""))
claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
brain = FormulaAIBrain(supabase, claude, os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250114"))


app = FastAPI(title="Formula AI WhatsApp Webhook")


@app.post("/whatsapp/webhook")
async def whatsapp_webhook(From: str = Form(""), Body: str = Form("")):
    """Twilio posts here on every inbound message."""
    query = (Body or "").strip()
    if not query:
        twiml = MessagingResponse()
        twiml.message("👋 Send me any chemistry question and I'll answer.")
        return Response(content=str(twiml), media_type="application/xml")

    lang = brain.language_detector.detect(query) or "en"
    try:
        answer = await brain.search(query, language=lang)
    except Exception as exc:  # noqa: BLE001
        answer = f"⚠️ {exc}"

    # Twilio messages cap at 1600 chars — trim and add "(part 1/2)" if long
    if len(answer) > 1500:
        answer = answer[:1500].rstrip() + "…\n(send 'more' for the rest)"

    # Persist
    try:
        supabase.table("chat_history").insert(
            {
                "user_id": From,
                "session_id": f"whatsapp_{From}",
                "message": query,
                "response": answer,
                "language": lang,
            }
        ).execute()
    except Exception:
        pass

    twiml = MessagingResponse()
    twiml.message(answer)
    return Response(content=str(twiml), media_type="application/xml")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("bots.whatsapp_bot:app", host="0.0.0.0", port=8090, reload=True)
