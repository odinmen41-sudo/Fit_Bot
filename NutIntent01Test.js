/** NUT-INTENT-01 conversational nutrition intent regression suite. */
function runNutIntent01Tests(){
  const tests=[];function record(id,ok,details){tests.push({id:id,status:ok?"PASS":"FAIL",details:ok?{}:details||{}});}
  const first="Привет! Запиши, пожалуйста, мне сегодня на завтрак капучино без сахара 300 мл и круассан обычный без всего";
  const second="1 капучино 300 миллилитров на обычном молоке без сахара и обычный круассан, одна порция, вес не знаю";
  let parsed=extractNutritionFactCandidate_(first);
  record("NUT-INTENT-01_01_PREAMBLE_REMOVED",parsed.items.length===2&&parsed.items[0].fields.food_display.value==="капучино без сахара"&&
    parsed.items.every(function(i){return !/привет|запиши/.test(i.fields.food_display.value);}),parsed);
  record("NUT-INTENT-01_02_FIRST_QUANTITY",parsed.items[0].fields.quantity_value.value===300&&parsed.items[0].fields.quantity_unit.value==="ml",parsed.items[0]);
  record("NUT-INTENT-01_03_CROISSANT_CLARIFICATION",parsed.requires_clarification&&parsed.items[1].fields.food_display.value==="круассан обычный без всего",parsed);
  parsed=extractNutritionFactCandidate_(second);
  record("NUT-INTENT-01_04_FULL_RESTATEMENT_TWO_ITEMS",parsed.items.length===2&&!parsed.requires_clarification,parsed);
  record("NUT-INTENT-01_05_MILLILITRES_AND_LEADING_COUNT",parsed.items[0].fields.food_display.value==="капучино"&&
    parsed.items[0].fields.quantity_value.value===300&&parsed.items[0].fields.quantity_unit.value==="ml",parsed.items[0]);
  record("NUT-INTENT-01_06_UNKNOWN_WEIGHT_IS_COUNT",parsed.items[1].fields.food_display.value==="обычный круассан"&&
    parsed.items[1].fields.quantity_value.value===1&&parsed.items[1].fields.quantity_unit.value==="count",parsed.items[1]);
  ["добавь в дневник банан 1 шт","на завтрак у меня было банан 1 шт","сегодня съел банан 1 шт","внеси в рацион банан 1 шт"].forEach(function(text,index){
    const value=extractNutritionFactCandidate_(text);record("NUT-INTENT-01_07_"+index+"_INTENT_FORM",value.items.length===1&&value.items[0].fields.food_display.value==="банан",value);
  });
  record("NUT-INTENT-01_08_TEXT_VOICE_EQUIVALENCE",JSON.stringify(extractNutritionFactCandidate_(second))===JSON.stringify(parsed),{});
  ["съел один круассан","съел круассан одна штука","съел круассан одна порция вес не знаю"].forEach(function(text,index){
    const value=extractNutritionFactCandidate_(text);record("NUT-INTENT-01_08A_"+index+"_COUNT_VARIANT",value.items.length===1&&
      value.items[0].fields.quantity_value.value===1&&value.items[0].fields.quantity_unit.value==="count",value);
  });
  const whisperVariant=extractNutritionFactCandidate_("Привет, запиши пожалуйста мне сегодня в завтрак капучино без сахара 300 миллилитров и круассан обычный без всего");
  record("NUT-INTENT-01_08B_WHISPER_PREAMBLE",whisperVariant.items.length===2&&whisperVariant.items[0].fields.food_display.value==="капучино без сахара"&&
    whisperVariant.items[0].fields.quantity_unit.value==="ml",whisperVariant);

  const aliases=[{ALIAS_NORMALIZED:"капучино",FOOD_ID:"cappuccino",PRIORITY:100,ACTIVE:true}];
  const refs=[{REFERENCE_ID:"cap-v1",FOOD_ID:"cappuccino",CANONICAL_NAME:"капучино",DISPLAY_NAME:"капучино",VARIANT:"",PREPARATION_STATE:"UNKNOWN",BASIS_QUANTITY:100,BASIS_UNIT:"ml",CALORIES:40,PROTEIN:2,FAT:2,CARBS:3,AUTHORITY:"TEST",SOURCE:"synthetic",SOURCE_VERSION:"1",ACTIVE:true}];
  const referenceOptions={calculation_enabled:true,aliases:aliases,references:refs};
  function env(){const rows=[],meals=[];function select(source,user,chat,includeSaved){const matches=rows.filter(function(r){return r.user_id===user&&r.chat_id===chat&&r.payload.source===source&&(r.status==="PENDING_CONFIRMATION"||includeSaved&&r.status==="SAVED");});const pending=matches.filter(function(r){return r.status==="PENDING_CONFIRMATION";}).slice(-1)[0];if(pending)return {ok:true,capture:pending,payload:pending.payload};const saved=matches.filter(function(r){return r.status==="SAVED";}).slice(-1)[0];return saved?{ok:true,capture:saved,payload:saved.payload}:{ok:false,code:"NO_CAPTURE"};}
    const deps={uuid:function(){return "ni"+(rows.length+1);},detect_confirmation:detectConfirmationIntent_,find_clarification:function(u,c,o){return select(NUTRITION_CLARIFICATION_SOURCE,u,c,false);},find_capture:function(u,c,o){return select("C231_DOMAIN_ROUTER",u,c,o.include_saved===true);},get_pending:function(u,c){const p=rows.filter(function(r){return r.user_id===u&&r.chat_id===c&&r.status==="PENDING_CONFIRMATION";}).slice(-1)[0];return p?{ok:true,capture:p}:{ok:false};},create_pending:function(capture,meta){rows.forEach(function(r){if(r.user_id===String(meta.user_id)&&r.chat_id===String(meta.chat_id)&&r.status==="PENDING_CONFIRMATION")r.status="SUPERSEDED";});rows.push({capture_id:capture.capture_id,user_id:String(meta.user_id),chat_id:String(meta.chat_id),payload:JSON.parse(JSON.stringify(capture)),status:"PENDING_CONFIRMATION"});return {ok:true,created:true,capture_id:capture.capture_id};},cancel:function(u,c){const p=rows.filter(function(r){return r.user_id===u&&r.chat_id===c&&r.status==="PENDING_CONFIRMATION";}).slice(-1)[0];if(p)p.status="CANCELLED";return {ok:!!p,code:p?"CANCELLED":"NO_CAPTURE"};},validate_nutrition_snapshot:validateNutritionSnapshotForSave_,nutrition_persistence_enabled:function(){return true;},persist_nutrition:function(found){if(found.capture.status==="SAVED")return {ok:true,code:"NUTRITION_SAVED",idempotent_replay:true,rows_written:0};meals.push(JSON.parse(JSON.stringify(found.payload)));found.capture.status="SAVED";return {ok:true,code:"NUTRITION_SAVED",rows_written:1};},build_dashboard:function(){return null;},evaluate_contextual:function(){return null;}};return {rows:rows,meals:meals,deps:deps};}
  function update(id,text){return {update_id:id,message:{text:text,from:{id:"synthetic"},chat:{id:"synthetic"}}};}
  let runtime=env(),now=new Date("2026-10-28T08:00:00Z"),result=routeDomainFactConfirmation_(update(1,first),{now:now,dependencies:runtime.deps,reference_options:referenceOptions});
  record("NUT-INTENT-01_09_FIRST_PROMPT_TARGETS_CROISSANT",result.handled&&/круассан/.test(result.message)&&!/привет запиши/.test(result.message),result);
  result=routeDomainFactConfirmation_(update(2,second),{now:new Date(now.getTime()+1000),dependencies:runtime.deps,reference_options:referenceOptions});
  const proposal=runtime.rows.filter(function(r){return r.status==="PENDING_CONFIRMATION"&&r.payload.source==="C231_DOMAIN_ROUTER";})[0];
  record("NUT-INTENT-01_10_FULL_RESTATEMENT_REPLACES_PENDING",result.ok&&proposal&&proposal.payload.items.length===2&&
    runtime.rows.filter(function(r){return r.payload.source===NUTRITION_CLARIFICATION_SOURCE&&r.status==="CANCELLED";}).length===1,{result:result,rows:runtime.rows});
  record("NUT-INTENT-01_11_PARTIAL_UNKNOWN_NOT_ZERO",proposal&&proposal.payload.nutrition_calculation.status==="PARTIAL_CALCULATED"&&
    proposal.payload.items[1].fields.calculated_nutrition.value===null,proposal&&proposal.payload);
  result=routeDomainFactConfirmation_(update(3,"Да"),{now:new Date(now.getTime()+2000),dependencies:runtime.deps,reference_options:referenceOptions});
  record("NUT-INTENT-01_12_SINGLE_CONFIRMED_SAVE",result.ok&&runtime.meals.length===1&&runtime.meals[0].items.length===2,result);

  runtime=env();result=routeDomainFactConfirmation_(update(4,first),{now:now,dependencies:runtime.deps,reference_options:referenceOptions});
  result=routeDomainFactConfirmation_(update(5,"вес не знаю"),{now:new Date(now.getTime()+1000),dependencies:runtime.deps,reference_options:referenceOptions});
  record("NUT-INTENT-01_13_NO_PROGRESS_EXITS_LOOP",result.code==="CLARIFICATION_NO_PROGRESS"&&/отменена/.test(result.message)&&
    runtime.rows.every(function(r){return r.status!=="PENDING_CONFIRMATION";}),{result:result,rows:runtime.rows});
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;return {suite:"NUT_INTENT_01",status:passed===tests.length?"PASS":"FAIL",passed:passed,total:tests.length,tests:tests};
}
