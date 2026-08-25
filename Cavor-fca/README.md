# CAVOR-FCA v1.0 — CAVOR

مكتبة Facebook Client Abstractions لبوت Cavor-Xv3-11/x.

---

## الميزات

| الميزة | الوصف |
|--------|-------|
| 🍪 Cookie Parser | يدعم 5 صيغ: JSON Array, c3c, Netscape, Header String, Object |
| ✅ Session Validator | فحص الكوكيز مباشرة عبر mbasic.facebook.com |
| 🤖 Human Behavior | تأخير typing بشري، تدوير User-Agent |
| 📦 Thread Cache | تخزين مؤقت لمعلومات المجموعات |
| 📸 Media Helpers | إرسال صور/فيديوهات/صوت من URL مباشرة |
| 🌐 Cobalt Download | تنزيل من TikTok/Instagram/YouTube/Twitter بـ API مجاني |

---

## الاستخدام — Media Helpers

```js
const { sendPhoto, sendVideo, sendAudio, sendFromSocial, cobaltDownload } = require("./Cavor-fca/lib/media");

// ── إرسال صورة من رابط ──
await sendPhoto(api, "https://example.com/image.jpg", "وصف الصورة", event.threadID);

// ── إرسال فيديو من رابط ──
await sendVideo(api, "https://example.com/video.mp4", "عنوان الفيديو", event.threadID);

// ── إرسال صوت/موسيقى ──
await sendAudio(api, "https://example.com/song.mp3", "اسم الأغنية", event.threadID);

// ── إرسال عدة صور دفعة واحدة (max 6) ──
const { sendMultiPhoto } = require("./Cavor-fca/lib/media");
await sendMultiPhoto(api, [url1, url2, url3], "صور متعددة", event.threadID);

// ── تنزيل من TikTok/Instagram/YouTube وإرساله مباشرة ──
await sendFromSocial(api, "https://www.tiktok.com/@user/video/xxx", "عنوان الفيديو", event.threadID);

// ── فقط الصوت (MP3) من يوتيوب ──
await sendFromSocial(api, "https://youtu.be/xxx", "اسم الأغنية", event.threadID, { audioOnly: true });

// ── الحصول على رابط مباشر فقط ──
const directUrl = await cobaltDownload("https://www.instagram.com/reel/xxx");
```

أو عبر `api.cavor` مباشرة في الأوامر:

```js
// متوفر تلقائياً بعد تسجيل الدخول عبر Cavor-fca
await api.cavor.sendPhoto(url, caption, event.threadID);
await api.cavor.sendVideo(url, caption, event.threadID);
await api.cavor.sendAudio(url, caption, event.threadID);
await api.cavor.sendFromSocial(url, caption, event.threadID);
await api.cavor.sendMultiPhoto([url1, url2], caption, event.threadID);
await api.cavor.cobaltDownload(url); // يرجع رابط مباشر
```

---

## باقي الـ API (login, cookies, session)

```js
const cavorFca = require("./Cavor-fca");

cavorFca(appState, opts, (err, api, info) => {
  if (err) throw err;
  // api جاهز للاستخدام مع كل ميزات @dongdev/fca-unofficial
  // + api.cavor للميزات المضافة
});
```

---

## الإصدارات

| الإصدار | الجديد |
|---------|--------|
| v4.0 | إضافة Media Helpers: sendPhoto, sendVideo, sendAudio, sendMultiPhoto, cobaltDownload, sendFromSocial |
| v3.0 | النسخة الأصلية: login, cookies, session, typing |
