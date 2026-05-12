import { createClient } from '@supabase/supabase-js'

const MIN_RESULTS_THRESHOLD = 3

export async function POST(req: Request) {
  try {
    const {
      query = '',
      categories = null,
      total_budget = null,
      participants = null,
      location = null,
    } = await req.json()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Smart budget math
    const budgetPerPerson =
      total_budget && participants && participants > 0
        ? Math.floor(total_budget / participants)
        : null

    const cats = categories && categories.length > 0 ? categories : null

    // ── PASS 1: strict search with all filters ────────────────
    const { data: strictData, error: strictError } = await supabase.rpc('search_services', {
      p_query:             query || '',
      p_categories:        cats,
      p_total_budget:      total_budget || null,
      p_budget_per_person: budgetPerPerson,
      p_participants:      participants || null,
      p_location:          location || null,
      p_limit:             60,
    })

    if (strictError) {
      console.error('Supabase RPC error:', strictError)
      return Response.json({ error: strictError.message }, { status: 500 })
    }

    const strictResults = strictData || []

    // If we got enough results, return them directly
    if (strictResults.length >= MIN_RESULTS_THRESHOLD) {
      return Response.json({ results: strictResults, relaxed: false })
    }

    // ── PASS 2: relaxed — drop budget / participants / location ─
    // Only if we actually had filters to relax
    const hadFilters = total_budget || participants || location
    if (!hadFilters) {
      // Nothing to relax — return what we have
      return Response.json({ results: strictResults, relaxed: false })
    }

    const { data: relaxedData, error: relaxedError } = await supabase.rpc('search_services', {
      p_query:             query || '',
      p_categories:        cats,
      p_total_budget:      null,
      p_budget_per_person: null,
      p_participants:      null,
      p_location:          null,
      p_limit:             60,
    })

    if (relaxedError) {
      // Fall back to strict results if relaxed search fails
      return Response.json({ results: strictResults, relaxed: false })
    }

    const relaxedResults = relaxedData || []

    // Merge: strict results first, then relaxed (deduplicated)
    const seenIds = new Set(strictResults.map((r: { id: string }) => r.id))
    const merged = [...strictResults]
    for (const r of relaxedResults) {
      if (!seenIds.has(r.id)) {
        merged.push(r)
        seenIds.add(r.id)
      }
    }

    return Response.json({
      results: merged,
      relaxed: true,
      strictCount: strictResults.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: msg }, { status: 500 })
  }
}
