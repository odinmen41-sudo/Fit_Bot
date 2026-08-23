/** C-18H read-only, opt-in AI context quality diagnostics. Not wired into doPost. */
const C18H_CONTEXT_FIELD_REGISTRY = Object.freeze([
  {key: "name", headers: ["имя"], query: /(?:как меня зовут|мо[её] имя)/i},
  {key: "age", headers: ["возраст"], query: /(?:возраст|сколько мне лет)/i, group: "parameters"},
  {key: "height", headers: ["рост"], query: /(?:^|\s)рост(?:\s|$)|какой у меня рост/i, group: "parameters"},
  {key: "start_weight", headers: ["вес старт", "стартовый вес"], query: /стартов[а-яё]* вес/i},
  {key: "current_weight", headers: ["текущий вес", "вес"], query: /(?:текущ[а-яё]* вес|мой вес|сколько я вешу)/i, group: "parameters"},
  {key: "target_weight", headers: ["целевой вес"], query: /целев[а-яё]* вес/i, group: "goals"},
  {key: "goal", headers: ["цель", "основная цель"], query: /цел[ьи](?:\s|[?!.,]|$)|задач/i, group: "goals"},
  {key: "training_level", headers: ["уровень подготовки", "опыт"], query: /(?:уровень подготовки|тренировочн[а-яё]* опыт)/i, group: "training"},
  {key: "training_frequency", headers: ["тренировки в неделю", "частота"], query: /(?:трениров[а-яё]* в неделю|частот[а-яё]* трениров|сколько трениров)/i, group: "training"},
  {key: "calories_target", headers: ["калории цель", "калории"], query: /(?:калори|ккал)/i, group: "nutrition"},
  {key: "protein_target", headers: ["белок цель", "белок"], query: /бел(?:ок|ка|ку|ком)/i, group: "nutrition"}
]);

function auditAiContextQuality_(context, userText, answerText) {
  const delivered = c18hParseDeliveredProfileFields_(context);
  const requested = c18hRequestedFieldKeys_(userText);
  const deliveredKeys = C18H_CONTEXT_FIELD_REGISTRY.map(function(field) {
    return field.key;
  }).filter(function(key) {
    return Object.prototype.hasOwnProperty.call(delivered, key);
  });
  const requiredResponseFields = requested.filter(function(key) {
    return Object.prototype.hasOwnProperty.call(delivered, key);
  });
  const requestedButNotDelivered = requested.filter(function(key) {
    return !Object.prototype.hasOwnProperty.call(delivered, key);
  });
  const reflectedFields = requiredResponseFields.filter(function(key) {
    return c18hFieldReflected_(key, delivered[key], answerText);
  });
  const missingResponseFields = requiredResponseFields.filter(function(key) {
    return reflectedFields.indexOf(key) < 0;
  });
  const notRequestedFields = deliveredKeys.filter(function(key) {
    return requested.indexOf(key) < 0;
  });

  return {
    status: missingResponseFields.length ? "REVIEW" : "PASS",
    delivered_profile_fields: deliveredKeys,
    requested_profile_fields: requested,
    required_response_fields: requiredResponseFields,
    reflected_response_fields: reflectedFields,
    missing_response_fields: missingResponseFields,
    requested_but_not_delivered_fields: requestedButNotDelivered,
    not_requested_fields: notRequestedFields,
    coverage: {
      delivered_count: deliveredKeys.length,
      required_count: requiredResponseFields.length,
      reflected_count: reflectedFields.length
    },
    privacy: {
      stores_user_text: false,
      stores_profile_values: false,
      stores_model_response: false
    }
  };
}

function c18hParseDeliveredProfileFields_(context) {
  const normalizedContext = String(context || "").replace(/^Профиль:\s*/gmi, "");
  const rawFields = {};
  normalizedContext.split(/\n|\s+\|\s+|,\s*/).forEach(function(part) {
    const separator = part.indexOf("=");
    if (separator < 1) return;
    const header = String(part.substring(0, separator) || "").trim().toLowerCase();
    const value = String(part.substring(separator + 1) || "").trim();
    if (header && value && !Object.prototype.hasOwnProperty.call(rawFields, header)) rawFields[header] = value;
  });

  const delivered = {};
  C18H_CONTEXT_FIELD_REGISTRY.forEach(function(field) {
    for (let index = 0; index < field.headers.length; index++) {
      const header = field.headers[index].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(rawFields, header)) {
        delivered[field.key] = rawFields[header];
        break;
      }
    }
  });
  return delivered;
}

function c18hRequestedFieldKeys_(userText) {
  const query = String(userText || "").trim().toLowerCase();
  const groups = {
    parameters: /параметр|данн[а-яё]* о себе|профил/i.test(query),
    goals: /(?:мои|текущие|основные)\s+цели|все\s+цели/i.test(query),
    training: /трениров/i.test(query),
    nutrition: /питан/i.test(query)
  };
  return C18H_CONTEXT_FIELD_REGISTRY.filter(function(field) {
    return field.query.test(query) || Boolean(field.group && groups[field.group]);
  }).map(function(field) {
    return field.key;
  });
}

function c18hFieldReflected_(key, value, answerText) {
  const answer = c18hNormalizeText_(answerText);
  const expected = c18hNormalizeText_(value);
  if (!answer || !expected) return false;
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasValue = new RegExp("(?:^|[^0-9a-zа-яё])" + escaped + "(?:$|[^0-9a-zа-яё])", "i").test(answer);

  if (["name", "goal", "training_level"].indexOf(key) >= 0) return answer.indexOf(expected) >= 0;
  if (key === "age") return hasValue && /(?:лет|год|возраст)/i.test(answer);
  if (key === "height") return hasValue && /(?:см|рост)/i.test(answer);
  if (["start_weight", "current_weight", "target_weight"].indexOf(key) >= 0) {
    return hasValue && /(?:кг|вес)/i.test(answer);
  }
  if (key === "training_frequency") return hasValue && /(?:трениров|раз|недел)/i.test(answer);
  if (key === "calories_target") return hasValue && /(?:ккал|калори)/i.test(answer);
  if (key === "protein_target") return hasValue && /(?:г|белок)/i.test(answer);
  return hasValue;
}

function c18hNormalizeText_(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
}
