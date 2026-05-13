import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { RAG_SYSTEM_PROMPT, buildRAGContext } from '@/lib/anthropic'

// IMPORTANT: nodejs runtime only — edge runtime breaks SSE on Vercel
export const runtime = 'nodejs'
export const maxDuration = 45

/** Quick intent extraction — no LLM call, just pattern matching for Hebrew.
 *  Only uses the LATEST user message for intent (avoids old-turn pollution),
 *  but scans full history for budget/participant data if not in latest. */
function extractIntent(messages: { role: string; content: string }[]) {
  // Use only the last user message for primary intent
  const userMessages = messages.filter((m) => m.role === 'user')
  const latestUserMsg = userMessages[userMessages.length - 1]?.content || ''
  // Full history only for extracting numbers (budget/participants) if missing from latest
  const allText = messages.map((m) => m.content).join(' ')

  // Extract participant count (try latest first, then full history)
  const partMatch =
    latestUserMsg.match(/(\d{1,4})\s*(איש|אנשים|משתתפים|עובדים|חברי|אדם)/) ||
    allText.match(/(\d{1,4})\s*(איש|אנשים|משתתפים|עובדים|חברי|אדם)/)
  const participants = partMatch ? parseInt(partMatch[1]) : null

  // Extract budget (try latest first, then full history)
  const budgetPatterns = [
    /(\d[\d,.]*)\s*(₪|שקל|ש"ח|שח|ש״ח|שקלים)/,
    /(תקציב|budget)[^\d]*(\d[\d,.]*)/,
  ]
  let totalBudget: number | null = null
  for (const pattern of budgetPatterns) {
    const match = latestUserMsg.match(pattern) || allText.match(pattern)
    if (match) {
      const raw = match[1] || match[2]
      totalBudget = parseInt(raw.replace(/[,.]/g, ''))
      break
    }
  }

  // Extract categories from Hebrew keywords (latest message only to avoid stale categories)
  const cats: string[] = []
  const catMap: Record<string, string> = {
    'גיבוש': 'teambuilding', 'טים בילדינג': 'teambuilding', 'טימבילדינג': 'teambuilding',
    'team': 'teambuilding', 'teambuilding': 'teambuilding',
    'וולנס': 'wellbeing', 'בריאות': 'wellbeing', 'רווחה': 'wellbeing', 'ספא': 'wellbeing',
    'מדיטציה': 'wellbeing', 'מיינדפולנס': 'wellbeing', 'wellness': 'wellbeing',
    'למידה': 'learning', 'סדנה': 'learning', 'סדנת': 'learning', 'הרצאה': 'learning',
    'קורס': 'learning', 'וורקשופ': 'learning', 'workshop': 'learning', 'הדרכה': 'learning',
    'אוכל': 'food', 'בישול': 'food', 'שף': 'food', 'קייטרינג': 'food',
    'מסעדה': 'food', 'ארוחה': 'food',
    'תרבות': 'culture', 'יצירה': 'culture', 'אומנות': 'culture', 'מוזיקה': 'culture',
    'ציור': 'culture', 'קרמיקה': 'culture',
    'טיול': 'travel', 'טיולים': 'travel', 'אתגר': 'travel', 'אקסטרים': 'travel',
    'ג\'יפים': 'travel', 'שטח': 'travel',
    'ספורט': 'sport', 'כושר': 'sport', 'יוגה': 'sport',
    'טכנולוגיה': 'tech', 'AI': 'tech', 'הייטק': 'tech', 'דרונים': 'tech',
    'ייעוץ': 'consulting', 'פיתוח': 'consulting', 'אימון': 'consulting', 'קואצ\'ינג': 'consulting',
    // Common Hebrew phrases that map to categories
    'יום כיף': 'teambuilding', 'ימי כיף': 'teambuilding',
    'חדר בריחה': 'teambuilding', 'חדרי בריחה': 'teambuilding',
    'הגנה עצמית': 'sport', 'קרב מגע': 'sport',
    'חוויה': 'teambuilding', 'חווית': 'teambuilding',
    'חגיגה': 'culture', 'מסיבה': 'culture', 'אירוע': 'culture',
  }
  for (const [keyword, cat] of Object.entries(catMap)) {
    if (latestUserMsg.includes(keyword) && !cats.includes(cat)) {
      cats.push(cat)
    }
  }

  // Extract location preference (latest message only)
  let location: string | null = null
  if (latestUserMsg.includes('מחוץ') || latestUserMsg.includes('בחוץ') || latestUserMsg.includes('בשטח')) {
    location = 'remote'
  } else if (latestUserMsg.includes('במשרד') || latestUserMsg.includes('אצלנו') || latestUserMsg.includes('אונליין') || latestUserMsg.includes('בזום')) {
    location = 'onsite'
  }

  // Build search query from latest user message, stripping stop words and punctuation
  const stopWords = new Set([
    'אני', 'את', 'של', 'עם', 'על', 'לא', 'כן', 'גם', 'או', 'אבל',
    'הוא', 'היא', 'הם', 'הן', 'זה', 'זו', 'זאת', 'אלה', 'אלו',
    'מה', 'איך', 'למה', 'כמה', 'מי', 'איפה', 'מתי', 'האם',
    'בערך', 'סביבות', 'משהו', 'איזה', 'איזו',
    'שיכול', 'שיכולה', 'שיכולים', 'לתת', 'להיות', 'לעשות',
    'אמיתית', 'אמיתי', 'בין', 'מגניבה', 'מגניב', 'טוב', 'טובה', 'טובים',
    'ערך', 'היי', 'שלום', 'הי', 'אהלן',
    'רוצה', 'רוצים', 'מחפש', 'מחפשת', 'מחפשים', 'צריך', 'צריכה', 'צריכים',
    'שאני', 'שלי', 'שלנו', 'לנו', 'לי', 'אותו', 'אותה', 'אותם',
    'והתקציב', 'התקציב', 'תקציב', 'בעך',
    'הזה', 'הזאת', 'כל', 'אפשר', 'יש', 'אין', 'עוד', 'כמו', 'כבר',
    'פה', 'שם', 'מאוד', 'ממש', 'רק', 'בבקשה', 'תודה',
    'אחד', 'אחת', 'שני', 'שתי', 'כמה', 'הרבה', 'קצת',
  ])
  // Strip punctuation before filtering
  const cleanText = latestUserMsg.replace(/[?!.,;:"""'`׳״]/g, '')
  const words = cleanText.split(/\s+/).filter(
    (w) => w.length >= 2 && !stopWords.has(w) && !/^\d+$/.test(w)
  )
  const query = words.slice(0, 5).join(' ')

  return { query, categories: cats.length > 0 ? cats : null, totalBudget, participants, location }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    if (!process.env.VILO_ANTHROPIC_KEY) {
      return Response.json({ error: 'Missing ANTHROPIC_API_KEY' }, { status: 500 })
    }

    // Validate messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'No messages provided' }, { status: 400 })
    }

    // Limit conversation history to last 20 messages to prevent token overflow
    const trimmedMessages = messages.slice(-20)

    // Truncate individual messages that are too long (max 2000 chars each)
    for (const msg of trimmedMessages) {
      if (typeof msg.content === 'string' && msg.content.length > 2000) {
        msg.content = msg.content.slice(0, 2000) + '...'
      }
    }

    const client = new Anthropic({ apiKey: process.env.VILO_ANTHROPIC_KEY })

    // ── RAG STEP 1: Extract intent from conversation ──────────────
    const intent = extractIntent(trimmedMessages)

    // ── RAG STEP 2: Retrieve relevant services from DB ────────────
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const budgetPerPerson =
      intent.totalBudget && intent.participants && intent.participants > 0
        ? Math.floor(intent.totalBudget / intent.participants)
        : null

    // Do two searches: one strict (text + category + budget + participants
    // + location), one broad (text only). The broad search intentionally
    // drops the category filter so text-matched services still surface
    // when the regex-based intent extractor and the synced data disagree
    // on the canonical category slug (e.g. user types "סדנה" → 'learning'
    // but the matching services are actually mapped to 'wellbeing').
    const [strictRes, broadRes] = await Promise.all([
      supabase.rpc('search_services', {
        p_query: intent.query,
        p_categories: intent.categories,
        p_total_budget: intent.totalBudget,
        p_budget_per_person: budgetPerPerson,
        p_participants: intent.participants,
        p_location: intent.location,
        p_limit: 15,
      }),
      supabase.rpc('search_services', {
        p_query: intent.query,
        p_categories: null,
        p_total_budget: null,
        p_budget_per_person: null,
        p_participants: null,
        p_location: null,
        p_limit: 20,
      }),
    ])

    const strictServices = strictRes.data || []
    const broadServices = broadRes.data || []

    // Merge and deduplicate
    const seenIds = new Set(strictServices.map((s: { id: string }) => s.id))
    const allServices = [...strictServices]
    for (const s of broadServices) {
      if (!seenIds.has(s.id)) {
        allServices.push(s)
        seenIds.add(s.id)
      }
    }

    // ── FALLBACK: If few results, try category-only search WITHOUT a
    //    category filter (since the intent extractor's category guess
    //    may be wrong for newly-synced services). Returns popular rows
    //    that the concierge can pivot off creatively.
    if (allServices.length < 5 && intent.categories && intent.categories.length > 0) {
      const { data: catFallback } = await supabase.rpc('search_services', {
        p_query: '',
        p_categories: intent.categories,
        p_total_budget: null,
        p_budget_per_person: null,
        p_participants: null,
        p_location: null,
        p_limit: 20,
      })
      for (const s of (catFallback || [])) {
        if (!seenIds.has(s.id)) {
          allServices.push(s)
          seenIds.add(s.id)
        }
      }
    }

    if (allServices.length < 5) {
      // Last resort: popular services across all categories
      const { data: globalFallback } = await supabase.rpc('search_services', {
        p_query: '',
        p_categories: null,
        p_total_budget: null,
        p_budget_per_person: null,
        p_participants: intent.participants,
        p_location: null,
        p_limit: 20,
      })
      for (const s of (globalFallback || [])) {
        if (!seenIds.has(s.id)) {
          allServices.push(s)
          seenIds.add(s.id)
        }
      }
    }

    // ── RAG STEP 3: Build context-enriched prompt ─────────────────
    const ragContext = buildRAGContext(allServices, intent)

    // ── RAG STEP 4: Stream Claude response with real data ─────────
    const encoder = new TextEncoder()

    // Send retrieved service IDs upfront so client can display cards
    const servicePayload = allServices.slice(0, 20)

    // Map regex-intent categories ("teambuilding" etc) onto the same shape
    // the client store uses for filters. Strings only — the client trusts
    // its own CategorySlug type so we don't validate here.
    const intentPayload = {
      query: intent.query || null,
      categories: intent.categories,
      totalBudget: intent.totalBudget,
      participants: intent.participants,
      location: intent.location,
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send retrieved services + parsed intent upfront so client can
          // both display cards AND sync its filter chips to what the AI
          // actually heard.
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ services: servicePayload, intent: intentPayload })}\n\n`
            )
          )

          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            system: RAG_SYSTEM_PROMPT + '\n\n' + ragContext,
            messages: trimmedMessages,
            stream: true,
          })

          let fullText = ''

          for await (const event of response) {
            if (
              event.type === 'content_block_delta' &&
              event.delta &&
              'text' in event.delta
            ) {
              const text = event.delta.text as string
              fullText += text
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
              )
            }
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, full: fullText })}\n\n`
            )
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          console.error('Anthropic streaming error:', msg)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Chat route error:', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
