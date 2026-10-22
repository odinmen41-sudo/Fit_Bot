/** UX-01 unified Telegram presentation and coach-voice contract. */
function runUX01TelegramExperienceTests() {
  const tests = [];
  function record(id, pass, details) {
    tests.push({id:id, status:pass ? "PASS" : "FAIL", details:pass ? {} : details || {}});
  }

  let rendered = renderTelegramMessage_("Сегодня:\nСъедено: 569 ккал\nЦель: 2300 ккал\nОсталось: 1731 ккал");
  record("UX01-HTML-MODE", rendered.parse_mode === "HTML", rendered);
  record("UX01-SUMMARY-HEADINGS", rendered.text.indexOf("<b>Сегодня:</b>") === 0 &&
    rendered.text.indexOf("<b>Съедено:</b>") >= 0 && rendered.text.indexOf("<b>Осталось:</b>") >= 0, rendered);

  rendered = renderTelegramMessage_("**Факт:** вес 118 кг.\n**Вывод:** для тренда нужно больше измерений.");
  record("UX01-AI-BOLD", rendered.text === "<b>Факт:</b> вес 118 кг.\n<b>Вывод:</b> для тренда нужно больше измерений.", rendered);

  rendered = renderTelegramMessage_("Рыба < 200 г & овощи > 100 г");
  record("UX01-UNTRUSTED-HTML-ESCAPED", rendered.text === "Рыба &lt; 200 г &amp; овощи &gt; 100 г", rendered);

  rendered = renderTelegramMessage_("Итого:\n569 ккал\n\n\nСохранить? Да / Нет");
  record("UX01-COMPACT-WHITESPACE", rendered.text.indexOf("\n\n\n") < 0, rendered);
  record("UX01-CONFIRMATION-ACTION", rendered.text.indexOf("<b>Сохранить?</b>\nОтветь: Да или Нет.") >= 0, rendered);

  rendered = renderTelegramMessage_("  Уточни одно значение.  \n");
  record("UX01-TRIM", rendered.text === "Уточни одно значение.", rendered);

  const messages = buildGroqMessages_("safe", "Как у меня дела?", null, null, null);
  const prompt = messages[0].content;
  record("UX01-VOICE-FRIENDLY-COACH", /дружелюбный компетентный тренер/.test(prompt), prompt);
  record("UX01-VOICE-TY", /на «ты»/.test(prompt), prompt);
  record("UX01-RESULT-FIRST", /Сначала дай результат или главный вывод/.test(prompt), prompt);
  record("UX01-ONE-USEFUL-NOTE", /одно полезное замечание или следующий шаг/.test(prompt), prompt);
  record("UX01-NO-SHAME", /Не стыди/.test(prompt), prompt);
  record("UX01-SPECIFIC-PRAISE", /Хвали только за конкретный подтверждённый результат/.test(prompt), prompt);
  record("UX01-ADAPTIVE-LENGTH", /Длину подбирай по задаче/.test(prompt), prompt);
  record("UX01-MOBILE-PARAGRAPHS", /короткие абзацы/.test(prompt), prompt);
  record("UX01-MODERATE-EMOJI", /не более одного/.test(prompt), prompt);
  record("UX01-FACT-INFERENCE-PRESERVED", /подтверждённое называй фактом/.test(prompt) && /предположением/.test(prompt), prompt);
  record("UX01-NO-FALSE-WRITE-SUCCESS", /не выполняешь запись/.test(prompt), prompt);

  let requestPayload = null;
  const originalPropertiesService = typeof PropertiesService === "undefined" ? null : PropertiesService;
  const originalUrlFetchApp = typeof UrlFetchApp === "undefined" ? null : UrlFetchApp;
  try {
    PropertiesService = {getScriptProperties:function(){return {getProperty:function(){return "token";}};}};
    UrlFetchApp = {fetch:function(url, options){requestPayload = JSON.parse(options.payload);return {
      getResponseCode:function(){return 200;}, getContentText:function(){return '{"ok":true}';}
    };}};
    sendTelegramMessage_("chat", "Факт: 118 кг & подтверждено", {reply_markup:{inline_keyboard:[]}});
    record("UX01-SEND-NATIVE-FORMATTING", requestPayload && requestPayload.parse_mode === "HTML" &&
      requestPayload.text.indexOf("<b>Факт:</b>") === 0, requestPayload);
    record("UX01-SEND-SAFE-ESCAPING", requestPayload && requestPayload.text.indexOf("&amp;") >= 0, requestPayload);
    record("UX01-REPLY-MARKUP-PRESERVED", requestPayload && requestPayload.reply_markup &&
      Array.isArray(requestPayload.reply_markup.inline_keyboard), requestPayload);
  } finally {
    if (originalPropertiesService === null) delete PropertiesService; else PropertiesService = originalPropertiesService;
    if (originalUrlFetchApp === null) delete UrlFetchApp; else UrlFetchApp = originalUrlFetchApp;
  }

  const passed = tests.filter(function(test){return test.status === "PASS";}).length;
  return {suite:"UX_01_TELEGRAM_EXPERIENCE", status:passed === tests.length ? "PASS" : "FAIL",
    total:tests.length, passed:passed, failed:tests.length-passed, tests:tests,
    safety:{domain_writes:0, sheet_writes:0, telegram_calls:0, external_groq_calls:0, production_writes:0}};
}
