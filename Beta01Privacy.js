/* BETA-01 privacy closeout — confirmed, idempotent, user-scoped erasure. */
const BETA01_DELETE_CONFIRMATION = "подтверждаю безвозвратное удаление";

const BETA01_DELETION_STORES = Object.freeze([
  Object.freeze({sheet:"PENDING_CAPTURES", keys:["user_id","chat_id"]}),
  Object.freeze({sheet:"AI_MEMORY", keys:["USER_ID"]}),
  Object.freeze({sheet:"Bot_Input", keys:["user_id"], pseudonymous:true}),
  Object.freeze({sheet:"User_Profile", keys:["Telegram_ID","User_ID"]}),
  Object.freeze({sheet:"Nutrition_Log", keys:["USER_ID"]}),
  Object.freeze({sheet:"Nutrition_Recipes", keys:["USER_ID"]}),
  Object.freeze({sheet:"Workout_Log", keys:["USER_ID","TELEGRAM_ID"]}),
  Object.freeze({sheet:"Recovery_Checkin", keys:["USER_ID"]}),
  Object.freeze({sheet:"Workout_Plan", keys:["USER_ID","TELEGRAM_ID"]}),
  Object.freeze({sheet:"AI_Coach_Decisions", keys:["USER_ID"]}),
  Object.freeze({sheet:"Workout_Plan_Versions", keys:["USER_ID","TELEGRAM_ID"]}),
  Object.freeze({sheet:"BETA_FEEDBACK", keys:["TELEGRAM_ID"]}),
  Object.freeze({sheet:"BETA_EVENTS", keys:["USER_KEY"], pseudonymous:true}),
  Object.freeze({sheet:"BETA_USERS", keys:["TELEGRAM_ID"]})
]);

function beta01DeletionResult_(ok,code,extra){return beta01Result_(true,ok,code,Object.assign({authorized:true},extra||{}));}
function beta01DeletionNormalize_(value){return beta01Normalize_(value);}
function beta01DeletionSheetValues_(sheet){if(!sheet||sheet.getLastRow()<1||sheet.getLastColumn()<1)return null;return sheet.getRange(1,1,sheet.getLastRow(),sheet.getLastColumn()).getDisplayValues();}
function beta01DeletionIndexes_(headers){const out={};(headers||[]).forEach(function(h,i){out[String(h||"").trim()]=i;});return out;}
function beta01DeletionSubjectKey_(telegramId,deps){return beta01UserKey_(telegramId,deps);}

function beta01DeletionFindRequests_(telegramId,deps){
  const table=beta01ReadTable_(BETA01.REQUESTS_SHEET,deps);if(!table.ok)return {ok:false,code:table.code,rows:[]};
  return {ok:true,code:"OK",rows:beta01Rows_(table).filter(function(row){return String(row.TELEGRAM_ID)===String(telegramId)&&row.REQUEST_TYPE==="DELETE_ALL";})};
}

function createBeta01DeletionRequest_(telegramId,options){
  const deps=beta01Dependencies_(options&&options.dependencies);return beta01WithLock_(deps,function(){
    if(beta01DeletionTombstoned_(telegramId,deps))return beta01DeletionResult_(true,"DELETION_ALREADY_COMPLETED",{message:"Данные уже удалены, доступ к прежнему профилю закрыт."});
    const found=beta01DeletionFindRequests_(telegramId,deps);if(!found.ok)return beta01DeletionResult_(false,found.code,{message:"Не удалось подготовить запрос. Попробуй позже."});
    const active=found.rows.filter(function(row){return ["PENDING_CONFIRMATION","IN_PROGRESS","PARTIAL_FAILURE"].indexOf(row.STATUS)>=0;}).pop();
    if(active)return beta01DeletionResult_(true,"DELETION_REQUEST_EXISTS",{request_id:active.REQUEST_ID,message:"Запрос уже подготовлен. Чтобы необратимо удалить активные данные, отправь отдельным сообщением точную фразу:\n«ПОДТВЕРЖДАЮ БЕЗВОЗВРАТНОЕ УДАЛЕНИЕ»"});
    const id=deps.uuid(),now=beta01Iso_(deps.now());beta01Append_(BETA01.REQUESTS_SHEET,[id,String(telegramId),now,"DELETE_ALL","PENDING_CONFIRMATION","",""],deps);
    return beta01DeletionResult_(true,"DELETION_REQUEST_CREATED",{request_id:id,sheet_writes:1,message:"Запрос подготовлен. Операция удалит активный профиль, историю и незавершённые действия и закроет доступ. Это необратимо. Чтобы подтвердить, отправь отдельным сообщением точную фразу:\n«ПОДТВЕРЖДАЮ БЕЗВОЗВРАТНОЕ УДАЛЕНИЕ»"});
  });
}

function beta01DeletionResolveIdentity_(telegramId,deps){
  const sheet=deps.spreadsheet.getSheetByName("User_Profile");if(!sheet)return {ok:false,code:"PROFILE_SHEET_MISSING"};const values=beta01DeletionSheetValues_(sheet);if(!values)return {ok:false,code:"PROFILE_SCHEMA_INVALID"};
  const ix=beta01DeletionIndexes_(values[0]),telegramIndex=ix.Telegram_ID,userIndex=ix.User_ID;if(telegramIndex==null||userIndex==null)return {ok:false,code:"PROFILE_SCHEMA_INVALID"};
  const matches=values.slice(1).filter(function(row){return String(row[telegramIndex])===String(telegramId);});if(matches.length>1)return {ok:false,code:"DUPLICATE_PROFILE"};
  return {ok:true,code:"IDENTITY_RESOLVED",user_id:matches.length?String(matches[0][userIndex]||""):"",telegram_id:String(telegramId)};
}

function beta01DeletionConfirmationIds_(identity,deps){
  const sheet=deps.spreadsheet.getSheetByName("AI_MEMORY"),values=beta01DeletionSheetValues_(sheet);if(!values)return [];
  const ix=beta01DeletionIndexes_(values[0]);if(ix.USER_ID==null||ix.CONFIRMATION_ID==null)return [];
  const accepted={};[identity.telegram_id,identity.user_id].filter(Boolean).forEach(function(v){accepted[String(v)]=true;});
  return values.slice(1).filter(function(row){return accepted[String(row[ix.USER_ID]||"")];}).map(function(row){return String(row[ix.CONFIRMATION_ID]||"").trim();}).filter(Boolean);
}

function beta01DeleteMatchingRows_(sheet,matcher){
  const values=beta01DeletionSheetValues_(sheet);if(!values)return 0;const rows=[];for(let i=1;i<values.length;i+=1)if(matcher(values[i],values[0]))rows.push(i+1);
  for(let r=rows.length-1;r>=0;r-=1)sheet.deleteRow(rows[r]);return rows.length;
}

function beta01DeleteStore_(store,identity,subjectKey,deps){
  const sheet=deps.spreadsheet.getSheetByName(store.sheet);if(!sheet)return {ok:true,count:0,absent:true};
  const values=beta01DeletionSheetValues_(sheet);if(!values)return {ok:true,count:0};const ix=beta01DeletionIndexes_(values[0]);
  const targets={};if(store.pseudonymous){targets[subjectKey]=true;targets[identity.telegram_id]=true;}else{targets[identity.telegram_id]=true;if(identity.user_id)targets[identity.user_id]=true;}
  const keyIndexes=store.keys.map(function(key){return ix[key];}).filter(function(index){return index!=null;});if(!keyIndexes.length)return {ok:false,code:"SCHEMA_INVALID_"+store.sheet};
  const count=beta01DeleteMatchingRows_(sheet,function(row){return keyIndexes.some(function(index){return !!targets[String(row[index]||"")];});});return {ok:true,count:count};
}

function beta01DeleteBodyTracking_(confirmationIds,deps){
  if(!confirmationIds.length)return {ok:true,count:0};const sheet=deps.spreadsheet.getSheetByName("Body_Tracking");if(!sheet)return {ok:true,count:0,absent:true};
  const values=beta01DeletionSheetValues_(sheet);if(!values)return {ok:true,count:0};const ix=beta01DeletionIndexes_(values[0]);if(ix["Комментарий"]==null)return {ok:false,code:"SCHEMA_INVALID_Body_Tracking"};
  const ids={};confirmationIds.forEach(function(id){ids[id]=true;});const count=beta01DeleteMatchingRows_(sheet,function(row){const m=/^Authoritative weight\s+(.+)$/.exec(String(row[ix["Комментарий"]]||"").trim());return !!(m&&ids[m[1]]);});return {ok:true,count:count};
}

function beta01AnonymizeInvites_(telegramId,deps){
  const table=beta01ReadTable_(BETA01.INVITES_SHEET,deps);if(!table.ok)return {ok:false,code:table.code,count:0};let count=0;
  beta01Rows_(table).forEach(function(row){if(String(row.ACTIVATED_USER_ID)!==String(telegramId))return;beta01UpdateRow_(BETA01.INVITES_SHEET,row._row,[row.INVITE_HASH,"DELETED_USER",row.CREATED_AT,row.EXPIRES_AT,row.MAX_USES,row.USES,row.CREATED_BY,"",row.ACTIVATED_AT,row.REVOKED_AT],deps);count+=1;});return {ok:true,count:count};
}

function beta01DeleteOtherRequests_(telegramId,keepRequestId,deps){
  const sheet=deps.spreadsheet.getSheetByName(BETA01.REQUESTS_SHEET);if(!sheet)return {ok:false,code:"SHEET_MISSING",count:0};
  const values=beta01DeletionSheetValues_(sheet);if(!values)return {ok:false,code:"SCHEMA_INVALID",count:0};const ix=beta01DeletionIndexes_(values[0]);if(ix.TELEGRAM_ID==null||ix.REQUEST_ID==null)return {ok:false,code:"SCHEMA_INVALID",count:0};
  return {ok:true,count:beta01DeleteMatchingRows_(sheet,function(row){return String(row[ix.TELEGRAM_ID])===String(telegramId)&&String(row[ix.REQUEST_ID])!==String(keepRequestId);})};
}

function beta01DeleteUserProperties_(identity,deps){
  const ids=[identity.telegram_id,identity.user_id].filter(Boolean),keys={};ids.forEach(function(id){keys["COACH_STATE_"+id]=true;keys["PROACTIVE_DELIVERY_STATE_"+String(id).replace(/[^0-9]/g,"")]=true;keys["C21_MEMORY_RETRY_QUEUE_"+String(id).replace(/[^A-Za-z0-9._-]/g,"").slice(0,64)]=true;});
  Object.keys(keys).filter(function(key){return !/_(?:STATE_|QUEUE_)$/.test(key);}).forEach(function(key){deps.properties.deleteProperty(key);});return Object.keys(keys).length;
}

function beta01DeletionReadback_(identity,subjectKey,confirmationIds,deps){
  const residual=[];BETA01_DELETION_STORES.forEach(function(store){const sheet=deps.spreadsheet.getSheetByName(store.sheet),values=beta01DeletionSheetValues_(sheet);if(!values)return;const ix=beta01DeletionIndexes_(values[0]),targets={};if(store.pseudonymous){targets[subjectKey]=true;targets[identity.telegram_id]=true;}else{targets[identity.telegram_id]=true;if(identity.user_id)targets[identity.user_id]=true;}const indexes=store.keys.map(function(k){return ix[k];}).filter(function(i){return i!=null;});if(values.slice(1).some(function(row){return indexes.some(function(i){return !!targets[String(row[i]||"")];});}))residual.push(store.sheet);});
  const body=deps.spreadsheet.getSheetByName("Body_Tracking"),bodyValues=beta01DeletionSheetValues_(body);if(bodyValues&&confirmationIds.length){const ix=beta01DeletionIndexes_(bodyValues[0]),comments=ix["Комментарий"];if(comments!=null&&bodyValues.slice(1).some(function(row){return confirmationIds.some(function(id){return String(row[comments]||"").indexOf(id)>=0;});}))residual.push("Body_Tracking");}
  return {ok:residual.length===0,residual:residual};
}

function beta01DeletionUpdateRequest_(request,status,confirmedAt,completedAt,deps,anonymize){
  beta01UpdateRow_(BETA01.REQUESTS_SHEET,request._row,[request.REQUEST_ID,anonymize?"deleted:"+beta01DeletionSubjectKey_(request.TELEGRAM_ID,deps):request.TELEGRAM_ID,request.CREATED_AT,request.REQUEST_TYPE,status,confirmedAt||request.CONFIRMED_AT||"",completedAt||request.COMPLETED_AT||""],deps);
}

function beta01DeletionAppendAudit_(requestId,subjectKey,startedAt,completedAt,status,counts,error,deps){return beta01Append_(BETA01.DELETION_AUDIT_SHEET,[requestId,subjectKey,startedAt,completedAt||"",status,JSON.stringify(counts||{}),String(error||"")],deps);}

function executeBeta01Deletion_(telegramId,requestId,options){
  const deps=beta01Dependencies_(options&&options.dependencies);return beta01WithLock_(deps,function(){
    const requests=beta01DeletionFindRequests_(telegramId,deps);if(!requests.ok)return beta01DeletionResult_(false,requests.code);const candidates=requests.rows.filter(function(row){return (!requestId||row.REQUEST_ID===requestId)&&["PENDING_CONFIRMATION","PARTIAL_FAILURE","IN_PROGRESS"].indexOf(row.STATUS)>=0;});
    if(candidates.length!==1)return beta01DeletionTombstoned_(telegramId,deps)?beta01DeletionResult_(true,"DELETION_ALREADY_COMPLETED",{message:"Данные уже удалены."}):beta01DeletionResult_(false,candidates.length?"AMBIGUOUS_DELETION_REQUEST":"NO_DELETION_REQUEST",{message:"Активный подтверждённый запрос на удаление не найден."});
    const request=candidates[0],previous=beta01DeletionTombstone_(telegramId,deps);let identity=beta01DeletionResolveIdentity_(telegramId,deps);
    if((!identity.ok||!identity.user_id)&&previous.identity&&String(previous.identity.telegram_id)===String(telegramId))identity={ok:true,code:"IDENTITY_RECOVERED",telegram_id:String(telegramId),user_id:String(previous.identity.user_id||"")};
    if(!identity.ok)return beta01DeletionResult_(false,identity.code,{message:"Не удалось безопасно определить профиль. Ничего не удалено."});
    const now=beta01Iso_(deps.now()),subjectKey=beta01DeletionSubjectKey_(telegramId,deps),confirmationIds=previous.confirmation_ids||beta01DeletionConfirmationIds_(identity,deps),counts={};
    deps.properties.setProperty(beta01DeletionTombstoneKey_(telegramId,deps),JSON.stringify({request_id:request.REQUEST_ID,started_at:previous.started_at||now,status:"IN_PROGRESS",identity:{telegram_id:String(telegramId),user_id:identity.user_id},confirmation_ids:confirmationIds}));beta01DeletionUpdateRequest_(request,"IN_PROGRESS",request.CONFIRMED_AT||now,"",deps,false);beta01DeletionAppendAudit_(request.REQUEST_ID,subjectKey,previous.started_at||now,"","IN_PROGRESS",{},"",deps);
    try{
      for(let i=0;i<BETA01_DELETION_STORES.length;i+=1){const store=BETA01_DELETION_STORES[i],result=beta01DeleteStore_(store,identity,subjectKey,deps);if(!result.ok)throw new Error(result.code||"DELETE_FAILED_"+store.sheet);counts[store.sheet]=result.count;}
      const body=beta01DeleteBodyTracking_(confirmationIds,deps);if(!body.ok)throw new Error(body.code);counts.Body_Tracking=body.count;
      const invites=beta01AnonymizeInvites_(telegramId,deps);if(!invites.ok)throw new Error(invites.code);counts.BETA_INVITES=invites.count;
      try{counts.Script_Properties=beta01DeleteUserProperties_(identity,deps);}catch(propertyError){throw new Error("USER_PROPERTY_DELETE_FAILED");}
      const readback=beta01DeletionReadback_(identity,subjectKey,confirmationIds,deps);if(!readback.ok)throw new Error("READBACK_RESIDUAL_"+readback.residual.join("_"));
      const oldRequests=beta01DeleteOtherRequests_(telegramId,request.REQUEST_ID,deps);if(!oldRequests.ok)throw new Error(oldRequests.code);counts.BETA_DATA_REQUESTS=oldRequests.count;
      const fresh=beta01Rows_(beta01ReadTable_(BETA01.REQUESTS_SHEET,deps)).filter(function(row){return row.REQUEST_ID===request.REQUEST_ID;})[0]||request;beta01DeletionUpdateRequest_(fresh,"COMPLETED",now,now,deps,true);
      deps.properties.setProperty(beta01DeletionTombstoneKey_(telegramId,deps),JSON.stringify({request_id:request.REQUEST_ID,completed_at:now,status:"COMPLETED"}));beta01DeletionAppendAudit_(request.REQUEST_ID,subjectKey,now,now,"COMPLETED",counts,"",deps);
      return beta01DeletionResult_(true,"DELETION_COMPLETED",{request_id:request.REQUEST_ID,counts:counts,verified:true,message:"Активные данные удалены и результат проверен. Доступ к прежнему профилю закрыт."});
    }catch(error){const code=String(error&&error.message||"DELETION_FAILED").slice(0,120),fresh=beta01Rows_(beta01ReadTable_(BETA01.REQUESTS_SHEET,deps)).filter(function(row){return row.REQUEST_ID===request.REQUEST_ID;})[0]||request;beta01DeletionUpdateRequest_(fresh,"PARTIAL_FAILURE",request.CONFIRMED_AT||now,"",deps,false);deps.properties.setProperty(beta01DeletionTombstoneKey_(telegramId,deps),JSON.stringify({request_id:request.REQUEST_ID,started_at:previous.started_at||now,status:"PARTIAL_FAILURE",identity:{telegram_id:String(telegramId),user_id:identity.user_id},confirmation_ids:confirmationIds}));beta01DeletionAppendAudit_(request.REQUEST_ID,subjectKey,previous.started_at||now,"","PARTIAL_FAILURE",counts,code,deps);return beta01DeletionResult_(false,"DELETION_PARTIAL_FAILURE",{request_id:request.REQUEST_ID,counts:counts,error_code:code,message:"Удаление остановлено из-за технической ошибки. Доступ уже закрыт; повторная обработка безопасно продолжит очистку."});}
  });
}

function routeBeta01Deletion_(update,options){
  const message=update&&(update.message||update.edited_message),text=String(message&&message.text||""),telegramId=String(message&&message.from&&message.from.id||"");if(!telegramId||beta01DeletionNormalize_(text)!==BETA01_DELETE_CONFIRMATION)return beta01Result_(false,true,"NOT_DELETION_CONFIRMATION",{authorized:true});
  return executeBeta01Deletion_(telegramId,"",options||{});
}
