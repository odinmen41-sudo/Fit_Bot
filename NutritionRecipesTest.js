function runNutritionRecipesTests(){
  const tests=[];function check(id,ok,details){tests.push({id:id,status:ok?"PASS":"FAIL",details:ok?{}:details||{}});}
  let parsed=parseNutritionRecipeCommand_("Сохрани рецепт «каша домашняя»: овсяная каша на воде 250 г, банан 100 г; выход 500 г");
  check("RECIPE-01_PARSE_CREATE",parsed&&parsed.action==="CREATE"&&parsed.name==="каша домашняя"&&parsed.yield_value===500,parsed);
  parsed=parseNutritionRecipeCommand_("Обнови рецепт суп: рис вареный 100 г. выход 700 гр");
  check("RECIPE-02_PARSE_UPDATE",parsed&&parsed.action==="UPDATE"&&parsed.yield_unit==="g",parsed);
  check("RECIPE-03_REJECT_NO_YIELD",parseNutritionRecipeCommand_("Сохрани рецепт суп: рис 100 г")===null,{});
  const meal=detectNutritionRecipeMeal_("Съел каша домашняя по моему рецепту 250 г");
  check("RECIPE-04_PARSE_MEAL",meal&&meal.name==="каша домашняя"&&meal.quantity===250&&meal.unit==="g",meal);
  const recipe={recipe_id:"r1",name:"суп",version:2,yield_value:1000,yield_unit:"g",nutrition_status:"CALCULATED",nutrition:{calories:800,protein:40,fat:20,carbs:120},source:"verified snapshot"};
  const options=nutritionRecipeReferenceOptions_(recipe);
  check("RECIPE-05_VERSION_FROZEN",options.references[0].SOURCE_VERSION==="2"&&options.references[0].SOURCE.indexOf("recipe=r1")>=0,options);
  check("RECIPE-06_PER_100",options.references[0].CALORIES===80&&options.references[0].PROTEIN===4,options.references[0]);
  const candidate=detectDomainFactCandidate_("съел суп 250 г",options);
  check("RECIPE-07_PORTION_CALC",candidate.calculation_status==="CALCULATED"&&candidate.nutrition_calculation.totals.calories===200,candidate);
  const oldOptions=nutritionRecipeReferenceOptions_(Object.assign({},recipe,{version:1,nutrition:{calories:600,protein:30,fat:10,carbs:100}}));
  check("RECIPE-08_NO_RETROACTIVE_RECALC",oldOptions.references[0].CALORIES===60&&options.references[0].CALORIES===80,{old:oldOptions,newer:options});
  const missing=Object.assign({},recipe,{nutrition_status:"MISSING"});
  const missingOptions=nutritionRecipeReferenceOptions_(missing);
  check("RECIPE-09_MISSING_NOT_ZERO",missingOptions.references[0].CALORIES===null&&missingOptions.references[0].PROTEIN===null,missingOptions.references[0]);
  check("RECIPE-10_USER_SCOPE",normalizeNutritionRecipeName_(" Суп «Домашний» ")==="суп домашний",{});
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;return {suite:"NUTRITION_RECIPES",status:passed===tests.length?"PASS":"FAIL",passed:passed,total:tests.length,tests:tests};
}
