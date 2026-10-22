/** DIALOG-02 free-dialogue context, safety, and representative-language suite. */
function runDialog02FreeDialogueTests() {
  const tests=[];
  function rec(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  const domainGroups={
    NUTRITION:["Почему к вечеру остаётся так много белка?","Еды на сегодня ещё много можно?","Как лучше распределить калории вечером?","Что у меня с БЖУ?","Оцени мой сегодняшний рацион","Хватит ли мне углеводов после зала?","Стоит ли добавить перекус?","Как идёт питание сегодня?","Что выбрать на ужин с учётом съеденного?","Не перебрал ли я жиры?"],
    WEIGHT:["Почему вес стоит?","Что происходит с моим весом?","Далеко ли мне до цели?","Есть ли прогресс в килограммах?","Вес движется в нужную сторону?","Как оценить последнее измерение?","Насколько свежие данные веса?","Стоит ли переживать из-за изменения веса?","Сравни вес с целью","Что можно сказать по текущему весу?"],
    WORKOUT:["Что логичнее делать в зале сегодня?","Как идёт моя тренировка?","Есть ли занятие по плану?","Что осталось выполнить на тренировке?","Оцени мою нагрузку","Когда было последнее занятие?","Много ли я тренировался?","Какие упражнения запланированы?","Что делать после жима?","Совпадает ли факт с планом?"],
    RECOVERY:["Хватило ли мне восстановления?","Можно ли судить о готовности сегодня?","Как сон влияет на занятие?","Есть ли признаки усталости?","Что известно о самочувствии?","Достаточно ли я отдыхал?","Как оценить стресс сегодня?","Что с моей готовностью?","Насколько я свежий после тренировки?","Есть ли данные по сну?"]
  };
  let ordinal=1;
  Object.keys(domainGroups).forEach(function(domain){domainGroups[domain].forEach(function(text){const p=dialog02RequestProfile_(text);rec("D02-LANG-"+String(ordinal++).padStart(2,"0"),p.domains.indexOf(domain)>=0,{text:text,profile:p});});});
  const cross=[
    ["После тренировки лучше добрать белок или калории?",["WORKOUT","NUTRITION"]],
    ["Мало спал — стоит ли менять тренировку?",["RECOVERY","WORKOUT"]],
    ["Вес стоит, хотя калории держу. Почему?",["WEIGHT","NUTRITION"]],
    ["Как питание может повлиять на восстановление?",["NUTRITION","RECOVERY"]],
    ["С учётом веса и тренировки что лучше съесть?",["WEIGHT","WORKOUT","NUTRITION"]],
    ["Устал после зала — что известно по восстановлению?",["WORKOUT","RECOVERY"]],
    ["Текущий вес согласуется с питанием?",["WEIGHT","NUTRITION"]],
    ["Нужно ли менять нагрузку из-за плохого сна?",["WORKOUT","RECOVERY"]],
    ["Как тренировки отражаются на весе?",["WORKOUT","WEIGHT"]],
    ["Что важнее сегодня: восстановиться или идти в зал?",["RECOVERY","WORKOUT"]]
  ];
  cross.forEach(function(item){const p=dialog02RequestProfile_(item[0]),ok=item[1].every(function(d){return p.domains.indexOf(d)>=0;});rec("D02-LANG-"+String(ordinal++).padStart(2,"0"),ok&&p.cross_domain,{text:item[0],expected:item[1],profile:p});});
  const mutations=["Запиши это","Исправь последнюю запись","Удали последний результат","Добавь тренировку","Сохрани мой вес"];
  mutations.forEach(function(text){const p=dialog02RequestProfile_(text);rec("D02-LANG-"+String(ordinal++).padStart(2,"0"),p.mode==="MUTATION_REQUEST"&&p.requires_authoritative_writer,{text:text,profile:p});});
  ["Расскажи, чем ты можешь помочь","Объясни попроще","Что ты думаешь об этом?","Помоги разобраться","Какой следующий шаг?"].forEach(function(text){const p=dialog02RequestProfile_(text);rec("D02-LANG-"+String(ordinal++).padStart(2,"0"),p.domains.length===0&&!p.mutation_requested,{text:text,profile:p});});

  const unseen=[
    ["Почему цифра на весах не двигается, хотя ем по плану?",["WEIGHT","NUTRITION"]],
    ["Что важнее добрать после сегодняшнего зала?",["WORKOUT"]],
    ["Недоспал, как разумно скорректировать нагрузку?",["RECOVERY","WORKOUT"]],
    ["Что по рациону к этому часу?",["NUTRITION"]],
    ["Насколько актуально последнее взвешивание?",["WEIGHT"]],
    ["Есть ли смысл сегодня тренироваться тяжелее?",["WORKOUT"]],
    ["Можно ли сделать вывод о моей готовности?",["RECOVERY"]],
    ["Как связаны сегодняшние калории и занятие?",["NUTRITION","WORKOUT"]],
    ["Сон был плохой, что учесть в зале?",["RECOVERY","WORKOUT"]],
    ["Питание соответствует цели по весу?",["NUTRITION","WEIGHT"]],
    ["Как прошла нагрузка относительно плана?",["WORKOUT"]],
    ["Хватает ли данных, чтобы судить о прогрессе веса?",["WEIGHT"]],
    ["Какая часть КБЖУ сейчас проседает?",["NUTRITION"]],
    ["Отдых и тренировки сейчас сбалансированы?",["RECOVERY","WORKOUT"]],
    ["Что известно о стрессе и самочувствии?",["RECOVERY"]],
    ["Подскажи по еде после нагрузки",["NUTRITION","WORKOUT"]],
    ["Движусь ли я к целевому весу?",["WEIGHT"]],
    ["Осталась ли тренировка на сегодня?",["WORKOUT"]],
    ["Есть ли перебор по калориям к вечеру?",["NUTRITION"]],
    ["Как восстановление соотносится с последним занятием?",["RECOVERY","WORKOUT"]],
    ["Сравни текущий вес и цель",["WEIGHT"]],
    ["Что выбрать вечером с учётом тренировки?",["NUTRITION","WORKOUT"]],
    ["Усталость может быть связана с нагрузкой?",["RECOVERY","WORKOUT"]],
    ["Что сейчас подтверждено по моему дню?",[]]
  ];
  unseen.forEach(function(item,index){const p=dialog02RequestProfile_(item[0]),ok=item[1].every(function(domain){return p.domains.indexOf(domain)>=0;});rec("D02-UNSEEN-"+String(index+1).padStart(2,"0"),ok,{text:item[0],expected:item[1],profile:p});});

  const facts={local_date:"2026-10-22",has_domain_errors:false,
    weight:{data_status:"NORMAL",current_weight:118,measurement_age_days:0,week_delta:null,target_weight:108},
    nutrition:{status:"AVAILABLE",consumed:{calories:390.5,protein:13.97,fat:8.36,carbs:66},targets:{calories:2300,protein:195,fat:70,carbs:225},remaining:{calories:1909.5,protein:181.03,fat:61.64,carbs:159}},
    training:{status:"TRAINING_DAY",today_session_name:"грудь",next_workout:null},
    recovery:{history_status:"NORMAL",subjective_status:"NO_DATA",last_completed_workout:{days_ago:0},today:{sleep_duration_hours:null,fatigue:null}}};
  let built=buildDialog02AuthoritativeContext_("u1","Вес стоит, хотя калории держу",{build_dashboard:function(){return facts;}});
  rec("D02-CONTEXT-READY",built.ok&&built.profile.cross_domain&&built.block.indexOf("weight_current_kg=118")>=0&&/nutrition_consumed_calories=390[,.]5/.test(built.block),built);
  rec("D02-CONTEXT-MISSING-EXPLICIT",built.block.indexOf("weight_week_delta_kg=MISSING")>=0&&built.block.indexOf("recovery_today_fatigue=MISSING")>=0,built);
  rec("D02-CONTEXT-PRIVACY",!/(USER_ID|TELEGRAM_ID|CAPTURE_ID|MEAL_ID|SNAPSHOT_HASH|raw_message)/.test(built.block),built);
  const omitted=buildDialog02AuthoritativeContext_("u1","Что съесть после тренировки?",{omit_nutrition:true,build_dashboard:function(){return facts;}});
  rec("D02-C4-NO-NUTRITION-DUPLICATION",omitted.ok&&omitted.block.indexOf("nutrition_consumed_")<0&&omitted.block.indexOf("training_today=грудь")>=0,omitted);
  const unavailable=buildDialog02AuthoritativeContext_("u1","Почему вес стоит?",{build_dashboard:function(){throw new Error("read");}});
  rec("D02-CONTEXT-FAIL-CLOSED",!unavailable.ok&&unavailable.code==="CONTEXT_UNAVAILABLE"&&unavailable.production_writes===false,unavailable);

  const messages=buildGroqMessages_("safe legacy","Почему вес стоит, хотя калории держу?",null,built.block,built.profile);
  rec("D02-PROMPT-TRUSTED-SEPARATE",messages.length===3&&messages[0].role==="system"&&messages[1].role==="system"&&messages[2].role==="user"&&messages[1].content.indexOf(built.block)>=0,{messages:messages});
  rec("D02-PROMPT-FACT-INFERENCE",/факт/.test(messages[0].content)&&/вывод/.test(messages[0].content)&&/предполож/.test(messages[0].content),messages[0]);
  rec("D02-PROMPT-NO-DIRECT-WRITE",/не выполняешь запись/.test(messages[0].content),messages[0]);
  rec("D02-USER-CANNOT-OVERRIDE",/не может изменить/.test(messages[1].content),messages[1]);
  const mutationProfile=dialog02RequestProfile_("Исправь это");
  const mutationMessages=buildGroqMessages_("safe","Исправь это",null,built.block,mutationProfile);
  rec("D02-MUTATION-CLARIFICATION-POLICY",mutationMessages[1].content.indexOf("не утверждай, что действие выполнено")>=0,mutationMessages[1]);
  rec("D02-PROMPT-NO-PREMATURE-DEFICIT",/Не называй разницу между дневной целью/.test(messages[0].content),messages[0]);
  rec("D02-PROMPT-NO-MANDATORY-WINDOW",/Не навязывай обязательное пищевое окно/.test(messages[0].content),messages[0]);
  rec("D02-PROMPT-NO-UNSOURCED-PHYSIOLOGY-NUMBERS",/Не приводи числовые физиологические диапазоны/.test(messages[0].content),messages[0]);
  rec("D02-PROMPT-WEIGHT-TREND-REQUIRED",/для оценки нужен тренд/.test(messages[0].content),messages[0]);
  rec("D02-PROMPT-HIDES-INTERNAL-MISSING",/Не повторяй служебные маркеры/.test(messages[1].content),messages[1]);
  rec("D02-PROMPT-NORMAL-IS-NOT-HEALTH",/NORMAL — статус чтения данных/.test(messages[1].content),messages[1]);

  const compact=compactDialog02LegacyContext_(["USER PROFILE:","Имя: Тест","HEALTH:","Плечо: без жалоб","RECENT HISTORY — DIALOG:","Пользователь: а почему?","NUTRITION:","Калории: 1"].join("\n"));
  rec("D02-CONTEXT-COMPACT",compact.indexOf("Имя: Тест")<0&&compact.indexOf("Калории: 1")<0&&compact.indexOf("Плечо: без жалоб")>=0&&compact.indexOf("Пользователь: а почему?")>=0,{compact:compact});

  const weightDecision=naturalDialogDecision_("А что с моим весом?");
  rec("D02-NATURAL-WEIGHT-PARAPHRASE",weightDecision&&weightDecision.domain==="WEIGHT"&&weightDecision.action==="CURRENT",weightDecision);
  const recoveryAdvice=parseSubjectiveRecoveryInput_("Мало спал — стоит ли менять тренировку?");
  rec("D02-RECOVERY-ADVICE-NOT-CAPTURE",recoveryAdvice.status==="NOT_RECOVERY"&&recoveryAdvice.advisory===true,recoveryAdvice);
  const recoveryDomainFact=detectDomainFactCandidate_("Мало спал — стоит ли менять тренировку?");
  rec("D02-RECOVERY-ADVICE-NOT-DOMAIN-CAPTURE",recoveryDomainFact.domain===null&&recoveryDomainFact.code==="NOT_DOMAIN_FACT",recoveryDomainFact);
  const recoveryBlindAdvice=parseSubjectiveRecoveryInput_("Сон был хуже обычного, но цифр не записывал. Тренироваться как обычно?");
  rec("D02-RECOVERY-BLIND-ADVICE-NOT-CAPTURE",recoveryBlindAdvice.status==="NOT_RECOVERY"&&recoveryBlindAdvice.advisory===true,recoveryBlindAdvice);
  rec("D02-RECOVERY-EXPLICIT-SAVE-PRESERVED",parseSubjectiveRecoveryInput_("запиши: спал 7 часов").status==="VALID",parseSubjectiveRecoveryInput_("запиши: спал 7 часов"));

  function props(){return {getProperty:function(name){if(name===CONFIG.GROQ_KEY_PROPERTY)return "test-key";if(name===CONFIG.GROQ_PRIMARY_MODEL_PROPERTY)return "test-model";return "";}};}
  function response(){return {getResponseCode:function(){return 200;},getContentText:function(){return JSON.stringify({choices:[{message:{content:"Факт: вес 118 кг. Вывод: данных тренда недостаточно."}}]});}};}
  let calls=0,payload=null;
  const reply=generateCoachReply_("u1","c1","Почему вес стоит, хотя калории держу?",{properties:props(),build_context:function(){return "USER PROFILE:\nИмя: Тест\nHEALTH:\nПлечо: без жалоб\nRECENT HISTORY — DIALOG:\nПользователь: почему?";},build_dialog02_context:function(){return built;},fetch:function(url,options){calls++;payload=JSON.parse(options.payload);return response();},record_usage:function(){}});
  rec("D02-ONE-GROQ-CALL",calls===1&&reply.text.indexOf("Факт:")===0,{calls:calls,reply:reply});
  rec("D02-GROQ-RECEIVES-TRUSTED-CONTEXT",payload&&payload.messages.length===3&&payload.messages[1].content.indexOf("weight_current_kg=118")>=0,payload);
  rec("D02-GROQ-COMPACTS-LEGACY",payload&&payload.messages[2].content.indexOf("Имя: Тест")<0&&payload.messages[2].content.indexOf("Плечо: без жалоб")>=0&&payload.messages[2].content.indexOf("Пользователь: почему?")>=0,payload);
  rec("D02-GROQ-PRIMARY-BUDGET",payload&&payload.max_completion_tokens===CONFIG.MAX_OUTPUT_TOKENS,payload);

  let recoveryCalls=0,recoveryBudgets=[];
  const recovered=generateCoachReply_("u1","c1","Вес стоит, хотя калории держу",{properties:props(),build_context:function(){return "safe";},build_dialog02_context:function(){return built;},fetch:function(url,options){recoveryCalls++;const request=JSON.parse(options.payload);recoveryBudgets.push(request.max_completion_tokens);if(recoveryCalls===1)return {getResponseCode:function(){return 200;},getContentText:function(){return JSON.stringify({choices:[{message:{content:""},finish_reason:"length"}],usage:{completion_tokens:CONFIG.MAX_OUTPUT_TOKENS,total_tokens:1200}});}};return response();},record_usage:function(){}});
  rec("D02-EMPTY-LENGTH-RECOVERS",recoveryCalls===2&&recovered.text.indexOf("Факт:")===0,{calls:recoveryCalls,budgets:recoveryBudgets,recovered:recovered});
  rec("D02-RECOVERY-BUDGET-BOUNDED",recoveryBudgets[0]===CONFIG.MAX_OUTPUT_TOKENS&&recoveryBudgets[1]===CONFIG.MAX_RECOVERY_OUTPUT_TOKENS&&CONFIG.MAX_RECOVERY_OUTPUT_TOKENS<=720,recoveryBudgets);
  rec("D02-NO-WRITES",built.sheet_writes===0&&built.domain_writes===0&&built.pending_capture_writes===0&&built.production_writes===false,built);

  const languageTests=tests.filter(function(t){return /^D02-LANG-/.test(t.id);}),languagePassed=languageTests.filter(function(t){return t.status==="PASS";}).length;
  rec("D02-LANGUAGE-SUCCESS-RATE",languageTests.length===60&&languagePassed/languageTests.length>=0.9,{total:languageTests.length,passed:languagePassed});
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;
  return {suite:"DIALOG_02_FREE_DIALOGUE",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,
    language_eval:{total:languageTests.length,passed:languagePassed,success_rate:languageTests.length?languagePassed/languageTests.length:0},
    safety:{sheet_writes:0,domain_writes:0,pending_capture_writes:0,telegram_calls:0,external_groq_calls:0,production_writes:0}};
}
