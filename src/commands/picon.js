"use strict";

/**
 * Cavor-Xv3-11/x — Photo Protection
 * /picon — حماية صورة المجموعة
 * /picoff — إيقاف الحماية
 *
 * Copyright © 2026 Cavor
 */

const fs   = require("fs-extra");
const path = require("path");

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const DATA = path.join(process.cwd(), "database/data/cavorData.json");
const PIC_CHECK_MS = 3000; // 3 ثوانٍ

// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ══════════════════════════════════════════════════════════════════════════════

// Image protection timers: { [tid]: interval }
const imageProtectTimers =
  global.__PICON_TIMERS ||
  (global.__PICON_TIMERS = Object.create(null));

let restored = false;
let _cleanupInterval = null;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ══════════════════════════════════════════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════════════════════════════════════════

function load() {
  try {
    if (!fs.existsSync(DATA)) return {};
    const v = JSON.parse(fs.readFileSync(DATA, "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch (_) { return {}; }
}

function save(data) {
  fs.ensureDirSync(path.dirname(DATA));
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function getBotID(api) {
  return String(api?.getCurrentUserID?.() || global.GoatBot?.botID || "");
}

function getRole(senderID) {
  const cfg    = global.GoatBot?.config || {};
  const sid    = String(senderID);
  const supers = [...(cfg.superAdminBot || []), cfg.ownerID].filter(Boolean).map(String);
  const admins = (cfg.adminBot || []).map(String);
  if (supers.includes(sid)) return 3;
  if (admins.includes(sid)) return 2;
  return 0;
}

function isAdmin(senderID) {
  return getRole(senderID) >= 2;
}

function getThreadInfo(api, tid) {
  return new Promise((resolve) => {
    if (typeof api.getThreadInfo !== "function") return resolve({});
    api.getThreadInfo(String(tid), (err, info) => {
      resolve(err || !info ? {} : info);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// PHOTO MONITORING
// ══════════════════════════════════════════════════════════════════════════════

function stopPhotoProtection(tid) {
  const key = String(tid);
  if (imageProtectTimers[key]) {
    clearInterval(imageProtectTimers[key]);
    delete imageProtectTimers[key];
  }
}

function startPhotoProtection(api, tid, photoURL) {
  const key = String(tid);
  stopPhotoProtection(key);

  imageProtectTimers[key] = setInterval(async () => {
    try {
      const info = await getThreadInfo(api, key);
      const currentImage = info.imageSrc || "";

      // إذا تغيرت الصورة، نعيدها
      if (currentImage !== photoURL) {
        if (typeof api.changeGroupImage === "function") {
          // تحميل الصورة وإعادة إرسالها
          const axios = require("axios");
          try {
            const res = await axios.get(photoURL, {
              responseType: "stream",
              timeout: 30000,
            });
            const stream = res.data;
            stream.path = "protected_image.jpg";

            await new Promise((resolve, reject) => {
              api.changeGroupImage(stream, key, (err) => {
                if (err) reject(err); else resolve();
              });
            });

            global.log?.info?.("PICON", `تمت إعادة صورة ${key}`);
          } catch (error) {
            global.log?.warn?.("PICON", `فشل إعادة صورة ${key}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      global.log?.warn?.("PICON", `خطأ في مراقبة صورة ${key}: ${error.message}`);
    }
  }, PIC_CHECK_MS);
}

// ══════════════════════════════════════════════════════════════════════════════
// RESTORE (بعد Restart)
// ══════════════════════════════════════════════════════════════════════════════

function restoreAll(api) {
  if (restored) return;
  if (!api) return;
  restored = true;
  startCleanupInterval();

  const data = load();
  for (const [tid, value] of Object.entries(data)) {
    const pp = value?.photoProtection;
    if (pp?.active && pp.photoURL) {
      startPhotoProtection(api, tid, pp.photoURL);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ══════════════════════════════════════════════════════════════════════════════

function cleanupMemory() {
  const data = load();
  for (const [tid] of Object.entries(imageProtectTimers)) {
    if (!data[tid]?.photoProtection?.active) {
      stopPhotoProtection(tid);
    }
  }
}

function startCleanupInterval() {
  if (_cleanupInterval) return;
  _cleanupInterval = setInterval(cleanupMemory, CLEANUP_INTERVAL_MS);
  if (_cleanupInterval.unref) _cleanupInterval.unref();
}

// ══════════════════════════════════════════════════════════════════════════════
// MODULE
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {

  config: {
    name: "picon",
    aliases: ["picoff"],
    version: "1.0.0",
    author: "Cavor",
    countDown: 3,
    role: 2,
    category: "management",
    description: "حماية صورة المجموعة",
    guide: {
      ar:
        "/picon — رد على صورة لحمايتها\n" +
        "/picoff — إيقاف الحماية",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // TEST API
  // ═══════════════════════════════════════════════════════════════════════

  _test: {
    load,
    save,
    stopPhotoProtection,
    startPhotoProtection,
    restoreAll,
    cleanupMemory,
    imageProtectTimers,
    PIC_CHECK_MS,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // COMMAND HANDLER
  // ═══════════════════════════════════════════════════════════════════════

  onStart: async function ({ api, event, args, message, commandName }) {
    const tid = String(event.threadID);
    const senderID = String(event.senderID);
    const cmd = String(commandName || "").toLowerCase();

    restoreAll(api);

    // ═══════════════════════════════════════════════════════════════════
    // /picoff — إيقاف حماية الصورة
    // ═══════════════════════════════════════════════════════════════════

    if (cmd === "picoff") {
      if (!isAdmin(senderID)) return;

      stopPhotoProtection(tid);

      const data = load();
      if (data[tid]?.photoProtection) {
        delete data[tid].photoProtection;
        save(data);
      }

      await message.reply("✅ تم إيقاف حماية الصورة.");
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // /picon — حماية صورة المجموعة
    // ═══════════════════════════════════════════════════════════════════

    if (cmd === "picon") {
      if (!isAdmin(senderID)) return;

      // يجب أن يكون رد على رسالة
      if (!event.messageReply) {
        return message.reply("❌ رد على صورة تريد حمايتها بـ /picon");
      }

      const repliedMsg = event.messageReply;

      // البحث عن صورة في الرد
      let photoURL = "";

      // طريقة 1: attachments
      if (repliedMsg.attachments?.length) {
        for (const att of repliedMsg.attachments) {
          if (att.type === "photo" || att.type === "image") {
            photoURL = att.url || att.photoURL || "";
            break;
          }
        }
      }

      // طريقة 2: صورة مباشرة من الرد
      if (!photoURL && repliedMsg.photoURL) {
        photoURL = repliedMsg.photoURL;
      }

      if (!photoURL) {
        return message.reply("❌ الرسالة المُردة لا تحتوي على صورة.\nرد على صورة ثم اكتب /picon");
      }

      // تفاعل 🪽 مع الرسالة
      try {
        if (typeof api.setMessageReaction === "function") {
          api.setMessageReaction("🪽", event.messageID, () => {}, true);
        }
      } catch (_) {}

      // حفظ الصورة كصورة محمية
      const data = load();
      if (!data[tid] || typeof data[tid] !== "object") data[tid] = {};
      data[tid].photoProtection = {
        active: true,
        photoURL,
        updatedAt: Date.now(),
      };
      save(data);

      // بدء المراقبة
      startPhotoProtection(api, tid, photoURL);

      // إرسال تأكيد
      try {
        await sendText(api, tid, "🪽 تم تفعيل حماية الصورة.");
      } catch (_) {}
      return;
    }
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// SEND TEXT HELPER
// ══════════════════════════════════════════════════════════════════════════════

async function sendText(api, tid, text) {
  const body = String(text ?? "");
  const delay = global.utils?.calcHumanTypingDelay?.(body) || 1000;
  try { await global.utils?.simulateTyping?.(api, String(tid), delay); } catch (_) {}
  return new Promise((resolve, reject) => {
    api.sendMessage(body, String(tid), (err, info) => {
      if (err) reject(err); else resolve(info);
    });
  });
}
