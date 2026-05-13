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
    const hasTextQuery = typeof query === 'string' && query.trim().length > 0
    const queryWords: string[] = hasTextQuery
      ? (query as string).trim().split(/\s+/).filter((w) => w.length >= 2)
      : []

    // ── PASS 1: strict — all filters applied (categories, budget,
    //   participants, location, and text). Returns the most relevant
    //   in-filter rows first.
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

    // ── PASS 1.5: dedicated supplier-name pass. The RPC's ranking
    //   (ORDER BY) only counts matches in service_name / category_secondary
    //   / description_short — NOT supplier name. So when a user types a
    //   supplier name like "רות גנאל", the actual supplier's services
    //   match the WHERE clause but score 0 in the ranking and get cut
    //   off by the limit. Workaround: find suppliers whose name matches
    //   ALL query words, fetch their active services, prepend to results.
    let supplierMatches: Array<Record<string, unknown>> = []
    if (hasTextQuery && queryWords.length > 0) {
      let supQuery = supabase
        .from('suppliers')
        .select('id, name, logo_url')
        .eq('is_active', true)
      for (const w of queryWords) supQuery = supQuery.ilike('name', `%${w}%`)
      const { data: matchedSuppliers } = await supQuery.limit(10)
      const supplierIds = (matchedSuppliers || []).map((s) => s.id)
      if (supplierIds.length > 0) {
        const supplierById = new Map(
          (matchedSuppliers || []).map((s) => [
            s.id,
            { name: s.name as string, logo_url: (s.logo_url as string | null) ?? null },
          ])
        )
        const { data: svcs } = await supabase
          .from('services')
          .select(
            'id, supplier_id, service_name, category_primary, category_secondary, description_short, price, pricing_unit, min_participants, max_participants, duration_minutes, location_type, location_mode, notes'
          )
          .in('supplier_id', supplierIds)
          .eq('is_active', true)
          .limit(60)
        supplierMatches = (svcs || []).map((s) => {
          const sup = supplierById.get(s.supplier_id as string)
          return {
            ...s,
            supplier_name: sup?.name ?? null,
            supplier_logo_url: sup?.logo_url ?? null,
          }
        })
      }
    }

    // ── PASS 2: ALWAYS run when there's a free-text query. Drops
    //   category / budget / participants / location filters so a
    //   text-matched service (e.g. supplier name like "רות גנאל")
    //   surfaces even when its canonical category isn't in the user's
    //   selected pills.  When there's no text query (just category
    //   browse), we skip Pass 2 — would just return random rows.
    if (!hasTextQuery) {
      return Response.json({ results: strictResults, relaxed: false })
    }

    const { data: relaxedData, error: relaxedError } = await supabase.rpc('search_services', {
      p_query:             query,
      p_categories:        null,
      p_total_budget:      null,
      p_budget_per_person: null,
      p_participants:      null,
      p_location:          null,
      p_limit:             60,
    })

    if (relaxedError) {
      return Response.json({ results: strictResults, relaxed: false })
    }

    const relaxedResults = relaxedData || []

    // Merge order:
    //   1. supplierMatches — services from suppliers whose name matches
    //      the query (highest signal: user typed the supplier's name)
    //   2. strictResults — in-filter ranked matches
    //   3. relaxedResults — text-matched rows from any category
    const seenIds = new Set<string>()
    const merged: Array<Record<string, unknown>> = []
    for (const r of [...supplierMatches, ...strictResults, ...relaxedResults]) {
      const id = (r as { id: string }).id
      if (!seenIds.has(id)) {
        merged.push(r)
        seenIds.add(id)
      }
    }

    const relaxed = merged.length > strictResults.length
    return Response.json({
      results: merged,
      relaxed,
      strictCount: strictResults.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: msg }, { status: 500 })
  }
}
