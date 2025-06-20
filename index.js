require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");
const { google } = require("googleapis");
const creds = require("./creds.json");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const REVIEW_CHANNEL_ID = "-1002590406963";
const ADMIN_GROUP_ID = "-1002590406963";
const PORNO_GROUP_ID = -1002893285199;
const BDSM_GROUP_ID = -1002504654747;
const CHAT_GROUP_ID = -1002680969296;
const ALL_GROUPS = [PORNO_GROUP_ID, BDSM_GROUP_ID, CHAT_GROUP_ID];
const GROUP_NAMES = {
  [-1002893285199]: "Pornogruppe",
  [-1002504654747]: "BDSM Gruppe",
  [-1002680969296]: "Chatgruppe",
};
const GROUP_LINKS = {
  Pornogruppe: "https://t.me/+pbwc4-0mnNxjMjRi",
  BDSMGruppe: "https://t.me/+l3zyxqE0osU0YmNi",
  ChatGruppe: "https://t.me/+ztBlRywK1GFkYWEy",
};
const SPREADSHEET_ID = process.env.SHEET_ID;

const userState = new Map();
const mediaStore = new Map();

function generateKey() {
  return crypto.randomBytes(4).toString("hex");
}

// === SECTION 1: /start – Alterscheck & Regelabfrage ===
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  userState.set(chatId, { step: "ask_age" });
  await bot.sendMessage(chatId, "🔞 Wie alt bist du?");
});

// === SECTION 2: Message Handler (einheitlich) ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";
  const username =
    msg.from.username ||
    `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim();

  // === Alters- & Regelabfrage im 1:1-Chat ===
  if (userState.has(chatId)) {
    const state = userState.get(chatId);

    if (state.step === "ask_age" && /^\d+$/.test(text)) {
      const age = parseInt(text);
      if (age >= 18) {
        userState.set(chatId, { step: "confirm_rules", age });
        const rules = `
📜 *Unsere Gruppenregeln – bitte lesen & akzeptieren*

1. 🔞 Nur 18+ erlaubt!
2. 📷 Medien müssen erst von Admins geprüft werden.
3. 🍆 *Keine Dickpics oder Genitalbilder!*
4. 🚫 Kein Spam – bei 3 Verwarnungen wirst du automatisch gebannt.
5. 🔗 Nur Admins dürfen Links posten.

✅ Bestätige die Regeln:`;
        await bot.sendMessage(chatId, rules, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Regeln akzeptieren",
                  callback_data: "accept_rules",
                },
              ],
            ],
          },
        });
      } else {
        await bot.sendMessage(
          chatId,
          "🚫 Du musst mindestens 18 Jahre alt sein.",
        );
        userState.delete(chatId);
      }
    }
    return;
  }

  // === Link-Blocker für Nicht-Admins ===
  if (/https?:\/\/|t\.me\/|telegram\.me\//i.test(text)) {
    try {
      const admins = await bot.getChatAdministrators(chatId);
      const isAdmin = admins.some((admin) => admin.user.id === userId);
      if (!isAdmin) {
        await bot.deleteMessage(chatId, msg.message_id);
        await bot.sendMessage(
          chatId,
          `🚫 @${username}, du darfst keine Links posten.`,
          {
            reply_to_message_id: msg.message_id,
          },
        );
        return;
      }
    } catch (err) {
      console.error("❌ Fehler bei Link-Check:", err.message);
    }
  }

  // === Medienprüfung ===
  if ([PORNO_GROUP_ID, BDSM_GROUP_ID].includes(chatId)) {
    if (msg.photo || msg.video || msg.document) {
      const key = generateKey();
      const fileId =
        msg.photo?.pop().file_id || msg.video?.file_id || msg.document?.file_id;
      const caption = msg.caption || "";

      try {
        await bot.copyMessage(REVIEW_CHANNEL_ID, chatId, msg.message_id, {
          caption: `🆕 Neue Einsendung von @${username}\nGruppe: ${GROUP_NAMES[chatId]}\nKey: ${key}`,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Freigeben", callback_data: `approve:${key}` },
                { text: "❌ Ablehnen", callback_data: `reject:${key}` },
                { text: "⚠️ Verwarnen", callback_data: `warn:${key}` },
              ],
            ],
          },
        });

        mediaStore.set(key, {
          chatId,
          fileId,
          mediaType: msg.photo ? "photo" : msg.video ? "video" : "document",
          caption,
          userId,
          username,
        });

        await bot.deleteMessage(chatId, msg.message_id);
      } catch (err) {
        console.error("❌ Fehler bei Medienweiterleitung:", err.message);
      }
    }
  } else if (
    chatId === CHAT_GROUP_ID &&
    (msg.photo || msg.video || msg.document)
  ) {
    await bot.deleteMessage(chatId, msg.message_id);
  }
});

// === SECTION 3: Callback-Handler für Regeln & Medien ===
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const state = userState.get(chatId);

  // Regelbestätigung
  if (query.data === "accept_rules" && state?.step === "confirm_rules") {
    userState.delete(chatId);
    const links = Object.entries(GROUP_LINKS)
      .map(([name, url]) => `🔗 *${name}*: [beitreten](${url})`)
      .join("\n");

    await bot.sendMessage(
      chatId,
      `✅ Super! Hier sind deine Gruppenlinks:\n\n${links}`,
      {
        parse_mode: "Markdown",
      },
    );
    return;
  }

  // Medien-Review
  const [action, key] = query.data.split(":");
  const media = mediaStore.get(key);
  if (!media) return;

  const {
    chatId: mediaChatId,
    fileId,
    mediaType,
    caption,
    userId,
    username,
  } = media;

  if (action === "approve") {
    await bot.sendMessage(mediaChatId, `✅ Freigegeben: @${username}`);
    await bot.sendMediaGroup(mediaChatId, [
      { type: mediaType, media: fileId, caption, parse_mode: "Markdown" },
    ]);
  } else if (action === "reject") {
    await bot.sendMessage(
      REVIEW_CHANNEL_ID,
      `❌ Abgelehnt: Beitrag von @${username}`,
    );
  } else if (action === "warn") {
    await addWarning(userId, username, GROUP_NAMES[mediaChatId] || "Unbekannt");
  }

  mediaStore.delete(key);
  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    },
  );
});

// === SECTION 4: Verwarnsystem ===
async function addWarning(userId, username, groupName) {
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const now = new Date().toLocaleString();

  const getRows = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "TelegramVerwarnungen",
  });

  const rows = getRows.data.values || [];
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const idIndex = headers.indexOf("Telegram_ID");
  const warnIndex = headers.indexOf("Verwarnungen");
  const timeIndex = headers.indexOf("Letzte_Verwarnung");

  let updated = false;
  let warnCount = 1;

  for (let i = 0; i < dataRows.length; i++) {
    if (dataRows[i][idIndex] === userId.toString()) {
      warnCount = parseInt(dataRows[i][warnIndex] || "0") + 1;
      dataRows[i][warnIndex] = warnCount.toString();
      dataRows[i][timeIndex] = now;
      updated = true;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `TelegramVerwarnungen!A${i + 2}:E${i + 2}`,
        valueInputOption: "RAW",
        requestBody: { values: [dataRows[i]] },
      });

      if (warnCount >= 3) {
        for (const groupId of ALL_GROUPS) {
          try {
            await bot.banChatMember(groupId, userId);
          } catch (err) {
            console.error("❌ Fehler beim Kicken:", err.message);
          }
        }
      }
      break;
    }
  }

  if (!updated) {
    const newRow = [userId.toString(), username, "1", now, groupName];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "TelegramVerwarnungen",
      valueInputOption: "RAW",
      requestBody: { values: [newRow] },
    });
  }

  const message =
    warnCount === 1
      ? `⚠️ Verwarnung in "${groupName}". Bitte beachte die Regeln.`
      : warnCount === 2
        ? `⚠️ Zweite Verwarnung. Noch eine und du wirst entfernt.`
        : `🚫 Du wurdest wegen Regelverstößen aus allen Gruppen entfernt.`;

  try {
    await bot.sendMessage(userId, message);
  } catch {}

  try {
    await bot.sendMessage(
      ADMIN_GROUP_ID,
      `⚠️ @${username} wurde in "${groupName}" verwarnt (${warnCount}/3).`,
    );
  } catch {}
}

// === SECTION 5: Verwarnung per /warn im Gruppenchat ===
bot.onText(/\/warn/, async (msg) => {
  if (!msg.reply_to_message) return;
  const chatId = msg.chat.id;
  const groupName = GROUP_NAMES[chatId] || "Unbekannt";
  const target = msg.reply_to_message.from;

  if (!target?.id) return;
  const fullUsername =
    target.username ||
    `${target.first_name || ""} ${target.last_name || ""}`.trim();

  await addWarning(target.id, fullUsername, groupName);
});
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("✅ Der Bot läuft!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Webserver läuft auf Port ${PORT}`);
});
