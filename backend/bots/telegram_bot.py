"""
Telegram chatbot — every message from a user becomes a brain.search() call.
Runs as a standalone process: `python -m bots.telegram_bot`.

Setup:
  1. Open Telegram, talk to @BotFather, /newbot, copy the token.
  2. Put the token in .env as TELEGRAM_BOT_TOKEN.
  3. python -m bots.telegram_bot
"""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Make backend/ importable
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT.parent / ".env")

import anthropic
from supabase import create_client
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from ai_brain.brain import FormulaAIBrain


# ----- shared brain instance --------------------------------
supabase = create_client(os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_KEY", ""))
claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
brain = FormulaAIBrain(supabase, claude, os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250114"))


# ----- handlers ---------------------------------------------
async def cmd_start(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🧪 مرحباً! أنا مستشارك الكيميائي من Formula AI Global.\n"
        "اسألني عن أي فورمولا، مكوّن، تعارض، أو امتثال — وسأجيبك بلغتك.\n\n"
        "🧪 Hi! I'm your chemistry consultant from Formula AI Global. "
        "Ask me about any formula, ingredient, conflict, or compliance check — "
        "I'll answer in your own language."
    )


async def handle_message(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    query = update.message.text or ""
    lang = brain.language_detector.detect(query) or "en"
    try:
        answer = await brain.search(query, language=lang)
    except Exception as exc:  # noqa: BLE001
        answer = f"⚠️ {exc}"

    # Telegram has a 4096-char limit per message
    for chunk in (answer[i : i + 3800] for i in range(0, len(answer), 3800)):
        await update.message.reply_text(chunk)

    # Persist to forever memory
    try:
        supabase.table("chat_history").insert(
            {
                "user_id": str(update.effective_user.id),
                "session_id": f"telegram_{update.effective_chat.id}",
                "message": query,
                "response": answer,
                "language": lang,
            }
        ).execute()
    except Exception:
        pass


def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        print("❌ TELEGRAM_BOT_TOKEN missing in .env"); sys.exit(1)
    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    print("🤖 Telegram bot ready — listening for messages...")
    app.run_polling()


if __name__ == "__main__":
    main()
