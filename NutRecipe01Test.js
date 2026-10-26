/** NUT-RECIPE-01 partial nutrition snapshot regression suite. */
function runNutRecipe01Tests() {
  const results=[];
  function record(id,passed,details){results.push({id:id,status:passed?"PASS":"FAIL",details:passed?{}:details||{}});}
  const text="Бутерброд с ветчиной из индейки и сыром 15% — 200 г, 2 куриных яйца, 1 помидор, томатный суп с фасолью и курицей 250 г, отварная свёкла 150 г, цитрусовый компот 150 мл";
  const aliases=[
    ["куриных яйца","egg"],["помидор","tomato"],["отварная свекла","beet"]
  ].map(function(x){return {ALIAS_NORMALIZED:x[0],FOOD_ID:x[1],PRIORITY:100,ACTIVE:true};});
  const refs=[
    ["egg","count",72,6.3,4.8,0.4,"UNKNOWN"],["tomato","count",22,1.1,0.2,4.8,"UNKNOWN"],
    ["beet","g",44,1.7,0.2,10,"BOILED"]
  ].map(function(x){return {REFERENCE_ID:x[0]+"-v1",FOOD_ID:x[0],CANONICAL_NAME:x[0],DISPLAY_NAME:x[0],VARIANT:"",
    PREPARATION_STATE:x[6],BASIS_QUANTITY:x[1]==="count"?1:100,BASIS_UNIT:x[1],CALORIES:x[2],PROTEIN:x[3],FAT:x[4],CARBS:x[5],
    AUTHORITY:"TEST",SOURCE:"synthetic",SOURCE_VERSION:"1",ACTIVE:true};});
  const options={calculation_enabled:true,aliases:aliases,references:refs};
  const detection=detectDomainFactCandidate_(text,options);
  record("NUT-RECIPE-01_01_SIX_ITEMS",detection.items.length===6,detection);
  record("NUT-RECIPE-01_02_PARTIAL",detection.reference_status==="PARTIAL"&&detection.calculation_status==="PARTIAL_CALCULATED",detection);
  record("NUT-RECIPE-01_03_COUNTS",detection.nutrition_calculation.calculable_items_count===3&&
    detection.nutrition_calculation.unknown_items_count===3,detection.nutrition_calculation);
  record("NUT-RECIPE-01_04_KNOWN_SUBTOTAL",detection.nutrition_calculation.totals.calories===232,detection.nutrition_calculation.totals);
  record("NUT-RECIPE-01_05_UNKNOWN_NOT_ZERO",detection.items.filter(function(i){return i.fields.nutrition_completeness;}).every(function(i){return i.fields.calculated_nutrition.value===null;}),detection.items);
  const capture=buildDomainFactCandidate_(detection,{now:new Date("2026-10-26T10:00:00Z"),uuid:function(){return "recipe";}});
  const validation=validateDomainFactCandidate_(capture),saveValidation=validateNutritionSnapshotForSave_(capture);
  record("NUT-RECIPE-01_06_CAPTURE_VALID",validation.ready_for_confirmation,validation);
  record("NUT-RECIPE-01_07_SAVE_VALID",saveValidation.ok,saveValidation);
  const prompt=formatNutritionConfirmation_(capture);
  record("NUT-RECIPE-01_08_EXPLICIT_UNKNOWN",prompt.indexOf("КБЖУ пока не определены")>=0,prompt);
  record("NUT-RECIPE-01_09_INCOMPLETE_TOTAL",prompt.indexOf("Итог неполный")>=0&&prompt.indexOf("Рассчитанный минимум")>=0,prompt);
  const persisted=buildNutritionPersistenceItems_(capture);
  record("NUT-RECIPE-01_10_ALL_ITEMS_FROZEN",persisted.length===6,persisted);
  record("NUT-RECIPE-01_11_UNKNOWN_PRESERVED",persisted.filter(function(i){return i.nutrition_completeness==="UNKNOWN";}).length===3,persisted);
  const summary={ok:true,meals_count:1,consumed:capture.nutrition_calculation.totals,unknown_items_count:3,calculated_items_count:3,totals_complete:false};
  record("NUT-RECIPE-01_12_DAILY_DISCLOSURE",formatDailyNutritionSummary_(summary).indexOf("без рассчитанных КБЖУ")>=0,summary);
  const allKnown=detectDomainFactCandidate_("2 куриных яйца, 1 помидор",options);
  record("NUT-RECIPE-01_13_FULL_COMPATIBILITY",allKnown.calculation_status==="CALCULATED"&&
    validateNutritionSnapshotForSave_(buildDomainFactCandidate_(allKnown,{uuid:function(){return "known";}})).ok,allKnown);
  const allUnknown=detectDomainFactCandidate_("Съел домашнее рагу 250 г",options);
  record("NUT-RECIPE-01_14_ALL_UNKNOWN_SAVEABLE_WITHOUT_ZERO_ITEM",allUnknown.calculation_status==="PARTIAL_CALCULATED"&&
    allUnknown.nutrition_calculation.calculable_items_count===0&&allUnknown.items[0].fields.calculated_nutrition.value===null,allUnknown);
  record("NUT-RECIPE-01_15_PERCENT_PRESERVED",detection.items[0].fields.quantity_value.value===200,detection.items[0]);
  const passed=results.filter(function(r){return r.status==="PASS";}).length;
  return {ok:passed===results.length,passed:passed,total:results.length,results:results};
}
