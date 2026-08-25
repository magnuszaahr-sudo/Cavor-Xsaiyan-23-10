"use strict";

const fs = require("fs-extra");
const path = require("path");

/*
 * Cavor-Xv3-11/x
 * Copyright © 2026 Cavor
 *
 * الأوامر:
 * /الوكس تشغيل [الرسالة]
 * /الوكس ايقاف
 * /الوكس شات
 * /الوكس نيم [الاسم]
 * /الوكس كنيات [الكنية]
 * /الوكس تنظيف
 * /اضافة [ID]
 * /ازالة [ID]
 * /لعبة الكرامة [ID]
 * /لعبة الكرامة ايقاف [ID]
 * /لعبة ايقاف [ID]
 * /uptime
 */

const DATA = path.join(
  process.cwd(),
  "database/data/cavorData.json"
);

const RESPONSE_DELAY_MS = 30 * 1000;
const SILENCE_MS = 16 * 60 * 1000;
const LEAVE_DELAY_MS = 1500;
const GAME_DELAY_MS = 1500;

const MAX_RESPONSES = 3;

const PROCESSED_TTL_MS = 30 * 60 * 1000;
const MAX_PROCESSED = 500;

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const ESCAPE_MESSAGE =
  "هروب ابن ﭑ礅لَـڨَـ📜⍣⃟ـ켠۪۫٘ہـ𝑯ـٰٰٰٖٖٖٖٖ켠۪┇ـےـ❄️ـ┇بَِـ⥢🪽⥤ـےـٰٰٰٖٖٖٖٖ𝐁ـޢـٰٰٰٖٖٖٖٖޢـة";


// ══════════════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ══════════════════════════════════════════════════════════════════════════════

const state =
  global.__CAVOR_CAVOR_STATE ||
  (global.__CAVOR_CAVOR_STATE = Object.create(null));

const gameState =
  global.__CAVOR_CAVOR_GAME ||
  (global.__CAVOR_CAVOR_GAME = Object.create(null));

const operationLocks =
  global.__CAVOR_CAVOR_LOCKS ||
  (global.__CAVOR_CAVOR_LOCKS = Object.create(null));

const processed =
  global.__CAVOR_CAVOR_PROCESSED ||
  (global.__CAVOR_CAVOR_PROCESSED = new Map());

// ══════════════════════════════════════════════════════════════════════════════
// NAME MONITORING STATE
// ══════════════════════════════════════════════════════════════════════════════

const nameMonitors =
  global.__CAVOR_NAME_MONITORS ||
  (global.__CAVOR_NAME_MONITORS = Object.create(null));

const NAME_CHECK_MS = 10 * 1000;

const NICK_CHECK_MS = 3500;
const NICK_APPLY_DELAY_MS = 2000;

const nicknameMonitors =
  global.__CAVOR_NICKNAME_MONITORS ||
  (global.__CAVOR_NICKNAME_MONITORS = Object.create(null));

// ══════════════════════════════════════════════════════════════════════════════
// CHAT SESSION STATE (الوكس شات)
// ══════════════════════════════════════════════════════════════════════════════

const chatSessions =
  global.__CAVOR_CHAT_SESSIONS ||
  (global.__CAVOR_CHAT_SESSIONS = new Map());

const CHAT_SESSION_TIMEOUT_MS = 5 * 60 * 1000;

let restored = false;
let _cleanupInterval = null;


// ══════════════════════════════════════════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════════════════════════════════════════

function load() {
  try {
    if (!fs.existsSync(DATA)) return {};
    const value = JSON.parse(fs.readFileSync(DATA, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    global.log?.warn?.("CAVOR", `فشل قراءة البيانات: ${error.message}`);
    return {};
  }
}


function save(data) {
  fs.ensureDirSync(path.dirname(DATA));
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
}


// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function clearTimer(obj, key) {
  if (obj?.[key]) clearTimeout(obj[key]);
  if (obj && key in obj) delete obj[key];
}


function getState(tid) {
  const key = String(tid);

  if (!state[key]) {
    state[key] = {
      active: true,
      queue: [],
      sentInCycle: 0,
      paused: false,
      pausedAt: null,
      lastHumanMessageAt: 0,
      lastHumanMessageID: null,
      responseTimer: null,
      silenceTimer: null,
      leaving: false,
      processing: false,
      generation: 0,
    };
  }

  return state[key];
}


function clearTimers(tid) {
  const key = String(tid);
  const st = state[key];
  if (!st) return;
  clearTimer(st, "responseTimer");
  clearTimer(st, "silenceTimer");
}


function destroyState(tid) {
  const key = String(tid);
  clearTimers(key);
  delete state[key];
}


// ══════════════════════════════════════════════════════════════════════════════
// PERIODIC MEMORY CLEANUP
// ══════════════════════════════════════════════════════════════════════════════

function cleanupMemory() {
  const now = Date.now();

  // 1. تنظيف خريطة الرسائل المعالجة القديمة
  if (processed.size > 0) {
    for (const [k, ts] of processed) {
      if (now - ts > PROCESSED_TTL_MS) {
        processed.delete(k);
      }
    }
  }

  // 2. تنظيف حالات threads القديمة غير النشطة
  for (const [tid, st] of Object.entries(state)) {
    if (
      !st.active &&
      !st.leaving &&
      !st.responseTimer &&
      !st.silenceTimer &&
      (!st.lastHumanMessageAt || now - st.lastHumanMessageAt > PROCESSED_TTL_MS)
    ) {
      destroyState(tid);
    }
  }

  // 3. تنظيف جلسات الشات المنتهية
  for (const [key, session] of chatSessions) {
    if (now - session.createdAt > CHAT_SESSION_TIMEOUT_MS * 2) {
      cleanupChatSession(key);
    }
  }
}

function startCleanupInterval() {
  if (_cleanupInterval) return;
  _cleanupInterval = setInterval(cleanupMemory, CLEANUP_INTERVAL_MS);
  // Prevent the interval from keeping the process alive
  if (_cleanupInterval.unref) _cleanupInterval.unref();
}


// ══════════════════════════════════════════════════════════════════════════════
// DUPLICATE MESSAGE PROTECTION
// ══════════════════════════════════════════════════════════════════════════════

function markProcessed(tid, messageID) {
  if (!messageID) return false;

  const key = `${tid}:${messageID}`;
  const now = Date.now();

  if (processed.has(key)) return true;

  processed.set(key, now);

  // تنظيف فوري إذا تجاوز الحد
  if (processed.size > MAX_PROCESSED) {
    for (const [k, ts] of processed) {
      if (now - ts > PROCESSED_TTL_MS || processed.size > MAX_PROCESSED) {
        processed.delete(k);
      }
      if (processed.size <= MAX_PROCESSED * 0.8) break;
    }
  }

  return false;
}


// ══════════════════════════════════════════════════════════════════════════════
// HUMAN MESSAGE DETECTION
// ══════════════════════════════════════════════════════════════════════════════

function isRealHumanMessage(api, event) {
  if (!event) return false;

  if (event.type !== "message" && event.type !== "message_reply") {
    return false;
  }

  if (!event.threadID || !event.senderID || !event.messageID) {
    return false;
  }

  if (!String(event.body || "").trim()) {
    return false;
  }

  const botID = String(
    global.GoatBot?.botID || api?.getCurrentUserID?.() || ""
  );

  if (botID && String(event.senderID) === botID) {
    return false;
  }

  /*
   * أوامر البوت ليست رسائل بشرية
   * بالنسبة لنظام الوكس.
   */
  const prefix = String(global.GoatBot?.config?.prefix || "/");

  if (String(event.body).trimStart().startsWith(prefix)) {
    return false;
  }

  return true;
}


// ══════════════════════════════════════════════════════════════════════════════
// SEND MESSAGE + TYPING + REAL REPLY
// ══════════════════════════════════════════════════════════════════════════════

async function sendText(api, tid, text, replyToMessageID) {
  const body = String(text ?? "");

  const delay =
    global.utils?.calcHumanTypingDelay?.(body) || 1000;

  await global.utils?.simulateTyping?.(
    api,
    String(tid),
    delay
  );

  return new Promise((resolve, reject) => {
    const callback = (err, info) => {
      if (err) reject(err);
      else resolve(info);
    };

    /*
     * FCA classic:
     * sendMessage(message, threadID, callback, replyMessageID)
     */

    if (replyToMessageID && typeof api.sendMessage === "function") {
      return api.sendMessage(
        body,
        String(tid),
        callback,
        String(replyToMessageID)
      );
    }

    return api.sendMessage(body, String(tid), callback);
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// GROUP INFORMATION
// ══════════════════════════════════════════════════════════════════════════════

function getGroupInfo(api, tid) {
  return new Promise((resolve, reject) => {
    if (typeof api.getThreadInfo !== "function") {
      return reject(new Error("getThreadInfo غير متاح في FCA"));
    }
    api.getThreadInfo(String(tid), (err, info) => {
      if (err) reject(err);
      else resolve(info || {});
    });
  });
}


function groupAdmins(info) {
  const ids = info?.adminIDs;
  return new Set(Array.isArray(ids) ? ids.map(String) : []);
}


async function assertTargetIsNotAdmin(api, tid, targetID) {
  const info = await getGroupInfo(api, tid);
  const admins = groupAdmins(info);

  if (admins.has(String(targetID))) {
    throw new Error(
      "لا يمكن إضافة أو إزالة عضو لديه صلاحية Admin في المجموعة."
    );
  }

  return info;
}


// ══════════════════════════════════════════════════════════════════════════════
// ADD / REMOVE API
// ══════════════════════════════════════════════════════════════════════════════

function runGroupOperation(api, method, targetID, tid) {
  return new Promise((resolve, reject) => {
    const fn = api?.[method];
    if (typeof fn !== "function") {
      return reject(new Error(`${method} غير متاح في FCA`));
    }
    fn.call(api, String(targetID), String(tid), (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// OPERATION LOCK (لمنع العمليات المتزامنة)
// ══════════════════════════════════════════════════════════════════════════════

async function withOperationLock(tid, targetID, fn) {
  const key = String(tid);
  const uid = String(targetID);

  if (!operationLocks[key]) {
    operationLocks[key] = Object.create(null);
  }

  const previous = operationLocks[key][uid] || Promise.resolve();
  let release;

  const current = new Promise(resolve => {
    release = resolve;
  });

  const tail = previous.then(() => current);
  operationLocks[key][uid] = tail;

  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (operationLocks[key][uid] === tail) {
      delete operationLocks[key][uid];
    }
    if (!Object.keys(operationLocks[key]).length) {
      delete operationLocks[key];
    }
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// 16 MINUTE WATCHDOG
// ══════════════════════════════════════════════════════════════════════════════

function scheduleSilenceWatchdog(api, tid) {
  const key = String(tid);
  const st = state[key];

  if (!st || !st.active || !st.paused || st.leaving) {
    return;
  }

  clearTimer(st, "silenceTimer");

  const pausedAt = st.pausedAt || Date.now();
  const remaining = Math.max(0, SILENCE_MS - (Date.now() - pausedAt));

  st.silenceTimer = setTimeout(async () => {
    st.silenceTimer = null;

    const data = load();
    const cfg = data[key]?.cavor;
    const current = state[key];

    if (!cfg?.active || !current || !current.paused || current.leaving) {
      return;
    }

    if (Date.now() - (current.pausedAt || Date.now()) < SILENCE_MS) {
      scheduleSilenceWatchdog(api, key);
      return;
    }

    await sendEscapeAndLeave(api, key);
  }, remaining);
}


// ══════════════════════════════════════════════════════════════════════════════
// ESCAPE + LEAVE
// ══════════════════════════════════════════════════════════════════════════════

async function sendEscapeAndLeave(api, tid) {
  const key = String(tid);
  const st = state[key];

  if (!st || st.leaving) return;

  st.leaving = true;
  clearTimers(key);

  try {
    try {
      await sendText(api, key, ESCAPE_MESSAGE);
    } catch (error) {
      global.log?.warn?.("CAVOR", `فشل إرسال الهروب: ${error.message}`);
    }

    await sleep(LEAVE_DELAY_MS);

    const botID = String(
      api.getCurrentUserID?.() || global.GoatBot?.botID || ""
    );

    if (!botID) throw new Error("تعذر الحصول على ID البوت");

    await runGroupOperation(api, "removeUserFromGroup", botID, key);

  } catch (error) {
    global.log?.warn?.("CAVOR", `تعذر خروج البوت من ${key}: ${error.message}`);

  } finally {
    const data = load();
    if (data[key]?.cavor) {
      data[key].cavor.active = false;
      save(data);
    }
    destroyState(key);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// RESPONSE QUEUE
// ══════════════════════════════════════════════════════════════════════════════

function scheduleResponse(api, tid) {
  const key = String(tid);
  const st = state[key];

  if (
    !st || !st.active || st.paused || st.leaving ||
    st.processing || st.responseTimer || !st.queue.length
  ) {
    return;
  }

  if (st.sentInCycle >= MAX_RESPONSES) {
    st.paused = true;
    st.pausedAt = Date.now();
    scheduleSilenceWatchdog(api, key);
    return;
  }

  const generation = st.generation;

  st.responseTimer = setTimeout(async () => {
    st.responseTimer = null;

    const data = load();
    const cfg = data[key]?.cavor;
    const current = state[key];

    if (
      !cfg?.active || !current || current.leaving ||
      current.paused || current.generation !== generation
    ) {
      return;
    }

    if (!current.queue.length) return;

    current.processing = true;
    const item = current.queue.shift();

    try {
      await sendText(api, key, cfg.message, item.messageID);
      current.sentInCycle += 1;
    } catch (error) {
      global.log?.warn?.("CAVOR", `فشل إرسال رد في ${key}: ${error.message}`);
    } finally {
      current.processing = false;
    }

    const fresh = load()[key]?.cavor;

    if (!fresh?.active || state[key] !== current) return;

    if (current.sentInCycle >= MAX_RESPONSES) {
      current.queue.length = 0;
      current.paused = true;
      current.pausedAt = Date.now();
      scheduleSilenceWatchdog(api, key);
      return;
    }

    scheduleResponse(api, key);

  }, RESPONSE_DELAY_MS);
}


// ══════════════════════════════════════════════════════════════════════════════
// HUMAN MESSAGE HANDLER
// ══════════════════════════════════════════════════════════════════════════════

function handleHumanMessage(api, event) {
  if (!isRealHumanMessage(api, event)) return;

  const tid = String(event.threadID);

  const data = load();
  const cfg = data[tid]?.cavor;

  if (!cfg?.active) return;

  if (markProcessed(tid, event.messageID)) return;

  let st = state[tid];

  if (!st) {
    st = getState(tid);
    st.active = true;
    st.sentInCycle = 0;
  }

  if (st.leaving) return;

  st.lastHumanMessageAt = Date.now();
  st.lastHumanMessageID = String(event.messageID);

  /*
   * أول رسالة بشرية بعد التوقف تبدأ Cycle جديدة.
   */
  if (st.paused) {
    clearTimer(st, "silenceTimer");
    st.paused = false;
    st.pausedAt = null;
    st.sentInCycle = 0;
    st.queue.length = 0;
    st.generation += 1;
  }

  st.queue.push({
    messageID: String(event.messageID),
    senderID: String(event.senderID),
    body: String(event.body),
  });

  scheduleResponse(api, tid);
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
    const cfg = value?.cavor;

    if (!cfg?.active || !cfg.message) continue;

    const st = getState(tid);
    st.active = true;
    st.queue.length = 0;
    st.sentInCycle = 0;
    st.paused = false;
    st.pausedAt = null;
    st.leaving = false;
    st.generation += 1;

    /*
     * بعد Restart:
     * لا نعيد الرسائل القديمة.
     * أول رسالة جديدة فقط تبدأ دورة جديدة.
     */
  }

  // استعادة مراقبة أسماء المجموعات
  for (const [tid, value] of Object.entries(data)) {
    const nm = value?.nameMonitor;
    if (!nm?.active || !nm.name) continue;
    startNameMonitor(api, tid, nm.name);
  }

  // استعادة مراقبة الكنيات
  for (const [tid, value] of Object.entries(data)) {
    const nm = value?.nicknameMonitor;
    if (!nm?.active || !nm.nickname) continue;
    startNicknameMonitor(api, tid, nm.nickname);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// UPTIME
// ══════════════════════════════════════════════════════════════════════════════

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (
    `${d ? `${d}d ` : ""}` +
    `${h}h ` +
    `${m}m ` +
    `${s}s`
  );
}


function formatMemory(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}


// ══════════════════════════════════════════════════════════════════════════════
// لعبة الكرامة
// ══════════════════════════════════════════════════════════════════════════════

function getGameKey(tid, targetID) {
  return `${String(tid)}:${String(targetID)}`;
}


function stopGame(tid, targetID) {
  const key = getGameKey(tid, targetID);
  const game = gameState[key];

  if (!game) return false;

  game.stopped = true;

  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }

  // إلغاء أي Promise معلقة في waitGame
  if (typeof game.resolveTimer === "function") {
    game.resolveTimer();
    game.resolveTimer = null;
  }

  delete gameState[key];

  return true;
}


/**
 * إيقاف جميع ألعاب الكرامة في Thread معين
 */
function stopAllGamesForThread(tid) {
  const prefix = String(tid) + ":";
  const keys = Object.keys(gameState).filter(k => k.startsWith(prefix));
  let stopped = 0;

  for (const key of keys) {
    const game = gameState[key];
    if (game) {
      game.stopped = true;
      if (game.timer) {
        clearTimeout(game.timer);
        game.timer = null;
      }
      if (typeof game.resolveTimer === "function") {
        game.resolveTimer();
        game.resolveTimer = null;
      }
      delete gameState[key];
      stopped++;
    }
  }

  return stopped;
}


function waitGame(game, ms) {
  if (game.stopped) return Promise.resolve();

  return new Promise(resolve => {
    game.resolveTimer = resolve;
    game.timer = setTimeout(() => {
      game.timer = null;
      game.resolveTimer = null;
      resolve();
    }, ms);
  });
}


async function runGame(api, tid, targetID, game) {
  while (!game.stopped) {
    try {
      await withOperationLock(tid, targetID, async () => {
        if (game.stopped) return;

        // قبل كل Add/Remove نعيد فحص صلاحية الهدف
        await assertTargetIsNotAdmin(api, tid, targetID);

        const method =
          game.next === "add"
            ? "addUserToGroup"
            : "removeUserFromGroup";

        try {
          await runGroupOperation(api, method, targetID, tid);
        } catch (error) {
          global.log?.warn?.(
            "CAVOR",
            `لعبة الكرامة ${method} فشلت: ${error.message}`
          );
        }

        game.next = game.next === "add" ? "remove" : "add";
      });
    } catch (error) {
      global.log?.warn?.(
        "CAVOR",
        `إيقاف لعبة الكرامة لـ${targetID}: ${error.message}`
      );
      game.stopped = true;
      break;
    }

    if (game.stopped) break;

    await waitGame(game, GAME_DELAY_MS);
  }
}


async function startGame(api, tid, targetID) {
  const key = getGameKey(tid, targetID);

  if (gameState[key]) return false;

  await assertTargetIsNotAdmin(api, tid, targetID);

  const game = (gameState[key] = {
    stopped: false,
    next: "add",
    timer: null,
    resolveTimer: null,
  });

  runGame(api, String(tid), String(targetID), game).catch(error => {
    global.log?.warn?.("CAVOR", `لعبة الكرامة انتهت: ${error.message}`);
    stopGame(tid, targetID);
  });

  return true;
}


// ══════════════════════════════════════════════════════════════════════════════
// NICKNAME HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function changeOneNickname(api, tid, uid, nickname) {
  return new Promise((resolve) => {
    if (typeof api.changeNickname !== "function") {
      return resolve(false);
    }
    api.changeNickname(nickname, String(tid), String(uid), (err) => {
      resolve(!err);
    });
  });
}


function getMemberIDs(api, tid) {
  return new Promise((resolve) => {
    if (typeof api.getThreadInfo !== "function") {
      return resolve([]);
    }
    api.getThreadInfo(String(tid), (err, info) => {
      if (err || !info) return resolve([]);
      resolve(Array.isArray(info.participantIDs) ? info.participantIDs.map(String) : []);
    });
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// NICKNAME MONITORING (مراقبة الكنيات)
// ══════════════════════════════════════════════════════════════════════════════

function stopNicknameMonitor(tid) {
  const key = String(tid);
  if (nicknameMonitors[key]) {
    clearInterval(nicknameMonitors[key]);
    delete nicknameMonitors[key];
  }
}


function startNicknameMonitor(api, tid, desiredNickname) {
  const key = String(tid);
  stopNicknameMonitor(key);

  nicknameMonitors[key] = setInterval(async () => {
    try {
      const memberIDs = await getMemberIDs(api, key);
      const botID = String(
        global.GoatBot?.botID || api?.getCurrentUserID?.() || ""
      );

      for (const uid of memberIDs) {
        if (botID && uid === botID) continue;
        try {
          const info = await new Promise((resolve) => {
            if (typeof api.getThreadInfo !== "function") return resolve({});
            api.getThreadInfo(key, (err, data) => {
              if (err || !data) resolve({});
              else resolve(data);
            });
          });
          const currentNick = info?.nicknames?.[uid] || "";
          if (currentNick !== desiredNickname) {
            await changeOneNickname(api, key, uid, desiredNickname);
          }
        } catch (_) {}
      }
    } catch (error) {
      global.log?.warn?.(
        "NICKNAME_MONITOR",
        `خطأ في مراقبة كنيات ${key}: ${error.message}`
      );
    }
  }, NICK_CHECK_MS);
}


async function cleanNicknames(api, tid) {
  const key = String(tid);
  const memberIDs = await getMemberIDs(api, key);
  const botID = String(
    global.GoatBot?.botID || api?.getCurrentUserID?.() || ""
  );
  let cleaned = 0;

  for (const uid of memberIDs) {
    if (botID && uid === botID) continue;
    try {
      const success = await changeOneNickname(api, key, uid, "");
      if (success) cleaned++;
    } catch (_) {}
    if (memberIDs.indexOf(uid) < memberIDs.length - 1) {
      await sleep(NICK_APPLY_DELAY_MS);
    }
  }

  return cleaned;
}


// ══════════════════════════════════════════════════════════════════════════════
// NAME MONITORING (مراقبة اسم المجموعة)
// ══════════════════════════════════════════════════════════════════════════════

function stopNameMonitor(tid) {
  const key = String(tid);
  if (nameMonitors[key]) {
    clearInterval(nameMonitors[key]);
    delete nameMonitors[key];
  }
}

function startNameMonitor(api, tid, desiredName) {
  const key = String(tid);

  // إيقاف أي مراقبة سابقة
  stopNameMonitor(key);

  nameMonitors[key] = setInterval(async () => {
    try {
      const info = await new Promise((resolve, reject) => {
        if (typeof api.getThreadInfo !== "function") {
          return reject(new Error("getThreadInfo غير متاح"));
        }
        api.getThreadInfo(key, (err, data) => {
          if (err) reject(err);
          else resolve(data || {});
        });
      });

      const currentName = info.threadName || info.name || "";

      if (currentName !== desiredName) {
        await new Promise((resolve, reject) => {
          if (typeof api.setTitle !== "function") {
            return reject(new Error("setTitle غير متاح"));
          }
          api.setTitle(desiredName, key, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        global.log?.info?.(
          "MONITOR",
          `تمت إعادة اسم ${key} إلى "${desiredName}"`
        );
      }
    } catch (error) {
      global.log?.warn?.(
        "MONITOR",
        `خطأ في مراقبة اسم ${key}: ${error.message}`
      );
    }
  }, NAME_CHECK_MS);
}


async function handleMemberCommand(api, event, message, action, targetID) {
  if (!/^\d+$/.test(String(targetID || ""))) {
    return message.reply("❌ أرسل ID صحيحاً.");
  }

  const tid = String(event.threadID);
  const uid = String(targetID);

  try {
    await withOperationLock(tid, uid, async () => {
      await assertTargetIsNotAdmin(api, tid, uid);

      const method =
        action === "add"
          ? "addUserToGroup"
          : "removeUserFromGroup";

      await runGroupOperation(api, method, uid, tid);
    });

    await sendText(
      api,
      tid,
      action === "add"
        ? "✅ تمت إضافة الشخص بنجاح."
        : "✅ تمت إزالة الشخص بنجاح."
    );

  } catch (error) {
    global.log?.warn?.(
      "CAVOR",
      `${action} ${uid} في ${tid}: ${error.message}`
    );

    try {
      await sendText(api, tid, `❌ فشلت العملية: ${error.message}`);
    } catch (_) {}
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// CHAT SESSION (الوكس شات)
// ══════════════════════════════════════════════════════════════════════════════

function cleanupChatSession(sessionKey) {
  const session = chatSessions.get(sessionKey);
  if (session?.timeout) clearTimeout(session.timeout);
  chatSessions.delete(sessionKey);
}

function resetChatTimeout(sessionKey) {
  const session = chatSessions.get(sessionKey);
  if (!session) return;
  if (session.timeout) clearTimeout(session.timeout);
  session.timeout = setTimeout(() => {
    chatSessions.delete(sessionKey);
  }, CHAT_SESSION_TIMEOUT_MS);
  if (session.timeout?.unref) session.timeout.unref();
}

function stopAllChatSessions() {
  for (const [key, session] of chatSessions) {
    if (session?.timeout) clearTimeout(session.timeout);
  }
  chatSessions.clear();
}


/**
 * جلب قائمة المحادثات من FCA
 */
function getThreadListFromFCA(api, folder) {
  return new Promise((resolve) => {
    if (!api || typeof api.getThreadList !== "function") return resolve([]);
    api.getThreadList(20, null, [folder], (err, data) => {
      if (err || !data) return resolve([]);
      resolve(Array.isArray(data) ? data : []);
    });
  });
}


/**
 * إرسال رسالة + تسجيل onReply
 */
function sendWithOnReply(api, tid, text, senderID, callback) {
  return new Promise((resolve, reject) => {
    const delay = global.utils?.calcHumanTypingDelay?.(text) || 1000;
    global.utils?.simulateTyping?.(api, String(tid), delay)
      .catch(() => {})
      .finally(() => {
        api.sendMessage(String(text), String(tid), (err, info) => {
          if (err) return reject(err);
          if (info?.messageID && global.GoatBot?.onReply) {
            const key = `chat_${senderID}_${Date.now()}`;
            global.GoatBot.onReply.set(key, {
              messageID: info.messageID,
              author: String(senderID),
              callback,
            });
          }
          resolve(info);
        });
      });
  });
}


/**
 * تنفيذ أمر عن بُعد على مجموعة أخرى
 */
function getRoleForSender(senderID) {
  const cfg = global.GoatBot?.config || {};
  const sid = String(senderID);
  const supers = [...(cfg.superAdminBot || []), cfg.ownerID].filter(Boolean).map(String);
  const admins = (cfg.adminBot || []).map(String);
  if (supers.includes(sid)) return 3;
  if (admins.includes(sid)) return 2;
  return 0;
}

async function executeRemoteCommand(api, commandText, targetTid, senderID) {
  const prefix = global.GoatBot?.config?.prefix || "/";

  if (!commandText.trimStart().startsWith(prefix)) {
    return { ok: false, error: "الأمر يجب أن يبدأ بـ " + prefix };
  }

  const parts = commandText.trimStart().slice(prefix.length).trim().split(/\s+/);
  const cmdName = (parts[0] || "").toLowerCase();
  const args = parts.slice(1);

  if (!cmdName) return { ok: false, error: "أمر غير صالح." };

  const commands = global.GoatBot?.commands;
  const cmd = commands?.get(cmdName);
  if (!cmd) return { ok: false, error: "الأمر غير موجود: " + cmdName };

  const requiredRole = cmd.config?.role ?? 2;
  if (getRoleForSender(senderID) < requiredRole) {
    return { ok: false, error: "ليس لديك صلاحية لتنفيذ هذا الأمر." };
  }

  const fakeEvent = {
    threadID: String(targetTid),
    senderID: String(senderID),
    messageID: null,
    body: commandText,
    type: "message",
  };

  const fakeMessage = {
    reply: async (msg) => {
      try {
        const text = typeof msg === "string" ? msg : msg?.body || "";
        const d = global.utils?.calcHumanTypingDelay?.(text) || 1000;
        await global.utils?.simulateTyping?.(api, String(targetTid), d);
      } catch (_) {}
      return api.sendMessage(msg, String(targetTid));
    },
    send: (msg, tid) => api.sendMessage(msg, String(tid || targetTid)),
  };

  const ctx = {
    api,
    event: fakeEvent,
    args,
    commandName: cmdName,
    message: fakeMessage,
    prefix,
    role: getRoleForSender(senderID),
    senderID: String(senderID),
    threadID: String(targetTid),
  };

  try {
    if (typeof cmd.onStart === "function") await cmd.onStart(ctx);
    else if (typeof cmd.run === "function") await cmd.run(ctx);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}


/**
 * بدء جلسة الوكس شات
 */
async function startChatSession(api, event, message) {
  const tid = String(event.threadID);
  const senderID = String(event.senderID);
  const sessionKey = `${tid}_${senderID}`;

  // تنظيف أي جلسة سابقة
  cleanupChatSession(sessionKey);

  const text =
    "🤖 الوكس شات — اختر:\n\n" +
    "1️⃣ عرض المجموعات\n" +
    "2️⃣ طلبات المراسلة\n" +
    "3️⃣ المحتوى غير المهم أو الاحتيالي";

  const session = {
    step: "menu",
    targetTid: null,
    targetName: null,
    sourceTid: tid,
    senderID,
    threadList: [],
    timeout: null,
    createdAt: Date.now(),
  };

  chatSessions.set(sessionKey, session);
  resetChatTimeout(sessionKey);

  await sendWithOnReply(api, tid, text, senderID, async ({ api: a, event: e, args: r }) => {
    const choice = String(r[0] || "").trim();
    const s = chatSessions.get(sessionKey);

    if (!s) {
      await sendText(a, tid, "⏰ انتهت الجلسة. أعد إرسال /الوكس شات");
      return;
    }

    resetChatTimeout(sessionKey);

    if (choice === "1") {
      // عرض المجموعات
      s.step = "groups_list";
      const threads = await getThreadListFromFCA(a, "INBOX");

      // تصفية: المجموعات فقط (ليست single chats) وتجنب المجموعة الحالية
      const groups = threads.filter(
        t => t.isGroup && String(t.threadID) !== tid
      );

      if (!groups.length) {
        s.step = "menu";
        await sendText(a, tid, "ℹ️ لا توجد مجموعات أخرى.");
        cleanupChatSession(sessionKey);
        return;
      }

      s.threadList = groups;
      let list = "📋 المجموعات:\n\n";
      groups.forEach((g, i) => {
        list += `${i + 1}. ${g.name || g.threadName || g.threadID}\n`;
      });
      list += "\n📩 أرسل رقم المجموعة.";

      await sendWithOnReply(a, tid, list, senderID, async ({ api: a2, args: r2 }) => {
        const num = parseInt(r2[0]);
        const s2 = chatSessions.get(sessionKey);
        if (!s2) return sendText(a2, tid, "⏰ انتهت الجلسة.");
        resetChatTimeout(sessionKey);

        if (!num || num < 1 || num > s2.threadList.length) {
          s2.step = "menu";
          cleanupChatSession(sessionKey);
          return sendText(a2, tid, "❌ رقم غير صحيح. أعد /الوكس شات");
        }

        const selected = s2.threadList[num - 1];
        s2.targetTid = String(selected.threadID);
        s2.targetName = selected.name || selected.threadName || selected.threadID;
        s2.step = "group_action";

        await showActionMenu(a2, sessionKey);
      });

    } else if (choice === "2") {
      // طلبات المراسلة
      s.step = "pending_list";
      const threads = await getThreadListFromFCA(a, "PENDING");

      if (!threads.length) {
        s.step = "menu";
        await sendText(a, tid, "ℹ️ لا توجد طلبات مراسلة.");
        cleanupChatSession(sessionKey);
        return;
      }

      s.threadList = threads;
      let list = "📩 طلبات المراسلة:\n\n";
      threads.forEach((t, i) => {
        list += `${i + 1}. ${t.name || t.threadName || t.threadID}\n`;
      });
      list += "\n📩 أرسل رقم الدردشة.";

      await sendWithOnReply(a, tid, list, senderID, async ({ api: a2, args: r2 }) => {
        const num = parseInt(r2[0]);
        const s2 = chatSessions.get(sessionKey);
        if (!s2) return sendText(a2, tid, "⏰ انتهت الجلسة.");
        resetChatTimeout(sessionKey);

        if (!num || num < 1 || num > s2.threadList.length) {
          s2.step = "menu";
          cleanupChatSession(sessionKey);
          return sendText(a2, tid, "❌ رقم غير صحيح. أعد /الوكس شات");
        }

        const selected = s2.threadList[num - 1];
        s2.targetTid = String(selected.threadID);
        s2.targetName = selected.name || selected.threadName || selected.threadID;
        s2.step = "group_action";

        await showActionMenu(a2, sessionKey);
      });

    } else if (choice === "3") {
      // المحتوى غير المهم أو الاحتيالي
      s.step = "spam_list";
      const threads = await getThreadListFromFCA(a, "ARCHIVED");

      if (!threads.length) {
        s.step = "menu";
        await sendText(a, tid, "ℹ️ لا توجد محادثات مصنفة كمحتوى غير مهم.");
        cleanupChatSession(sessionKey);
        return;
      }

      s.threadList = threads;
      let list = "🚫 المحتوى غير المهم:\n\n";
      threads.forEach((t, i) => {
        list += `${i + 1}. ${t.name || t.threadName || t.threadID}\n`;
      });
      list += "\n📩 أرسل رقم المحادثة.";

      await sendWithOnReply(a, tid, list, senderID, async ({ api: a2, args: r2 }) => {
        const num = parseInt(r2[0]);
        const s2 = chatSessions.get(sessionKey);
        if (!s2) return sendText(a2, tid, "⏰ انتهت الجلسة.");
        resetChatTimeout(sessionKey);

        if (!num || num < 1 || num > s2.threadList.length) {
          s2.step = "menu";
          cleanupChatSession(sessionKey);
          return sendText(a2, tid, "❌ رقم غير صحيح. أعد /الوكس شات");
        }

        const selected = s2.threadList[num - 1];
        s2.targetTid = String(selected.threadID);
        s2.targetName = selected.name || selected.threadName || selected.threadID;
        s2.step = "group_action";

        await showActionMenu(a2, sessionKey);
      });

    } else {
      cleanupChatSession(sessionKey);
      await sendText(a, tid, "❌ اختيار غير صحيح. أعد /الوكس شات");
    }
  });
}


/**
 * عرض قائمة الإجراءات (خروج / أمر عن بُعد)
 */
async function showActionMenu(api, sessionKey) {
  const session = chatSessions.get(sessionKey);
  if (!session) return;

  const tid = session.sourceTid;
  const senderID = session.senderID;

  const text =
    `📍 ${session.targetName}\n\n` +
    "1️⃣ الخروج من المجموعة\n" +
    "2️⃣ إرسال أمر عن بُعد";

  await sendWithOnReply(api, tid, text, senderID, async ({ api: a, args: r }) => {
    const choice = String(r[0] || "").trim();
    const s = chatSessions.get(sessionKey);
    if (!s) return sendText(a, tid, "⏰ انتهت الجلسة.");
    resetChatTimeout(sessionKey);

    if (choice === "1") {
      // الخروج من المجموعة
      try {
        const botID = String(
          a.getCurrentUserID?.() || global.GoatBot?.botID || ""
        );
        await new Promise((resolve, reject) => {
          if (typeof a.removeUserFromGroup !== "function") {
            return reject(new Error("removeUserFromGroup غير متاح"));
          }
          a.removeUserFromGroup(botID, s.targetTid, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        await sendText(a, tid, `✅ تم الخروج من: ${s.targetName}`);
      } catch (error) {
        await sendText(a, tid, `❌ فشل الخروج: ${error.message}`);
      }
      cleanupChatSession(sessionKey);

    } else if (choice === "2") {
      // أمر عن بُعد
      s.step = "remote_command";
      await sendWithOnReply(
        a,
        tid,
        "📩 رد على هذه الرسالة بالأمر الذي تريد تنفيذه على المجموعة.",
        senderID,
        async ({ api: a2, event: e2, args: r2 }) => {
          const s2 = chatSessions.get(sessionKey);
          if (!s2) return sendText(a2, tid, "⏰ انتهت الجلسة.");
          resetChatTimeout(sessionKey);

          // الرسالة هي الأمر المراد تنفيذه
          const commandText = String(e2.body || "").trim();
          if (!commandText) {
            await sendText(a2, tid, "❌ أمر فارغ.");
            cleanupChatSession(sessionKey);
            return;
          }

          await sendText(a2, tid, `⏳ جارٍ تنفيذ: ${commandText.substring(0, 50)}...`);

          const result = await executeRemoteCommand(
            a2,
            commandText,
            s2.targetTid,
            senderID
          );

          if (result.ok) {
            await sendText(a2, tid, "✅ تم تنفيذ الأمر على المجموعة.");
          } else {
            await sendText(a2, tid, `❌ فشل التنفيذ: ${result.error}`);
          }

          cleanupChatSession(sessionKey);
        }
      );

    } else {
      cleanupChatSession(sessionKey);
      await sendText(a, tid, "❌ اختيار غير صحيح. أعد /الوكس شات");
    }
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// MODULE
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {

  config: {
    name: "الوكس",
    aliases: [
      "وكس",
      "cavor",
      "شات",
      "اضافة",
      "ازالة",
      "لعبة",
      "uptime",
      "نيم",
      "كنيات",
    ],
    version: "3.0.0",
    author: "Cavor",
    countDown: 3,
    role: 2,
    category: "management",
    description: "Cavor-Xv3-11/x",
    guide: {
      en:
        "/الوكس تشغيل [message] | " +
        "/الوكس ايقاف | " +
        "/الوكس شات | " +
        "/الوكس نيم [name] | " +
        "/الوكس كنيات [nickname] | " +
        "/الوكس تنظيف | " +
        "/اضافة [ID] | " +
        "/ازالة [ID] | " +
        "/لعبة الكرامة [ID] | " +
        "/لعبة الكرامة ايقاف [ID] | " +
        "/uptime",
      ar:
        "/الوكس تشغيل [الرسالة]\n" +
        "/الوكس ايقاف\n" +
        "/الوكس شات\n" +
        "/الوكس نيم [الاسم]\n" +
        "/الوكس كنيات [الكنية]\n" +
        "/الوكس تنظيف\n" +
        "/اضافة [ID]\n" +
        "/ازالة [ID]\n" +
        "/لعبة الكرامة [ID]\n" +
        "/لعبة الكرامة ايقاف [ID]\n" +
        "/لعبة ايقاف [ID]\n" +
        "/uptime",
    },
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  onEvent: async function ({ api, event }) {
    if (!api || !event) return;

    restoreAll(api);
    handleHumanMessage(api, event);
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // COMMAND HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  onStart: async function ({ api, event, args, message, commandName }) {
    const tid = String(event.threadID);

    restoreAll(api);

    const cmd = String(commandName || "الوكس").toLowerCase();
    const sub = String(args[0] || "").toLowerCase();


    // ═══════════════════════════════════════════════════════════════════════
    // UPTIME
    // ═══════════════════════════════════════════════════════════════════════

    if (cmd === "uptime") {
      const mem = process.memoryUsage();

      return message.reply(
        "🔵 Αℓσx\n\n" +
        "╭──────────────╮\n" +
        "│ 🟢 BOT ONLINE\n" +
        "│\n" +
        `│ ⏱️ Uptime: ${formatUptime(process.uptime())}\n` +
        `│ 🧠 RAM: ${formatMemory(mem.heapUsed)}\n` +
        `│ 💾 RSS: ${formatMemory(mem.rss)}\n` +
        `│ ⚙️ Node: ${process.version}\n` +
        "╰──────────────╯"
      );
    }


    // ═══════════════════════════════════════════════════════════════════════
    // ADD / REMOVE
    // ═══════════════════════════════════════════════════════════════════════

    if (cmd === "اضافة" || cmd === "ازالة") {
      return handleMemberCommand(
        api,
        event,
        message,
        cmd === "اضافة" ? "add" : "remove",
        args[0]
      );
    }


    // ═══════════════════════════════════════════════════════════════════════
    // لعبة الكرامة
    // ═══════════════════════════════════════════════════════════════════════

    if (cmd === "لعبة") {

      // /لعبة ايقاف [ID] — إيقاف جميع الألعاب في Thread أو لشخص معين
      if (sub === "ايقاف" || sub === "إيقاف") {
        const targetID = args[1];

        if (targetID && /^\d+$/.test(String(targetID))) {
          stopGame(tid, targetID);
          await sendText(api, tid, "😂");
        } else if (!targetID) {
          // إيقاف جميع الألعاب في هذا Thread
          const stopped = stopAllGamesForThread(tid);
          await sendText(
            api,
            tid,
            stopped > 0
              ? `😂 تمت إيقاف ${stopped} لعبة(ألعاب).`
              : "ℹ️ لا توجد ألعاب نشطة."
          );
        } else {
          return message.reply("❌ الاستخدام: /لعبة ايقاف [ID] (اختياري)");
        }
        return;
      }

      // /لعبة الكرامة [أوامر فرعية]
      if (sub !== "الكرامة" && sub !== "كرامة") {
        return message.reply(
          "❌ الاستخدام: /لعبة الكرامة [ID] أو /لعبة ايقاف [ID]"
        );
      }

      // /لعبة الكرامة ايقاف [ID]
      if (
        String(args[1] || "").toLowerCase() === "ايقاف" ||
        String(args[1] || "").toLowerCase() === "إيقاف"
      ) {
        const targetID = args[2];

        if (!/^\d+$/.test(String(targetID || ""))) {
          return message.reply("❌ الاستخدام: /لعبة الكرامة ايقاف [ID]");
        }

        stopGame(tid, targetID);
        await sendText(api, tid, "😂");
        return;
      }

      // /لعبة الكرامة [ID]
      const targetID = args[1];

      if (!/^\d+$/.test(String(targetID || ""))) {
        return message.reply("❌ أرسل ID صحيحاً.");
      }

      try {
        const started = await startGame(api, tid, String(targetID));

        await sendText(
          api,
          tid,
          started
            ? "🎮 بدأت لعبة الكرامة."
            : "ℹ️ لعبة الكرامة تعمل بالفعل لهذا الشخص."
        );
      } catch (error) {
        await sendText(
          api,
          tid,
          `❌ تعذر بدء اللعبة: ${error.message}`
        );
      }

      return;
    }


    // ═══════════════════════════════════════════════════════════════════════
    // الوكس / CAVOR
    // ═══════════════════════════════════════════════════════════════════════

    if (
      cmd === "الوكس" || cmd === "وكس" ||
      cmd === "cavor"
    ) {

      // ─────────────────────────────────────────────────────────────────────
      // إيقاف
      // ─────────────────────────────────────────────────────────────────────

      if (sub === "ايقاف" || sub === "إيقاف" || sub === "off") {
        const data = load();

        if (data[tid]?.cavor) {
          data[tid].cavor.active = false;
          save(data);
        }

        if (state[tid]) {
          state[tid].active = false;
          state[tid].queue.length = 0;
          state[tid].generation += 1;
          destroyState(tid);
        }

        // إيقاف مراقبة الكنيات
        stopNicknameMonitor(tid);
        if (data[tid]?.nicknameMonitor) {
          delete data[tid].nicknameMonitor;
          save(data);
        }

        // إيقاف مراقبة الأسماء
        stopNameMonitor(tid);
        if (data[tid]?.nameMonitor) {
          delete data[tid].nameMonitor;
          save(data);
        }

        // إيقاف جلسات الشات
        stopAllChatSessions();

        await sendText(api, tid, "/done");

        return;
      }

      // ─────────────────────────────────────────────────────────────────────
      // شات — إدارة المجموعات عن بُعد
      // ─────────────────────────────────────────────────────────────────────

      if (sub === "شات" || sub === "chat") {
        return startChatSession(api, event, message);
      }

      // ─────────────────────────────────────────────────────────────────────
      // نيم — مراقبة اسم المجموعة
      // ─────────────────────────────────────────────────────────────────────

      if (sub === "نيم") {
        const sub2 = String(args[1] || "").toLowerCase();

        // /الوكس نيم ايقاف
        if (sub2 === "ايقاف" || sub2 === "إيقاف" || sub2 === "off") {
          stopNameMonitor(tid);

          const data = load();
          if (data[tid]?.nameMonitor) {
            delete data[tid].nameMonitor;
            save(data);
          }

          await sendText(
            api,
            tid,
            "✅ تم إيقاف مراقبة اسم المجموعة.\n" +
            "الآن يمكن تغيير الاسم بشكل حر."
          );
          return;
        }

        // /الوكس نيم [الاسم]
        const desiredName = args.slice(1).join(" ").trim();

        if (!desiredName) {
          return message.reply(
            "❌ الاستخدام: /الوكس نيم [الاسم] أو /الوكس نيم ايقاف"
          );
        }

        // تغيير الاسم فوراً
        try {
          await new Promise((resolve, reject) => {
            if (typeof api.setTitle !== "function") {
              return reject(new Error("setTitle غير متاح في FCA"));
            }
            api.setTitle(desiredName, tid, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } catch (error) {
          return sendText(
            api,
            tid,
            `❌ فشل تغيير الاسم: ${error.message}`
          );
        }

        // حفظ في Database
        const data = load();
        if (!data[tid] || typeof data[tid] !== "object") {
          data[tid] = {};
        }
        data[tid].nameMonitor = {
          active: true,
          name: desiredName,
          updatedAt: Date.now(),
        };
        save(data);

        // بدء المراقبة
        startNameMonitor(api, tid, desiredName);

        await sendText(
          api,
          tid,
          `✅ تم تغيير اسم المجموعة إلى: ${desiredName}\n` +
          `🔍 جارٍ مراقبة الاسم كل 10 ثوانٍ\n` +
          `🔄 سيتم إعادة الاسم تلقائياً عند أي تغيير`
        );
        return;
      }

      // ─────────────────────────────────────────────────────────────────────
      // كنيات — مراقبة كنيات جميع الأعضاء
      // ─────────────────────────────────────────────────────────────────────

      if (sub === "كنيات") {
        const desiredNick = args.slice(1).join(" ").trim();

        if (!desiredNick) {
          return message.reply(
            "❌ الاستخدام: /الوكس كنيات [الكنية]"
          );
        }

        try {
          const memberIDs = await getMemberIDs(api, tid);
          const botID = String(
            global.GoatBot?.botID || api?.getCurrentUserID?.() || ""
          );

          let changed = 0;
          for (const uid of memberIDs) {
            if (botID && uid === botID) continue;
            try {
              const ok = await changeOneNickname(api, tid, uid, desiredNick);
              if (ok) changed++;
            } catch (_) {}
          }

          const data = load();
          if (!data[tid] || typeof data[tid] !== "object") {
            data[tid] = {};
          }
          data[tid].nicknameMonitor = {
            active: true,
            nickname: desiredNick,
            changedCount: changed,
            updatedAt: Date.now(),
          };
          save(data);

          startNicknameMonitor(api, tid, desiredNick);

          await sendText(
            api,
            tid,
            `✅ تم تغيير كنيات ${changed} عضو إلى: ${desiredNick}\n` +
            `🔍 جارٍ مراقبة الكنيات كل ${Math.round(NICK_CHECK_MS / 1000)} ثوانٍ\n` +
            `🔄 سيتم إعادة الكنية تلقائياً عند أي تغيير`
          );

        } catch (error) {
          global.log?.warn?.(
            "NICKNAME_MONITOR",
            `خطأ في تغيير الكنيات: ${error.message}`
          );
          return sendText(
            api,
            tid,
            `❌ خطأ في تغيير الكنيات: ${error.message}`
          );
        }

        return;
      }

      // ─────────────────────────────────────────────────────────────────────
      // تنظيف — إزالة جميع الكنيات
      // ─────────────────────────────────────────────────────────────────────

      if (sub === "تنظيف") {
        stopNicknameMonitor(tid);

        const data = load();
        if (data[tid]?.nicknameMonitor) {
          delete data[tid].nicknameMonitor;
          save(data);
        }

        await sendText(
          api,
          tid,
          `🧹 جارٍ تنظيف الكنيات...\n⏱️ كل كنية تستغرق ${NICK_APPLY_DELAY_MS / 1000} ثانية`
        );

        try {
          const cleaned = await cleanNicknames(api, tid);
          await sendText(
            api,
            tid,
            `✅ تم تنظيف كنيات ${cleaned} عضو بنجاح.\n🔓 الكنيات أصبحت حرة الآن.`
          );
        } catch (error) {
          await sendText(
            api,
            tid,
            `❌ خطأ أثناء التنظيف: ${error.message}`
          );
        }

        return;
      }

      // ─────────────────────────────────────────────────────────────────────
      // تشغيل
      // ─────────────────────────────────────────────────────────────────────

      if (sub !== "تشغيل" && sub !== "on") {
        return message.reply(
          "❌ الاستخدام:\n" +
          "/الوكس تشغيل [الرسالة]\n" +
          "/الوكس ايقاف\n" +
          "/الوكس شات\n" +
          "/الوكس نيم [الاسم]\n" +
          "/الوكس كنيات [الكنية]\n" +
          "/الوكس تنظيف"
        );
      }

      const msg = args.slice(1).join(" ").trim();

      if (!msg) {
        return message.reply("❌ اكتب الرسالة بعد /الوكس تشغيل.");
      }

      const data = load();

      if (!data[tid] || typeof data[tid] !== "object") {
        data[tid] = {};
      }

      /*
       * لا نستخدم data[tid].active
       * حتى لا نكسر Angel v6.
       *
       * CAVOR له مساحة مستقلة.
       */
      data[tid].cavor = {
        active: true,
        message: msg,
        updatedAt: Date.now(),
      };

      save(data);

      destroyState(tid);

      const st = getState(tid);
      st.active = true;
      st.sentInCycle = 0;
      st.paused = false;
      st.lastHumanMessageAt = Date.now();

      /*
       * الرسالة الأولى بعد حوالي ثانية.
       */
      await sleep(1000);

      try {
        await sendText(api, tid, msg);
      } catch (error) {
        global.log?.warn?.(
          "CAVOR",
          `رسالة التشغيل فشلت: ${error.message}`
        );
      }

      /*
       * رسالة الحالة.
       */
      try {
        await sendText(
          api,
          tid,
          "يرد كل 30 ثانية\n" +
          "وإذا لم يستلم شيئاً يسجل فارق ويخرج"
        );
      } catch (_) {}

      return;
    }
  },


  // ═══════════════════════════════════════════════════════════════════════════
  // TEST API
  // ═══════════════════════════════════════════════════════════════════════════

  _test: {
    load,
    save,
    clearTimers,
    scheduleResponse,
    scheduleSilenceWatchdog,
    restoreAll,
    handleHumanMessage,
    sendEscapeAndLeave,
    startGame,
    stopGame,
    stopAllGamesForThread,
    formatUptime,
    cleanupMemory,
    startNameMonitor,
    stopNameMonitor,
    nameMonitors,
    startNicknameMonitor,
    stopNicknameMonitor,
    nicknameMonitors,
    changeOneNickname,
    getMemberIDs,
    cleanNicknames,
    chatSessions,
    cleanupChatSession,
    stopAllChatSessions,
    getThreadListFromFCA,
    executeRemoteCommand,
    startChatSession,
    RESPONSE_DELAY_MS,
    SILENCE_MS,
    MAX_RESPONSES,
    NAME_CHECK_MS,
    getRole: function(senderID) {
      const cfg = global.GoatBot?.config || {};
      const sid = String(senderID);
      const supers = [...(cfg.superAdminBot || []), cfg.ownerID].filter(Boolean).map(String);
      const admins = (cfg.adminBot || []).map(String);
      if (supers.includes(sid)) return 3;
      if (admins.includes(sid)) return 2;
      return 0;
    },
  },
};
