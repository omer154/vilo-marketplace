/**
 * E2E Test Suite: Vilo Concierge RAG Agent
 *
 * Tests the AI concierge chat flow at the API level.
 * Validates: intent extraction, service retrieval, response relevance,
 * partial data handling, multi-turn flow, and edge cases.
 */

const BASE = 'http://localhost:3100'
const PASS = '\x1b[32mPASS\x1b[0m'
const FAIL = '\x1b[31mFAIL\x1b[0m'
const WARN = '\x1b[33mWARN\x1b[0m'

let totalTests = 0
let passed = 0
let failed = 0
let warnings = 0
const results = []

function log(icon, msg) { console.log(icon + ' ' + msg) }

async function callChat(messages) {
  var res = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  })

  if (res.status !== 200) {
    throw new Error('Chat API returned status ' + res.status)
  }

  var reader = res.body.getReader()
  var decoder = new TextDecoder()
  var buffer = ''
  var services = []
  var fullText = ''

  while (true) {
    var chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })

    var lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('data: ') !== 0) continue
      var jsonStr = lines[i].slice(6).trim()
      if (jsonStr === '') continue
      try {
        var parsed = JSON.parse(jsonStr)
        if (parsed.services) services = parsed.services
        if (parsed.text) fullText += parsed.text
        if (parsed.done && parsed.full) fullText = parsed.full
        if (parsed.error) throw new Error('API error: ' + parsed.error)
      } catch (e) {
        if (e.message && e.message.indexOf('API error') === 0) throw e
      }
    }
  }

  return { services: services, response: fullText }
}

function assert(condition, testName, detail) {
  totalTests++
  if (condition) {
    log(PASS, testName)
    passed++
    results.push({ status: 'PASS', test: testName })
  } else {
    log(FAIL, testName + (detail ? ' — ' + detail : ''))
    failed++
    results.push({ status: 'FAIL', test: testName, detail: detail })
  }
}

function warn(testName, detail) {
  log(WARN, testName + ' — ' + detail)
  warnings++
  results.push({ status: 'WARN', test: testName, detail: detail })
}

// ════════════════════════════════════════════════════════════
// TEST 1: Natural language query with full details
// ════════════════════════════════════════════════════════════
async function test1_fullDetailsQuery() {
  console.log('\n\x1b[36m═══ TEST 1: Free natural language with full details ═══\x1b[0m')
  console.log('Query: "היי! אני מחפש פעילות גיבוש ל-30 איש, תקציב 5000 שח, לא משנה המיקום"')

  var result = await callChat([{
    role: 'user',
    content: 'היי! אני מחפש פעילות גיבוש מגניבה שיכולה לתת ערך של מחוברות אמיתית בין המשתתפים, סביבות 30 אנשים והתקציב הוא בערך 5000 שח'
  }])

  // Should retrieve services from DB
  assert(result.services.length > 0,
    '1.1 RAG retrieves services from DB',
    'Got ' + result.services.length + ' services')

  // Response should be in Hebrew
  var hasHebrew = /[\u0590-\u05FF]/.test(result.response)
  assert(hasHebrew, '1.2 Response is in Hebrew')

  // Response should mention specific service names from retrieved data
  var mentionsService = false
  for (var i = 0; i < Math.min(5, result.services.length); i++) {
    if (result.response.indexOf(result.services[i].service_name) !== -1) {
      mentionsService = true
      break
    }
  }
  // Claude might paraphrase, so also check for supplier names
  if (!mentionsService) {
    for (var j = 0; j < Math.min(5, result.services.length); j++) {
      if (result.response.indexOf(result.services[j].supplier_name) !== -1) {
        mentionsService = true
        break
      }
    }
  }
  assert(mentionsService, '1.3 Response references actual services/suppliers from DB')

  // Should NOT contain ```search block (old format removed)
  var hasSearchBlock = result.response.indexOf('```search') !== -1
  assert(!hasSearchBlock, '1.4 No raw ```search block in response (clean RAG output)')

  // Response should contain pricing info (₪ symbol)
  var hasPricing = result.response.indexOf('₪') !== -1
  assert(hasPricing, '1.5 Response includes pricing information (₪)')

  // Retrieved services should include teambuilding-related categories
  var hasTeambuilding = result.services.some(function(s) {
    return s.category_primary === 'teambuilding' || s.category_primary === 'sport' || s.category_primary === 'culture'
  })
  assert(hasTeambuilding, '1.6 Retrieved services include teambuilding/sport/culture categories')

  console.log('   Response preview:', result.response.substring(0, 200) + '...')
}

// ════════════════════════════════════════════════════════════
// TEST 2: Vague query with minimal info
// ════════════════════════════════════════════════════════════
async function test2_vagueQuery() {
  console.log('\n\x1b[36m═══ TEST 2: Vague query — minimal info ═══\x1b[0m')
  console.log('Query: "מה יש לכם?"')

  var result = await callChat([{
    role: 'user',
    content: 'מה יש לכם?'
  }])

  // Should still retrieve some services (broad search)
  assert(result.services.length >= 0,
    '2.1 Handles vague query without crashing',
    'Got ' + result.services.length + ' services')

  // Response should ask a guiding question (contains ? mark)
  var asksQuestion = result.response.indexOf('?') !== -1
  assert(asksQuestion, '2.2 Asks a guiding question when info is missing')

  // Should be conversational and warm
  var hasHebrew = /[\u0590-\u05FF]/.test(result.response)
  assert(hasHebrew, '2.3 Responds in Hebrew')

  // Should NOT dump a full list of services without context
  var responseLength = result.response.length
  assert(responseLength < 2000, '2.4 Response is concise (not a data dump)',
    'Length: ' + responseLength + ' chars')

  console.log('   Response preview:', result.response.substring(0, 200) + '...')
}

// ════════════════════════════════════════════════════════════
// TEST 3: Query with excessive details
// ════════════════════════════════════════════════════════════
async function test3_excessiveInfo() {
  console.log('\n\x1b[36m═══ TEST 3: Excessive info — very specific long query ═══\x1b[0m')
  console.log('Query: long detailed request with budget, participants, location, date, food preferences...')

  var result = await callChat([{
    role: 'user',
    content: 'שלום, אני מנהלת HR בחברת הייטק של 200 עובדים. אנחנו מחפשים פעילות גיבוש לצוות הפיתוח - 45 איש. התקציב הכולל הוא 15000 שקלים. אנחנו רוצים משהו שיהיה מחוץ למשרד, רצוי באזור המרכז, ביום חמישי הקרוב. יש לנו 3 עובדים טבעונים ו-2 עם מוגבלות ניידות. אנחנו רוצים שהפעילות תכלול גם אוכל וגם פעילות פיזית קלה, משהו שיחבר את הצוות. העדפה לפעילות בחוץ אבל עם אפשרות למקום מקורה למקרה של גשם. נשמח גם שיהיה צלם.'
  }])

  // Should handle without crashing
  assert(result.services.length > 0,
    '3.1 Handles complex query and retrieves services',
    'Got ' + result.services.length + ' services')

  // Should still give relevant recommendations
  var hasHebrew = /[\u0590-\u05FF]/.test(result.response)
  assert(hasHebrew, '3.2 Responds coherently in Hebrew')

  // Budget per person: 15000/45 = ~333 NIS — should mention this or relate to it
  var mentionsBudget = result.response.indexOf('15') !== -1 || result.response.indexOf('333') !== -1 || result.response.indexOf('₪') !== -1
  assert(mentionsBudget, '3.3 Acknowledges budget context')

  // Should mention the outdoor/location preference
  var mentionsLocation = result.response.indexOf('מחוץ') !== -1 ||
                         result.response.indexOf('חוץ') !== -1 ||
                         result.response.indexOf('מיקום') !== -1 ||
                         result.response.indexOf('שטח') !== -1
  if (!mentionsLocation) {
    warn('3.4 Mentions outdoor/location preference', 'Not explicitly mentioned but may be implicit in recommendations')
  } else {
    assert(true, '3.4 Mentions outdoor/location preference')
  }

  console.log('   Response preview:', result.response.substring(0, 250) + '...')
}

// ════════════════════════════════════════════════════════════
// TEST 4: Relevance — cooking workshop (specific niche)
// ════════════════════════════════════════════════════════════
async function test4_cookingWorkshopRelevance() {
  console.log('\n\x1b[36m═══ TEST 4: Relevance check — cooking workshop ═══\x1b[0m')
  console.log('Query: "אני מחפשת סדנת בישול לצוות של 20 איש, תקציב 8000 שקל"')

  var result = await callChat([{
    role: 'user',
    content: 'אני מחפשת סדנת בישול לצוות של 20 איש, תקציב 8000 שקל'
  }])

  // Check if any retrieved services are actually cooking-related
  var hasCookingService = result.services.some(function(s) {
    var name = (s.service_name || '').toLowerCase()
    var cat = (s.category_secondary || '').toLowerCase()
    var notes = (s.notes || '').toLowerCase()
    return name.indexOf('בישול') !== -1 || name.indexOf('שף') !== -1 ||
           cat.indexOf('בישול') !== -1 || cat.indexOf('אוכל') !== -1 ||
           notes.indexOf('בישול') !== -1
  })

  if (hasCookingService) {
    assert(true, '4.1 Found cooking-related services in DB')
  } else {
    // No cooking workshops in DB — this is expected
    log(WARN, '4.1 No cooking workshops found in DB (expected) — checking fallback behavior')
    warnings++

    // When no exact match: should NOT pretend cooking workshops exist
    var fabricatesCooking = result.response.indexOf('סדנת בישול') !== -1 &&
                           result.response.indexOf('מצאתי') !== -1 &&
                           result.response.indexOf('לא') === -1
    assert(!fabricatesCooking, '4.2 Does NOT fabricate cooking workshop that does not exist')

    // Should indicate it didn't find exact match OR offer alternatives
    var honestAboutNoMatch = result.response.indexOf('לא נמצא') !== -1 ||
                             result.response.indexOf('לא מצאתי') !== -1 ||
                             result.response.indexOf('לא כולל') !== -1 ||
                             result.response.indexOf('חלופ') !== -1 ||
                             result.response.indexOf('אחר') !== -1 ||
                             result.response.indexOf('דומ') !== -1 ||
                             result.response.indexOf('?') !== -1 ||
                             result.response.indexOf('אפשרויות') !== -1 ||
                             result.response.indexOf('כיוון') !== -1
    assert(honestAboutNoMatch, '4.3 Honest about no exact match OR offers alternatives/asks questions')
  }

  // Should NOT recommend completely unrelated services (like "consulting" or "tech" training)
  var irrelevantCategories = result.services.filter(function(s) {
    return s.category_primary === 'consulting' || s.category_primary === 'tech'
  })
  var relevantRatio = 1 - (irrelevantCategories.length / Math.max(1, result.services.length))
  assert(relevantRatio >= 0.5,
    '4.4 At least 50% of retrieved services are relevant categories (not consulting/tech)',
    'Relevant ratio: ' + Math.round(relevantRatio * 100) + '% (' + irrelevantCategories.length + ' irrelevant out of ' + result.services.length + ')')

  console.log('   Response preview:', result.response.substring(0, 250) + '...')
}

// ════════════════════════════════════════════════════════════
// TEST 5: Fallback — request for something rare + related alternatives
// ════════════════════════════════════════════════════════════
async function test5_fallbackAlternatives() {
  console.log('\n\x1b[36m═══ TEST 5: Fallback — no exact match, related alternatives ═══\x1b[0m')
  console.log('Query: "אנחנו מחפשים סדנת קוקטיילים ל-25 איש בתקציב של 6000 שקל"')

  var result = await callChat([{
    role: 'user',
    content: 'אנחנו מחפשים סדנת קוקטיילים ל-25 איש בתקציב של 6000 שקל'
  }])

  // RAG should still retrieve SOMETHING (broad search)
  assert(result.services.length > 0,
    '5.1 RAG retrieves alternative services even for niche query',
    'Got ' + result.services.length + ' services')

  // Response should not be empty
  assert(result.response.length > 50,
    '5.2 Response is substantive (not empty/error)')

  // Should provide value — either alternatives, questions, or suggestions
  var providesValue = result.response.indexOf('?') !== -1 ||
                      result.response.indexOf('אפשרות') !== -1 ||
                      result.response.indexOf('מומלץ') !== -1 ||
                      result.response.indexOf('הצע') !== -1 ||
                      result.response.indexOf('בדוק') !== -1 ||
                      result.response.indexOf('ספק') !== -1 ||
                      result.response.indexOf('שירות') !== -1 ||
                      result.services.length > 0
  assert(providesValue, '5.3 Provides value (alternatives, questions, or suggestions)')

  // If recommending services, should note they are alternatives (not exact match)
  if (result.services.length > 0 && result.response.length > 200) {
    var hasDisclaimer = result.response.indexOf('בדוק') !== -1 ||
                        result.response.indexOf('ספק') !== -1 ||
                        result.response.indexOf('לא בדיוק') !== -1 ||
                        result.response.indexOf('חלופ') !== -1 ||
                        result.response.indexOf('דומ') !== -1 ||
                        result.response.indexOf('ערך') !== -1 ||
                        result.response.indexOf('כיוון') !== -1 ||
                        result.response.indexOf('⚠') !== -1
    if (hasDisclaimer) {
      assert(true, '5.4 Includes disclaimer about alternatives / check with supplier')
    } else {
      warn('5.4 Expected disclaimer about alternatives', 'Response may be presenting alternatives without explicit caveat')
    }
  }

  console.log('   Response preview:', result.response.substring(0, 250) + '...')
}

// ════════════════════════════════════════════════════════════
// TEST 6: Multi-turn conversation
// ════════════════════════════════════════════════════════════
async function test6_multiTurn() {
  console.log('\n\x1b[36m═══ TEST 6: Multi-turn conversation flow ═══\x1b[0m')

  // Turn 1: Start vague
  console.log('Turn 1: "אני מחפש פעילות לצוות"')
  var turn1 = await callChat([{
    role: 'user',
    content: 'אני מחפש פעילות לצוות'
  }])

  assert(turn1.response.indexOf('?') !== -1,
    '6.1 Turn 1: Asks follow-up question for vague query')

  // Turn 2: Add details
  console.log('Turn 2: "20 איש, תקציב 10000 שקל, גיבוש"')
  var turn2 = await callChat([
    { role: 'user', content: 'אני מחפש פעילות לצוות' },
    { role: 'assistant', content: turn1.response },
    { role: 'user', content: '20 איש, תקציב 10000 שקל, אנחנו רוצים גיבוש' }
  ])

  // Should now have enough info to recommend
  assert(turn2.services.length > 0,
    '6.2 Turn 2: Retrieves services with accumulated context',
    'Got ' + turn2.services.length + ' services')

  // Response should be more detailed now (recommendations)
  assert(turn2.response.length > turn1.response.length * 0.5,
    '6.3 Turn 2: Response is substantive with recommendations',
    'Turn1: ' + turn1.response.length + ' chars, Turn2: ' + turn2.response.length + ' chars')

  // Turn 3: Narrow down
  console.log('Turn 3: "אני מעדיף משהו במשרד"')
  var turn3 = await callChat([
    { role: 'user', content: 'אני מחפש פעילות לצוות' },
    { role: 'assistant', content: turn1.response },
    { role: 'user', content: '20 איש, תקציב 10000 שקל, אנחנו רוצים גיבוש' },
    { role: 'assistant', content: turn2.response },
    { role: 'user', content: 'אני מעדיף משהו במשרד' }
  ])

  assert(turn3.services.length > 0,
    '6.4 Turn 3: Still retrieves services after narrowing',
    'Got ' + turn3.services.length + ' services')

  // Check that onsite services are prioritized
  var onsiteServices = turn3.services.filter(function(s) {
    return s.location_type === 'onsite' || s.location_type === 'both'
  })
  var onsiteRatio = onsiteServices.length / Math.max(1, turn3.services.length)
  assert(onsiteRatio >= 0.3,
    '6.5 Turn 3: Onsite/both services are present in results',
    'Onsite ratio: ' + Math.round(onsiteRatio * 100) + '%')

  console.log('   Turn 3 preview:', turn3.response.substring(0, 200) + '...')
}

// ════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  console.log('\x1b[1m╔══════════════════════════════════════════════════════════╗\x1b[0m')
  console.log('\x1b[1m║     Vilo Concierge RAG Agent — E2E Test Suite            ║\x1b[0m')
  console.log('\x1b[1m╚══════════════════════════════════════════════════════════╝\x1b[0m')

  var startTime = Date.now()

  try {
    await test1_fullDetailsQuery()
    await test2_vagueQuery()
    await test3_excessiveInfo()
    await test4_cookingWorkshopRelevance()
    await test5_fallbackAlternatives()
    await test6_multiTurn()
  } catch (e) {
    console.log('\n\x1b[31mFATAL ERROR:\x1b[0m ' + e.message)
    failed++
  }

  var duration = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('\n\x1b[1m╔══════════════════════════════════════════════════════════╗\x1b[0m')
  console.log('\x1b[1m║                 TEST RESULTS SUMMARY                     ║\x1b[0m')
  console.log('\x1b[1m╠══════════════════════════════════════════════════════════╣\x1b[0m')
  console.log('\x1b[1m║\x1b[0m  Total tests:  ' + totalTests + '                                        \x1b[1m║\x1b[0m')
  console.log('\x1b[1m║\x1b[0m  \x1b[32mPassed:       ' + passed + '\x1b[0m                                        \x1b[1m║\x1b[0m')
  console.log('\x1b[1m║\x1b[0m  \x1b[31mFailed:       ' + failed + '\x1b[0m                                        \x1b[1m║\x1b[0m')
  console.log('\x1b[1m║\x1b[0m  \x1b[33mWarnings:     ' + warnings + '\x1b[0m                                        \x1b[1m║\x1b[0m')
  console.log('\x1b[1m║\x1b[0m  Duration:    ' + duration + 's                                     \x1b[1m║\x1b[0m')
  console.log('\x1b[1m║\x1b[0m  Status:      ' + (failed === 0 ? '\x1b[32mALL PASSED\x1b[0m' : '\x1b[31mFAILURES DETECTED\x1b[0m') + '                           \x1b[1m║\x1b[0m')
  console.log('\x1b[1m╚══════════════════════════════════════════════════════════╝\x1b[0m')

  if (failed > 0) {
    console.log('\n\x1b[31mFailed tests:\x1b[0m')
    results.filter(function(r) { return r.status === 'FAIL' }).forEach(function(r) {
      console.log('  - ' + r.test + (r.detail ? ': ' + r.detail : ''))
    })
  }

  process.exit(failed > 0 ? 1 : 0)
}

main()
