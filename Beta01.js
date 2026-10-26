/* BETA-01 — invitation access, progressive onboarding, voice input and feedback. */
const BETA01 = Object.freeze({
  INVITES_SHEET:"BETA_INVITES", USERS_SHEET:"BETA_USERS", FEEDBACK_SHEET:"BETA_FEEDBACK",
  EVENTS_SHEET:"BETA_EVENTS", REQUESTS_SHEET:"BETA_DATA_REQUESTS", DELETION_AUDIT_SHEET:"BETA_DELETION_AUDIT", CONSENT_VERSION:"beta-01-v2",
  INVITE_TTL_DAYS:14, MAX_TRANSCRIPT_CHARS:1200
});

const BETA01_SCHEMAS = Object.freeze({
  BETA_INVITES:Object.freeze(["INVITE_HASH","STATUS","CREATED_AT","EXPIRES_AT","MAX_USES","USES","CREATED_BY","ACTIVATED_USER_ID","ACTIVATED_AT","REVOKED_AT"]),
  BETA_USERS:Object.freeze(["TELEGRAM_ID","STATUS","ACCESS_SOURCE","ONBOARDING_STATUS","CONSENT_VERSION","CONSENT_AT","OPTIONAL_IMPROVEMENT_CONSENT","STATE_JSON","CREATED_AT","UPDATED_AT"]),
  BETA_FEEDBACK:Object.freeze(["EVENT_ID","TELEGRAM_ID","CREATED_AT","CATEGORY","MESSAGE","STATUS"]),
  BETA_EVENTS:Object.freeze(["EVENT_ID","USER_KEY","CREATED_AT","EVENT_TYPE","SUCCESS","METADATA_JSON"]),
  BETA_DATA_REQUESTS:Object.freeze(["REQUEST_ID","TELEGRAM_ID","CREATED_AT","REQUEST_TYPE","STATUS","CONFIRMED_AT","COMPLETED_AT"]),
  BETA_DELETION_AUDIT:Object.freeze(["REQUEST_ID","SUBJECT_KEY","STARTED_AT","COMPLETED_AT","STATUS","COUNTS_JSON","ERROR_CODE"])
});

function beta01Normalize_(value){return String(value==null?"":value).toLowerCase().replace(/ё/g,"е").replace(/[.,!?;:«»"'`()\[\]{}]+/g," ").replace(/\s+/g," ").trim();}
function beta01Result_(handled,ok,code,extra){return Object.assign({handled:handled===true,ok:ok===true,code:String(code||""),authorized:false,sheet_writes:0,production_writes:false},extra||{});}
function beta01Property_(deps,key){try{return String(deps.properties.getProperty(key)||"").trim();}catch(e){return "";}}
function beta01Enabled_(deps){const env=beta01Property_(deps,"DEPLOYMENT_ENV").toUpperCase();return env==="BETA"||beta01Property_(deps,"BETA_ACCESS_ENABLED").toLowerCase()==="true";}
function beta01ConstantTimeEqual_(left,right){const a=String(left||""),b=String(right||"");let diff=a.length^b.length,max=Math.max(a.length,b.length);for(let i=0;i<max;i+=1)diff|=(a.charCodeAt(i%Math.max(1,a.length))||0)^(b.charCodeAt(i%Math.max(1,b.length))||0);return diff===0;}
function validateBeta01Webhook_(event,options){try{const deps=beta01Dependencies_(options&&options.dependencies),env=beta01Property_(deps,"DEPLOYMENT_ENV").toUpperCase();if(env!=="BETA")return {ok:true,code:"NOT_BETA"};const expected=beta01Property_(deps,"BETA_WEBHOOK_SECRET"),actual=event&&event.parameter&&event.parameter.webhook_secret;if(!expected)return {ok:false,code:"WEBHOOK_SECRET_MISSING"};return beta01ConstantTimeEqual_(expected,actual)?{ok:true,code:"WEBHOOK_VERIFIED"}:{ok:false,code:"WEBHOOK_REJECTED"};}catch(e){return {ok:false,code:"WEBHOOK_CHECK_FAILED"};}}
function beta01Sha256_(value,deps){const raw=String(value||"");if(deps&&typeof deps.sha256==="function")return deps.sha256(raw);const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw,Utilities.Charset.UTF_8);return bytes.map(function(b){const n=b<0?b+256:b;return ("0"+n.toString(16)).slice(-2);}).join("");}
function beta01UserKey_(telegramId,deps){const salt=beta01Property_(deps,"BETA_ANALYTICS_SALT");return beta01Sha256_(salt+"|"+String(telegramId||""),deps).slice(0,20);}
function beta01DeletionTombstoneKey_(telegramId,deps){return "BETA_DELETED_"+beta01UserKey_(telegramId,deps).toUpperCase();}
function beta01DeletionTombstoned_(telegramId,deps){return !!beta01Property_(deps,beta01DeletionTombstoneKey_(telegramId,deps));}
function beta01DeletionTombstone_(telegramId,deps){return beta01Json_(beta01Property_(deps,beta01DeletionTombstoneKey_(telegramId,deps)),{});}
function beta01Json_(value,fallback){try{return JSON.parse(String(value||""));}catch(e){return fallback;}}
function beta01Iso_(date){return (date instanceof Date?date:new Date(date)).toISOString();}
function beta01ParticipantLimit_(deps){return Math.min(5,Math.max(1,Number(beta01Property_(deps,"BETA_PARTICIPANT_LIMIT")||1)));}
function beta01WithLock_(deps,action){const lock=deps&&deps.lock;let acquired=false;try{if(lock&&typeof lock.waitLock==="function"){lock.waitLock(10000);acquired=true;}return action();}finally{if(acquired&&lock&&typeof lock.releaseLock==="function")lock.releaseLock();}}

function beta01ReadTable_(sheetName,deps){
  const schema=BETA01_SCHEMAS[sheetName];if(!schema)throw new Error("BETA01_UNKNOWN_TABLE");
  const sheet=deps.spreadsheet.getSheetByName(sheetName);if(!sheet)return {ok:false,code:"SHEET_MISSING",headers:schema.slice(),rows:[]};
  const lastRow=sheet.getLastRow(),lastColumn=sheet.getLastColumn();if(lastRow<1||lastColumn!==schema.length)return {ok:false,code:"SCHEMA_INVALID",headers:[],rows:[]};
  const values=sheet.getRange(1,1,lastRow,lastColumn).getDisplayValues(),headers=values[0]||[];
  if(headers.length!==schema.length||headers.some(function(h,i){return String(h)!==schema[i];}))return {ok:false,code:"SCHEMA_INVALID",headers:headers,rows:[]};
  return {ok:true,code:"OK",headers:headers,rows:values.slice(1)};
}
function beta01Append_(sheetName,values,deps){const table=beta01ReadTable_(sheetName,deps);if(!table.ok)throw new Error(table.code+":"+sheetName);const sheet=deps.spreadsheet.getSheetByName(sheetName);sheet.appendRow(values);if(deps.flush)deps.flush();return sheet.getLastRow();}
function beta01UpdateRow_(sheetName,rowNumber,values,deps){const table=beta01ReadTable_(sheetName,deps);if(!table.ok)throw new Error(table.code+":"+sheetName);deps.spreadsheet.getSheetByName(sheetName).getRange(rowNumber,1,1,values.length).setValues([values]);if(deps.flush)deps.flush();return true;}
function beta01Rows_(table){return (table.rows||[]).map(function(row,index){const out={_row:index+2};table.headers.forEach(function(h,i){out[h]=row[i];});return out;});}

function beta01Dependencies_(overrides){const supplied=overrides||{},properties=supplied.properties||(typeof PropertiesService!=="undefined"?PropertiesService.getScriptProperties():null);return {
  properties:properties,spreadsheet:supplied.spreadsheet||(typeof getSpreadsheet_==="function"?getSpreadsheet_():null),now:supplied.now||function(){return new Date();},
  uuid:supplied.uuid||function(){return Utilities.getUuid();},sha256:supplied.sha256,flush:supplied.flush||(typeof SpreadsheetApp!=="undefined"?function(){SpreadsheetApp.flush();}:function(){}),
  lock:supplied.lock||(typeof LockService!=="undefined"?LockService.getScriptLock():null),
  fetch:supplied.fetch||(typeof UrlFetchApp!=="undefined"?function(url,options){return UrlFetchApp.fetch(url,options);}:null),
  create_profile:supplied.create_profile||beta01CreateProfile_,profile_exists:supplied.profile_exists||beta01ProfileExists_
};}

function beta01BootstrapSheets_(options){const deps=beta01Dependencies_(options&&options.dependencies),created=[];Object.keys(BETA01_SCHEMAS).forEach(function(name){let sheet=deps.spreadsheet.getSheetByName(name);if(!sheet){sheet=deps.spreadsheet.insertSheet(name);sheet.getRange(1,1,1,BETA01_SCHEMAS[name].length).setValues([BETA01_SCHEMAS[name].slice()]);created.push(name);}else{const table=beta01ReadTable_(name,deps);if(!table.ok)throw new Error("BETA01_SCHEMA_INVALID:"+name);}});if(deps.flush)deps.flush();return {ok:true,code:"BETA01_BOOTSTRAPPED",created:created,writes:created.length};}

function beta01FindUser_(telegramId,deps){const table=beta01ReadTable_(BETA01.USERS_SHEET,deps);if(!table.ok)return {ok:false,code:table.code};const matches=beta01Rows_(table).filter(function(row){return String(row.TELEGRAM_ID)===String(telegramId);});if(matches.length>1)return {ok:false,code:"DUPLICATE_BETA_USER"};return matches.length?{ok:true,code:"FOUND",user:matches[0],table:table}:{ok:false,code:"NOT_FOUND",table:table};}
function beta01ProfileExists_(telegramId,deps){try{const identity=resolveSafeContextIdentity_(telegramId,deps.spreadsheet,{deployment_env:beta01Property_(deps,"DEPLOYMENT_ENV")});return identity&&identity.ok===true;}catch(e){return false;}}
function beta01StartToken_(text){const m=/^\/start(?:@\w+)?(?:\s+invite_([A-Za-z0-9_-]{8,80}))?\s*$/i.exec(String(text||""));return m?String(m[1]||""):null;}
function beta01InviteHash_(token,deps){return beta01Sha256_("fitbot-beta-invite|"+String(token||""),deps);}

function beta01ActivateInvite_(telegramId,token,deps){
 return beta01WithLock_(deps,function(){
  const table=beta01ReadTable_(BETA01.INVITES_SHEET,deps);if(!table.ok)return beta01Result_(true,false,table.code,{message:"Доступ временно недоступен. Попробуй позже."});
  const existing=beta01FindUser_(telegramId,deps);if(existing.ok&&existing.user.STATUS==="ACTIVE")return beta01Result_(true,true,"ALREADY_ACTIVE",{authorized:true});
  if(beta01Property_(deps,"BETA_NEW_CONNECTIONS_PAUSED").toLowerCase()==="true")return beta01Result_(true,false,"BETA_PAUSED",{message:"Новые подключения временно приостановлены. Попробуй позже."});
  const participantLimit=beta01ParticipantLimit_(deps),activeUsers=beta01Rows_(beta01ReadTable_(BETA01.USERS_SHEET,deps)).filter(function(row){return row.STATUS==="ACTIVE";}).length;if(activeUsers>=participantLimit)return beta01Result_(true,false,"PARTICIPANT_LIMIT",{message:"Набор в текущую волну закрыт. Обратись к владельцу тестирования."});
  const hash=beta01InviteHash_(token,deps),now=deps.now(),matches=beta01Rows_(table).filter(function(row){return row.INVITE_HASH===hash;});
  if(matches.length!==1)return beta01Result_(true,false,"INVITE_INVALID",{message:"Приглашение недействительно. Попроси владельца беты прислать новую ссылку."});
  const invite=matches[0],uses=Number(invite.USES||0),maxUses=Math.max(1,Number(invite.MAX_USES||1)),expires=Date.parse(invite.EXPIRES_AT||"");
  if(invite.STATUS!=="ACTIVE"||!isFinite(expires)||expires<now.getTime()||uses>=maxUses)return beta01Result_(true,false,"INVITE_UNAVAILABLE",{message:"Приглашение уже недоступно. Попроси владельца беты прислать новую ссылку."});
  const updated=[invite.INVITE_HASH,uses+1>=maxUses?"ACTIVATED":"ACTIVE",invite.CREATED_AT,invite.EXPIRES_AT,maxUses,uses+1,invite.CREATED_BY,String(telegramId),beta01Iso_(now),invite.REVOKED_AT||""];
  beta01UpdateRow_(BETA01.INVITES_SHEET,invite._row,updated,deps);
  if(existing.ok){const u=existing.user;beta01UpdateRow_(BETA01.USERS_SHEET,u._row,[String(telegramId),"ACTIVE","INVITE","CONSENT_REQUIRED",u.CONSENT_VERSION||"",u.CONSENT_AT||"",u.OPTIONAL_IMPROVEMENT_CONSENT||"",u.STATE_JSON||"{}",u.CREATED_AT||beta01Iso_(now),beta01Iso_(now)],deps);}
  else beta01Append_(BETA01.USERS_SHEET,[String(telegramId),"ACTIVE","INVITE","CONSENT_REQUIRED","","","","{}",beta01Iso_(now),beta01Iso_(now)],deps);
  beta01RecordEvent_(telegramId,"INVITE_ACTIVATED",true,{},deps);
  return beta01Result_(true,true,"INVITE_ACTIVATED",{authorized:true,sheet_writes:3});
 });
}

function beta01AccessDecision_(telegramId,text,deps){
  if(!beta01Enabled_(deps))return beta01Result_(false,true,"BETA_GATE_DISABLED",{authorized:true});
  if(beta01Admins_(deps).indexOf(String(telegramId))>=0)return beta01Result_(false,true,"AUTHORIZED_ADMIN",{authorized:true});
  if(beta01DeletionTombstoned_(telegramId,deps)){
    const deletion=beta01DeletionTombstone_(telegramId,deps),retry=beta01Normalize_(text)==="подтверждаю безвозвратное удаление"&&["IN_PROGRESS","PARTIAL_FAILURE"].indexOf(deletion.status)>=0;
    if(retry)return beta01Result_(false,true,"DELETION_RETRY_AUTHORIZED",{authorized:true});
    return beta01Result_(true,false,"DATA_DELETED",{message:"Данные этого профиля удалены или поставлены на безопасную очистку, доступ закрыт. Для поддержки обратись к владельцу тестирования."});
  }
  const token=beta01StartToken_(text);if(token)return beta01ActivateInvite_(telegramId,token,deps);
  const found=beta01FindUser_(telegramId,deps);if(found.ok&&found.user.STATUS==="ACTIVE")return beta01Result_(false,true,"AUTHORIZED",{authorized:true,user:found.user});
  if(deps.profile_exists(telegramId,deps))return beta01Result_(false,true,"AUTHORIZED_EXISTING_PROFILE",{authorized:true});
  return beta01Result_(true,false,"ACCESS_DENIED",{message:"Сейчас Fit_Bot доступен только участникам закрытой беты. Открой персональную ссылку-приглашение или обратись к владельцу тестирования."});
}
function routeBeta01Access_(update,options){try{const message=update&&(update.message||update.edited_message),callback=update&&update.callback_query,telegramId=String(message&&message.from&&message.from.id||callback&&callback.from&&callback.from.id||"");if(!telegramId)return beta01Result_(false,true,"NO_USER",{authorized:true});return beta01AccessDecision_(telegramId,message&&message.text||"",beta01Dependencies_(options&&options.dependencies));}catch(e){return beta01Result_(true,false,"ACCESS_CHECK_FAILED",{message:"Не удалось безопасно проверить доступ. Попробуй позже."});}}

function beta01SetUser_(user,patch,deps){const now=deps.now(),next=Object.assign({},user,patch);beta01UpdateRow_(BETA01.USERS_SHEET,user._row,[next.TELEGRAM_ID,next.STATUS,next.ACCESS_SOURCE,next.ONBOARDING_STATUS,next.CONSENT_VERSION,next.CONSENT_AT,next.OPTIONAL_IMPROVEMENT_CONSENT,next.STATE_JSON,next.CREATED_AT,beta01Iso_(now)],deps);return next;}
function beta01ParseProfile_(text){
  const raw=String(text||"").toLowerCase().replace(/ё/g,"е"),n=beta01Normalize_(raw),out={};let m;
  if((m=/(?:мне\s*)?(\d{1,2})\s*(?:лет|год|года)/.exec(raw)))out.age=Number(m[1]);
  if((m=/(?:рост\s*)?(\d{3})\s*(?:см|сантиметр)/.exec(raw)))out.height=Number(m[1]);
  if((m=/(?:вес(?:\s*(?:около|примерно))?\s*)?(\d{2,3}(?:[.,]\d+)?)\s*(?:кг|килограмм)/.exec(raw)))out.weight=Number(m[1].replace(",","."));
  if(/похуд|сниз.*вес|сброс/.test(n))out.goal="Снижение веса";else if(/набрать.*(?:мас|вес)|набор масс/.test(n))out.goal="Набор массы";else if(/сохран|поддерж.*(?:форм|вес)|общ.*здоров/.test(n))out.goal="Поддержание формы";else if(/сил|жим|присед|тяга/.test(n))out.goal="Рост силовых показателей";
  if(/нович|начинающ/.test(n))out.level="Начальный";else if(/средн.*уров|занимаюсь.*(?:год|лет)/.test(n))out.level="Средний";else if(/продвинут|опытн/.test(n))out.level="Продвинутый";
  if((m=/(\d)\s*(?:трениров\S*|раза|раз)\s*(?:в|за)?\s*недел/.exec(n)))out.training_per_week=Number(m[1]);
  return out;
}
function beta01ProfileSummary_(state){const p=state.profile||{},lines=["Проверь, что я понял:"];if(p.goal)lines.push("• Цель: "+p.goal);if(p.age!=null)lines.push("• Возраст: "+p.age);if(p.height!=null)lines.push("• Рост: "+p.height+" см");if(p.weight!=null)lines.push("• Вес: "+String(p.weight).replace(".",",")+" кг");if(p.level)lines.push("• Уровень: "+p.level);if(p.training_per_week!=null)lines.push("• Тренировок в неделю: "+p.training_per_week);lines.push("","Сохранить профиль? Ответь «Да», «Исправить» или «Отмена».");return lines.join("\n");}
function beta01InternalUserId_(telegramId,deps){return "beta-"+beta01UserKey_(telegramId,deps).slice(0,12);}
function beta01CreateProfile_(telegramId,profile,deps){
 return beta01WithLock_(deps,function(){
  const sheet=deps.spreadsheet.getSheetByName("User_Profile");if(!sheet)return {ok:false,code:"PROFILE_SHEET_MISSING"};
  const values=sheet.getDataRange().getDisplayValues(),headers=values[0]||[],schema=nutritionTargetSchema_(headers);if(!schema.ok)return {ok:false,code:"PROFILE_SCHEMA_INVALID"};
  const telegramIndex=schema.indexes.Telegram_ID,userIndex=schema.indexes.User_ID,matches=values.slice(1).filter(function(row){return String(row[telegramIndex])===String(telegramId);});
  if(matches.length>1)return {ok:false,code:"DUPLICATE_PROFILE"};if(matches.length===1)return {ok:true,code:"PROFILE_EXISTS",created:false};
  const row=new Array(headers.length).fill("");function put(name,value){const i=schema.indexes[name];if(i>=0&&value!==undefined&&value!==null&&value!=="")row[i]=value;}
  put("User_ID",beta01InternalUserId_(telegramId,deps));put("Telegram_ID",String(telegramId));put("Возраст",profile.age);put("Рост",profile.height);put("Вес старт",profile.weight);put("Текущий вес",profile.weight);put("Цель",profile.goal);put("Уровень подготовки",profile.level);put("Тренировки в неделю",profile.training_per_week);
  sheet.appendRow(row);if(deps.flush)deps.flush();const verify=sheet.getDataRange().getDisplayValues().slice(1).filter(function(r){return String(r[telegramIndex])===String(telegramId);});return verify.length===1?{ok:true,code:"PROFILE_CREATED",created:true,user_id:row[userIndex]}:{ok:false,code:"PROFILE_READBACK_FAILED"};
 });
}

function beta01CompleteOnboarding_(telegramId,deps){return beta01WithLock_(deps,function(){const current=beta01FindUser_(telegramId,deps);if(!current.ok)return beta01Result_(true,false,current.code,{authorized:true,message:"Не удалось сохранить и проверить профиль. Ничего не подтверждаю — попробуй позже."});if(current.user.ONBOARDING_STATUS==="COMPLETE")return beta01Result_(true,true,"ONBOARDING_ALREADY_COMPLETE",{authorized:true,message:"Профиль уже сохранён и проверен."});if(current.user.ONBOARDING_STATUS!=="PROFILE_CONFIRMATION")return beta01Result_(true,false,"ONBOARDING_STATE_CHANGED",{authorized:true,message:"Состояние знакомства изменилось. Повтори последнее действие."});const state=beta01Json_(current.user.STATE_JSON,{}),saved=deps.create_profile(telegramId,state.profile||{},Object.assign({},deps,{lock:null}));if(!saved||!saved.ok)return beta01Result_(true,false,saved&&saved.code||"PROFILE_SAVE_FAILED",{authorized:true,message:"Не удалось сохранить и проверить профиль. Ничего не подтверждаю — попробуй позже."});beta01SetUser_(current.user,{ONBOARDING_STATUS:"COMPLETE",STATE_JSON:"{}"},deps);beta01RecordEvent_(telegramId,"ONBOARDING_COMPLETED",true,{profile_fields:Object.keys(state.profile||{}).length},deps);return beta01Result_(true,true,"ONBOARDING_COMPLETE",{authorized:true,sheet_writes:saved.created?3:2,message:"Профиль сохранён и проверен. Я знаю только подтверждённые тобой данные. Теперь можно начать с полезного действия: запиши еду, вес или спроси «Что мне делать сегодня?». Цели питания и тренировок можно добавить позже."});});}

function routeBeta01Onboarding_(update,options){
  const message=update&&(update.message||update.edited_message),text=String(message&&message.text||""),telegramId=String(message&&message.from&&message.from.id||"");if(!telegramId)return beta01Result_(false,true,"NOT_ONBOARDING");
  const deps=beta01Dependencies_(options&&options.dependencies);if(!beta01Enabled_(deps))return beta01Result_(false,true,"BETA_GATE_DISABLED");
  const found=beta01FindUser_(telegramId,deps);if(!found.ok||found.user.STATUS!=="ACTIVE")return beta01Result_(false,true,"NOT_ONBOARDING");
  let user=found.user,status=user.ONBOARDING_STATUS||"CONSENT_REQUIRED",state=beta01Json_(user.STATE_JSON,{}),n=beta01Normalize_(text);
  if(status==="COMPLETE")return beta01Result_(false,true,"ONBOARDING_COMPLETE",{authorized:true});
  if(status==="CONSENT_REQUIRED"){
    if(/^(?:принимаю|согласен|согласна)$/.test(n)){user=beta01SetUser_(user,{ONBOARDING_STATUS:"PROFILE_COLLECTION",CONSENT_VERSION:BETA01.CONSENT_VERSION,CONSENT_AT:beta01Iso_(deps.now()),STATE_JSON:JSON.stringify({profile:{}})},deps);return beta01Result_(true,true,"CONSENT_ACCEPTED",{authorized:true,sheet_writes:1,message:"Спасибо! Чтобы начать, напиши одним сообщением цель и только те данные, которыми готов поделиться: например, «Хочу снизить вес, 35 лет, 180 см, 95 кг». Или ответь «Пропустить» — всё можно добавить позже."});}
    if(/^(?:не согласен|не согласна|отказываюсь)$/.test(n)){beta01SetUser_(user,{STATUS:"DECLINED",ONBOARDING_STATUS:"DECLINED"},deps);return beta01Result_(true,true,"CONSENT_DECLINED",{message:"Понял. Без согласия профиль и история не создаются. Если передумаешь, понадобится новое приглашение.",sheet_writes:1});}
    return beta01Result_(true,true,"CONSENT_REQUIRED",{authorized:true,message:"Привет! Это бесплатная закрытая бета Fit_Bot, которую проводит частное лицо. Участие добровольное.\n\nБот работает через Telegram, хранит в Google твои сообщения и данные о питании, весе, тренировках и самочувствии. Для распознавания голоса и части ответов используется Groq. Организатор может видеть данны для поддержки.\n\nТы можешь в любой момент прекратить участие или запросить удаление данных. Fit_Bot не заменяет врача.\n\nЕсли согласен, ответь «Принимаю». Если нет — «Не согласен»."});
  }
  if(status==="PROFILE_COLLECTION"){
    if(n==="отмена")return beta01Result_(true,true,"ONBOARDING_PAUSED",{authorized:true,message:"Знакомство приостановлено. Напиши /start, когда захочешь продолжить."});
    const profile=n==="пропустить"?{}:beta01ParseProfile_(text);if(n!=="пропустить"&&!Object.keys(profile).length)return beta01Result_(true,true,"PROFILE_CLARIFICATION",{authorized:true,message:"Я не нашёл в сообщении профильных данных. Напиши цель и любые известные параметры с единицами — например «рост 180 см, вес 95 кг» — или ответь «Пропустить»."});
    state={profile:profile};beta01SetUser_(user,{ONBOARDING_STATUS:"PROFILE_CONFIRMATION",STATE_JSON:JSON.stringify(state)},deps);return beta01Result_(true,true,"PROFILE_CONFIRMATION",{authorized:true,sheet_writes:1,message:beta01ProfileSummary_(state)});
  }
  if(status==="PROFILE_CONFIRMATION"){
    if(/^(?:исправить|нет)$/.test(n)){beta01SetUser_(user,{ONBOARDING_STATUS:"PROFILE_COLLECTION",STATE_JSON:JSON.stringify({profile:{}})},deps);return beta01Result_(true,true,"PROFILE_RETRY",{authorized:true,sheet_writes:1,message:"Хорошо. Пришли исправленные данные одним сообщением или напиши «Пропустить»."});}
    if(n==="отмена"){beta01SetUser_(user,{ONBOARDING_STATUS:"PROFILE_COLLECTION"},deps);return beta01Result_(true,true,"PROFILE_CANCELLED",{authorized:true,sheet_writes:1,message:"Профиль не сохранён. Можно начать снова командой /start."});}
    if(!/^(?:да|подтверждаю|сохранить)$/.test(n))return beta01Result_(true,true,"PROFILE_CONFIRMATION_REQUIRED",{authorized:true,message:beta01ProfileSummary_(state)});
    return beta01CompleteOnboarding_(telegramId,deps);
  }
  return beta01Result_(true,false,"ONBOARDING_STATE_INVALID",{authorized:true,message:"Не удалось продолжить знакомство. Обратись к владельцу тестирования."});
}

function beta01RecordEvent_(telegramId,eventType,success,metadata,deps){try{return beta01Append_(BETA01.EVENTS_SHEET,[deps.uuid(),beta01UserKey_(telegramId,deps),beta01Iso_(deps.now()),String(eventType),success?"TRUE":"FALSE",JSON.stringify(metadata||{})],deps);}catch(e){return 0;}}
function beta01AuditLogValues_(telegramId,username,messageText,hasText,options){try{const deps=beta01Dependencies_(options&&options.dependencies);if(!beta01Enabled_(deps))return {user_id:String(telegramId||""),source:"Telegram @"+String(username||"без_username"),message:String(messageText||"")};return {user_id:beta01UserKey_(telegramId,deps),source:"Telegram beta user",message:hasText?"[message redacted; chars="+String(messageText||"").length+"]":"[non-text message]"};}catch(e){return {user_id:"BETA_REDACTED",source:"Telegram beta user",message:"[message redacted]"};}}
function routeBeta01Feedback_(update,options){
  const message=update&&(update.message||update.edited_message),text=String(message&&message.text||""),telegramId=String(message&&message.from&&message.from.id||""),n=beta01Normalize_(text);if(!telegramId)return beta01Result_(false,true,"NOT_FEEDBACK");
  const deps=beta01Dependencies_(options&&options.dependencies);if(!beta01Enabled_(deps))return beta01Result_(false,true,"BETA_GATE_DISABLED");
  const m=/^(?:\/feedback|отзыв|сообщить о проблеме|предложение)\s*:?\s+([\s\S]{3,1000})$/i.exec(text.trim());
  if(m){let category=/проблем|ошиб|не работ/i.test(n)?"PROBLEM":/предлож|хотелось|идея/i.test(n)?"IDEA":"IMPRESSION";beta01Append_(BETA01.FEEDBACK_SHEET,[deps.uuid(),telegramId,beta01Iso_(deps.now()),category,m[1].trim(),"NEW"],deps);beta01RecordEvent_(telegramId,"FEEDBACK_SUBMITTED",true,{category:category},deps);return beta01Result_(true,true,"FEEDBACK_SAVED",{authorized:true,sheet_writes:2,message:"Спасибо, обратную связь сохранил. Если проблема мешает пользоваться ботом, опиши ещё ожидаемый результат и что произошло."});}
  if(/^(?:как оставить отзыв|оставить отзыв|сообщить о проблеме)$/.test(n))return beta01Result_(true,true,"FEEDBACK_HELP",{authorized:true,message:"Напиши одним сообщением: «Отзыв: …», «Сообщить о проблеме: …» или «Предложение: …». Я сохраню текст для владельца закрытой беты."});
  if(/^(?:удалить мои данные|удали мой профиль|запросить удаление данных)$/.test(n))return createBeta01DeletionRequest_(telegramId,{dependencies:deps});
  return beta01Result_(false,true,"NOT_FEEDBACK",{authorized:true});
}

function beta01TelegramFile_(fileId,deps){const token=beta01Property_(deps,"TELEGRAM_TOKEN");if(!token)throw new Error("TELEGRAM_TOKEN_MISSING");const meta=deps.fetch("https://api.telegram.org/bot"+token+"/getFile?file_id="+encodeURIComponent(fileId),{method:"get",muteHttpExceptions:true}),body=beta01Json_(meta.getContentText(),{});if(meta.getResponseCode()!==200||!body.ok||!body.result||!body.result.file_path)throw new Error("TELEGRAM_FILE_LOOKUP_FAILED");return deps.fetch("https://api.telegram.org/file/bot"+token+"/"+body.result.file_path,{method:"get",muteHttpExceptions:true}).getBlob();}
function transcribeBeta01VoiceMessage_(message,options){
  try{const deps=beta01Dependencies_(options&&options.dependencies),voice=message&&message.voice;if(!voice||!voice.file_id)return {ok:false,code:"VOICE_MISSING",message:"Не удалось получить голосовое сообщение."};if(Number(voice.duration||0)>120)return {ok:false,code:"VOICE_TOO_LONG",message:"Голосовое длиннее двух минут. Отправь более короткое сообщение или текст."};
    const apiKey=beta01Property_(deps,"GROQ_API_KEY");if(!apiKey)return {ok:false,code:"STT_NOT_CONFIGURED",message:"Распознавание голоса временно недоступно. Отправь сообщение текстом."};const blob=beta01TelegramFile_(voice.file_id,deps);blob.setName("voice.ogg");
    const response=deps.fetch("https://api.groq.com/openai/v1/audio/transcriptions",{method:"post",headers:{Authorization:"Bearer "+apiKey},payload:{file:blob,model:"whisper-large-v3-turbo",language:"ru",response_format:"json",temperature:"0"},muteHttpExceptions:true});const body=beta01Json_(response.getContentText(),{}),text=String(body.text||"").trim();
    if(response.getResponseCode()!==200||!text)return {ok:false,code:"STT_FAILED",message:"Не удалось надёжно распознать голос. Отправь сообщение текстом."};return {ok:true,code:"TRANSCRIBED",text:text.slice(0,BETA01.MAX_TRANSCRIPT_CHARS),audio_persisted:false};
  }catch(e){return {ok:false,code:"STT_FAILED",message:"Не удалось надёжно распознать голос. Отправь сообщение текстом."};}
}

function createBeta01Invite_(createdBy,options){const deps=beta01Dependencies_(options&&options.dependencies);return beta01WithLock_(deps,function(){const admins=beta01Property_(deps,"BETA_ADMIN_TELEGRAM_IDS").split(",").map(function(v){return v.trim();}).filter(Boolean);if(admins.indexOf(String(createdBy))<0)return {ok:false,code:"ADMIN_REQUIRED"};if(beta01Property_(deps,"BETA_NEW_CONNECTIONS_PAUSED").toLowerCase()==="true")return {ok:false,code:"BETA_PAUSED"};const status=beta01AdminStatus_(deps),limit=beta01ParticipantLimit_(deps);if(status.active_users+status.active_invites>=limit)return {ok:false,code:"PARTICIPANT_LIMIT",limit:limit};const token=deps.uuid().replace(/-/g,"")+deps.uuid().replace(/-/g,"").slice(0,8),now=deps.now(),expires=new Date(now.getTime()+BETA01.INVITE_TTL_DAYS*86400000);beta01Append_(BETA01.INVITES_SHEET,[beta01InviteHash_(token,deps),"ACTIVE",beta01Iso_(now),beta01Iso_(expires),1,0,String(createdBy),"","",""],deps);return {ok:true,code:"INVITE_CREATED",token:token,expires_at:beta01Iso_(expires),writes:1};});}

function beta01RevokeActiveInvites_(deps){return beta01WithLock_(deps,function(){const table=beta01ReadTable_(BETA01.INVITES_SHEET,deps);if(!table.ok)return {ok:false,code:table.code,count:0};const now=beta01Iso_(deps.now());let count=0;beta01Rows_(table).forEach(function(invite){if(invite.STATUS!=="ACTIVE")return;beta01UpdateRow_(BETA01.INVITES_SHEET,invite._row,[invite.INVITE_HASH,"REVOKED",invite.CREATED_AT,invite.EXPIRES_AT,invite.MAX_USES,invite.USES,invite.CREATED_BY,invite.ACTIVATED_USER_ID,invite.ACTIVATED_AT,now],deps);count+=1;});return {ok:true,code:"INVITES_REVOKED",count:count};});}

function beta01Admins_(deps){return beta01Property_(deps,"BETA_ADMIN_TELEGRAM_IDS").split(",").map(function(v){return v.trim();}).filter(Boolean);}
function beta01AdminStatus_(deps){const users=beta01Rows_(beta01ReadTable_(BETA01.USERS_SHEET,deps)),invites=beta01Rows_(beta01ReadTable_(BETA01.INVITES_SHEET,deps));return {active_users:users.filter(function(u){return u.STATUS==="ACTIVE";}).length,onboarding_complete:users.filter(function(u){return u.ONBOARDING_STATUS==="COMPLETE";}).length,active_invites:invites.filter(function(i){return i.STATUS==="ACTIVE";}).length,paused:beta01Property_(deps,"BETA_NEW_CONNECTIONS_PAUSED").toLowerCase()==="true"};}
function routeBeta01Admin_(update,options){
  const message=update&&(update.message||update.edited_message),text=String(message&&message.text||"").trim(),userId=String(message&&message.from&&message.from.id||"");if(!/^\/beta_(?:invite|status|pause|resume|revoke_invites|revoke)(?:\s|$)/i.test(text))return beta01Result_(false,true,"NOT_BETA_ADMIN");
  const deps=beta01Dependencies_(options&&options.dependencies);if(beta01Admins_(deps).indexOf(userId)<0)return beta01Result_(true,false,"ADMIN_REQUIRED",{message:"Команда доступна только владельцу закрытой беты."});
  if(/^\/beta_status/i.test(text)){const s=beta01AdminStatus_(deps);return beta01Result_(true,true,"BETA_STATUS",{authorized:true,message:["Закрытая бета:","• Активных участников: "+s.active_users,"• Завершили знакомство: "+s.onboarding_complete,"• Активных приглашений: "+s.active_invites,"• Новые подключения: "+(s.paused?"приостановлены":"разрешены")].join("\n")});}
  if(/^\/beta_pause/i.test(text)){deps.properties.setProperty("BETA_NEW_CONNECTIONS_PAUSED","true");return beta01Result_(true,true,"BETA_PAUSED",{authorized:true,message:"Новые подключения приостановлены. Уже активные участники сохраняют доступ."});}
  if(/^\/beta_resume/i.test(text)){deps.properties.setProperty("BETA_NEW_CONNECTIONS_PAUSED","false");return beta01Result_(true,true,"BETA_RESUMED",{authorized:true,message:"Новые подключения снова разрешены."});}
  const revoke=/^\/beta_revoke\s+(-?\d{1,32})$/i.exec(text);if(revoke){const found=beta01FindUser_(revoke[1],deps);if(!found.ok)return beta01Result_(true,false,"USER_NOT_FOUND",{authorized:true,message:"Участник не найден."});beta01SetUser_(found.user,{STATUS:"REVOKED"},deps);return beta01Result_(true,true,"ACCESS_REVOKED",{authorized:true,sheet_writes:1,message:"Доступ участника отозван. Данные не удалены."});}
  if(/^\/beta_revoke_invites$/i.test(text)){const revoked=beta01RevokeActiveInvites_(deps);return beta01Result_(true,revoked.ok,revoked.code,{authorized:true,sheet_writes:revoked.count,message:revoked.ok?"Неиспользованные приглашения отозваны: "+revoked.count+".":"Не удалось отозвать приглашения."});}
  const invite=createBeta01Invite_(userId,{dependencies:deps});if(!invite.ok)return beta01Result_(true,false,invite.code,{authorized:true,message:invite.code==="BETA_PAUSED"?"Новые подключения приостановлены. Сначала используй /beta_resume.":invite.code==="PARTICIPANT_LIMIT"?"Достигнут лимит участников и активных приглашений: "+beta01ParticipantLimit_(deps)+".":"Не удалось создать приглашение."});const username=beta01Property_(deps,"TELEGRAM_BOT_USERNAME");return beta01Result_(true,true,"INVITE_CREATED",{authorized:true,sheet_writes:1,message:username?"Персональная ссылка действует 14 дней и активируется один раз:\nhttps://t.me/"+username+"?start=invite_"+invite.token:"Код приглашения: invite_"+invite.token+"\nДобавь TELEGRAM_BOT_USERNAME, чтобы получать готовую ссылку."});
}

function beta01ReadinessAudit_(options){const deps=beta01Dependencies_(options&&options.dependencies),tables={};Object.keys(BETA01_SCHEMAS).forEach(function(name){const t=beta01ReadTable_(name,deps);tables[name]={ok:t.ok,code:t.code,rows:t.ok?t.rows.length:0};});return {ok:Object.keys(tables).every(function(name){return tables[name].ok;}),environment:beta01Property_(deps,"DEPLOYMENT_ENV"),access_enabled:beta01Enabled_(deps),tables:tables,stt_provider:"GROQ_WHISPER",production_writes:0};}
