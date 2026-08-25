/**
 * CAVOR — Angel v6 — نظام الرسائل التلقائية الذكي
 * Copyright © 2026 Cavor
 * ✦ يتوقف مؤقتاً بعد 3 رسائل متتالية بدون رد بشري
 * ✦ يستأنف عند أول رسالة بشرية
 * ✦ يبدأ عدّاد الخروج بعد التوقف
 * ✦ يغادر بعد 16 دقيقة من الصمت
 */

"use strict";

const fs   = require("fs-extra");
const path = require("path");

const DATA = path.join(
  process.cwd(),
  "database/data/cavorData.json"
);

const SILENCE_MS = 16 * 60 * 1000;

function load() {
  try {
    if (fs.existsSync(DATA)) {
      return JSON.parse(
        fs.readFileSync(DATA, "utf8")
      );
    }
  } catch (_) {}

  return {};
}

function save(d) {
  fs.ensureDirSync(
    path.dirname(DATA)
  );

  fs.writeFileSync(
    DATA,
    JSON.stringify(d, null, 2)
  );
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}


// ── Global state ──────────────────────────────────────────────────────────────

if (!global.GoatBot)
  global.GoatBot = {};

if (!global.GoatBot.cavorIntervals)
  global.GoatBot.cavorIntervals = {};

if (!global.GoatBot.cavorSilenceTimers)
  global.GoatBot.cavorSilenceTimers = {};

if (!global._cavorState)
  global._cavorState = {};

// _cavorState[tid] = {
//   consecutive,
//   paused,
//   pausedAt,
//   lastHumanTs,
//   lastHumanMessageID,
//   leaving
// }


// ── Human-message listener ────────────────────────────────────────────────────

if (!global._msgListeners)
  global._msgListeners = [];

if (!global._cavorListenerRegistered) {

  global._cavorListenerRegistered = true;

  global._msgListeners.push(
    ({ threadID, messageID }) => {

      const tid = String(threadID);

      const st =
        global._cavorState[tid];

      if (!st)
        return;

      st.consecutive = 0;
      st.lastHumanTs = Date.now();

      if (messageID)
        st.lastHumanMessageID =
          String(messageID);

      if (st.paused) {

        st.paused = false;
        st.pausedAt = null;

        clearSilenceWatchdog(tid);

        const data = load();
        const td = data[tid];

        if (
          td?.active &&
          global.GoatBot?.fcaApi
        ) {

          scheduleNext(
            global.GoatBot.fcaApi,
            tid,
            td
          );
        }
      }

      const data = load();
      const td = data[tid];

      if (
        td?.active &&
        global.GoatBot?.fcaApi
      ) {

        scheduleSilenceWatchdog(
          global.GoatBot.fcaApi,
          tid
        );
      }
    }
  );
}


// ── Silence watchdog ──────────────────────────────────────────────────────────

function clearSilenceWatchdog(tid) {

  const timer =
    global.GoatBot
      .cavorSilenceTimers?.[tid];

  if (timer)
    clearTimeout(timer);

  if (
    global.GoatBot
      .cavorSilenceTimers
  ) {

    delete global.GoatBot
      .cavorSilenceTimers[tid];
  }
}


// ── رسالة الهروب والخروج ─────────────────────────────────────────────────────

function sendEscapeAndLeave(api, tid, st) {

  if (st.leaving)
    return Promise.resolve();

  st.leaving = true;

  clearTimeout(
    global.GoatBot
      .cavorIntervals[tid]
  );

  delete global.GoatBot
    .cavorIntervals[tid];

  clearSilenceWatchdog(tid);

  return (async () => {

    const escapeMessage =
      "هروب ابن ﭑﭑلَـڨَـ📜⍣⃟ـﹻ۪۫٘ہـ𝑯ـٰٰٰٰٖٖٖٖٖﹻ۪┇ـےـ❄️ـ┇بَِـ⥢🪽⥤ـےـٰٰٰٰٖٖٖٖٖ𝐁ـޢـٰٰٰٰٖٖٖٖٖޢـة";

    try {

      await new Promise(
        (resolve, reject) => {

          api.sendMessage(
            escapeMessage,
            tid,
            err =>
              err
                ? reject(err)
                : resolve()
          );

        }
      );

    } catch (_) {}

    await new Promise(
      resolve =>
        setTimeout(resolve, 1500)
    );

    try {

      const botID =
        String(
          api.getCurrentUserID?.() ||
          global.GoatBot?.botID ||
          ""
        );

      await new Promise(
        (resolve, reject) => {

          api.removeUserFromGroup(
            botID,
            String(tid),
            err =>
              err
                ? reject(err)
                : resolve()
          );

        }
      );

    } catch (error) {

      global.log?.warn?.(
        "CAVOR",
        `تعذر خروج البوت من ${tid}: ${error.message}`
      );

    } finally {

      const data = load();

      if (data[tid]) {

        data[tid].active = false;

        save(data);
      }

      delete global._cavorState[tid];
    }

  })();
}


// ── مراقبة فترة الصمت ────────────────────────────────────────────────────────

function scheduleSilenceWatchdog(api, tid) {

  const key = String(tid);

  clearSilenceWatchdog(key);

  const st =
    global._cavorState[key];

  if (
    !st ||
    st.leaving ||
    !st.paused
  ) {

    return;
  }

  const elapsed =
    Date.now() -
    (st.pausedAt || Date.now());

  const remaining =
    Math.max(
      0,
      SILENCE_MS - elapsed
    );

  global.GoatBot
    .cavorSilenceTimers[key] =
    setTimeout(
      async () => {

        delete global.GoatBot
          .cavorSilenceTimers[key];

        const fresh =
          load()[key];

        const current =
          global._cavorState[key];

        if (
          !fresh?.active ||
          !current ||
          current.leaving ||
          !current.paused
        ) {

          return;
        }

        if (
          Date.now() -
          (current.pausedAt || Date.now())
          <
          SILENCE_MS
        ) {

          scheduleSilenceWatchdog(
            api,
            key
          );

          return;
        }

        await sendEscapeAndLeave(
          api,
          key,
          current
        );

      },
      remaining
    );
}


// ── Core scheduler ────────────────────────────────────────────────────────────

function scheduleNext(api, tid, td) {

  clearTimeout(
    global.GoatBot
      .cavorIntervals[tid]
  );

  delete global.GoatBot
    .cavorIntervals[tid];

  if (
    !td?.active ||
    !td?.message
  ) {

    return;
  }

  if (
    !global._cavorState[tid]
  ) {

    global._cavorState[tid] = {

      consecutive: 0,

      paused: false,

      pausedAt: null,

      lastHumanTs: Date.now(),

      lastHumanMessageID: null,

      leaving: false
    };
  }

  if (
    global._cavorState[tid].paused
  ) {

    return;
  }

  const ms =
    Math.round(
      rand(
        td.minSeconds ?? 60,
        td.maxSeconds ??
          td.minSeconds ??
          60
      ) * 1000
    );

  global.GoatBot
    .cavorIntervals[tid] =
    setTimeout(
      async () => {

        delete global.GoatBot
          .cavorIntervals[tid];

        const fresh =
          load()[tid];

        if (!fresh?.active)
          return;

        const st =
          global._cavorState[tid] ||
          {};

        // ── 3 رسائل متتالية ────────────────────────────────────────────────

        if (
          (st.consecutive || 0) >= 3
        ) {

          st.paused = true;
          st.pausedAt = Date.now();

          global._cavorState[tid] =
            st;

          scheduleSilenceWatchdog(
            api,
            tid
          );

          return;
        }

        // ── إرسال الرسالة ──────────────────────────────────────────────────

        try {

          const delay =
            global.utils
              ?.calcHumanTypingDelay
              ?.(
                fresh.message
              ) || 1500;

          await global.utils
            ?.simulateTyping
            ?.(
              api,
              tid,
              delay
            );

          await api.sendMessage(
            fresh.message,
            tid
          );

          st.consecutive =
            (st.consecutive || 0) + 1;

          global._cavorState[tid] =
            st;

        } catch (_) {}

        const next =
          load()[tid];

        if (!next?.active)
          return;

        // بعد الرسالة الثالثة
        if (
          (st.consecutive || 0) >= 3
        ) {

          st.paused = true;
          st.pausedAt = Date.now();

          global._cavorState[tid] =
            st;

          scheduleSilenceWatchdog(
            api,
            tid
          );

          return;
        }

        scheduleNext(
          api,
          tid,
          next
        );

      },
      ms
    );
}


// ── Session restore ───────────────────────────────────────────────────────────

function restoreAll(api) {

  if (
    global.GoatBot
      ._cavorRestored
  ) {

    return;
  }

  global.GoatBot
    ._cavorRestored = true;

  const data = load();

  for (
    const [tid, td]
    of Object.entries(data)
  ) {

    if (
      td.active &&
      td.message
    ) {

      if (
        !global._cavorState[tid]
      ) {

        global._cavorState[tid] = {

          consecutive: 0,

          paused: false,

          pausedAt: null,

          lastHumanTs: Date.now(),

          lastHumanMessageID: null,

          leaving: false
        };
      }

      scheduleNext(
        api,
        tid,
        td
      );

      if (
        global._cavorState[tid]
          .paused
      ) {

        scheduleSilenceWatchdog(
          api,
          tid
        );
      }
    }
  }
}


// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {

  config: {

    name: "angel",

    aliases: [
      "ang"
    ],

    version: "6.0",

    author: "Cavor",

    countDown: 3,

    role: 2,

    category: "management",

    description:
      "Cavor-Xv3-11/x — رسائل تلقائية مع مراقبة ذكية",

    guide: {
      en:
        "{pn} [رسالة] [min] [max] — تشغيل\n" +
        "{pn} off — إيقاف\n" +
        "{pn} status — الحالة"
    }
  },


  onStart: async function({
    api,
    event,
    args,
    message
  }) {

    const tid =
      event.threadID;

    restoreAll(api);

    const data =
      load();

    const sub =
      (args[0] || "")
        .toLowerCase();


    // ── الحالة ───────────────────────────────────────────────────────────────

    if (
      !sub ||
      sub === "status" ||
      sub === "حالة"
    ) {

      const td =
        data[tid];

      if (!td?.active) {

        return message.reply(
          "🌙 CAVOR غير نشط في هذا الغروب."
        );
      }

      const st =
        global._cavorState[tid] ||
        {};

      const mode =
        st.paused
          ? "⏸️ متوقف مؤقتاً — بانتظار رد"
          : "🟢 يعمل بشكل طبيعي";

      return message.reply(

        "╭─〔 ⚡ CAVOR 〕─╮\n" +

        `📍 الحالة: ${mode}\n` +

        `💬 المحتوى: ${td.message}\n` +

        `⏳ الفاصل: ${td.minSeconds}–${td.maxSeconds} ثانية\n` +

        `📨 المتتالي: ${st.consecutive || 0}/3\n\n` +

        "👑 المطور: Cavor\n" +

        "╰────────────────╯"

      );
    }


    // ── إيقاف ───────────────────────────────────────────────────────────────

    if (
      sub === "off" ||
      sub === "ايقاف" ||
      sub === "إيقاف"
    ) {

      clearTimeout(
        global.GoatBot
          .cavorIntervals[tid]
      );

      delete global.GoatBot
        .cavorIntervals[tid];

      clearSilenceWatchdog(tid);

      delete global._cavorState[tid];

      if (data[tid]) {

        data[tid].active =
          false;

        save(data);
      }

      return message.reply(

        "🛑 تم تعطيل CAVOR في هذا الغروب.\n" +
        "⚙️ يمكنك تشغيله من جديد متى شئت.\n" +
        "👑 Cavor"

      );
    }


    // ── قراءة الرسالة والوقت ────────────────────────────────────────────────

    const nums =
      args.filter(
        a =>
          /^\d+$/.test(a)
      );

    const textParts =
      args.filter(
        a =>
          !/^\d+$/.test(a) &&
          a.toLowerCase() !== "on"
      );

    const msg =
      textParts
        .join(" ")
        .trim() ||
      data[tid]?.message ||
      "⚡ CAVOR هنا.";

    const minS =
      parseInt(nums[0]) || 60;

    const maxS =
      Math.max(
        parseInt(nums[1]) || minS,
        minS
      );


    // ── حفظ الإعدادات ──────────────────────────────────────────────────────

    data[tid] = {

      active: true,

      message: msg,

      minSeconds: minS,

      maxSeconds: maxS
    };

    save(data);


    // ── تهيئة الحالة ───────────────────────────────────────────────────────

    global._cavorState[tid] = {

      consecutive: 0,

      paused: false,

      pausedAt: null,

      lastHumanTs: Date.now(),

      lastHumanMessageID: null,

      leaving: false
    };


    scheduleNext(
      api,
      tid,
      data[tid]
    );

    scheduleSilenceWatchdog(
      api,
      tid
    );


    return message.reply(

      "╭─〔 ⚡ CAVOR 〕─╮\n" +

      "✅ تم تشغيل النظام بنجاح\n\n" +

      `📝 الرسالة: ${msg}\n` +

      `⏱️ الفاصل: ${minS}–${maxS} ثانية\n\n` +

      "🧠 بعد 3 رسائل متتابعة يتوقف مؤقتاً\n" +

      "💬 يعود للعمل عند وصول رسالة بشرية\n" +

      "🌘 بعد 16 دقيقة من الصمت يرسل رسالة الهروب ويغادر\n\n" +

      "👑 Cavor\n" +

      "╰────────────────╯"

    );
  },


  _test: {

    sendEscapeAndLeave,

    scheduleNext,

    scheduleSilenceWatchdog,

    clearSilenceWatchdog,

    SILENCE_MS
  }
};
