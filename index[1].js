require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Hallo! Ich bin dein Bot.");
});