import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import suppliersData from '../data/suppliers_data.json'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface RawService {
  service_name: string
  category_primary: string
  category_secondary?: string
  duration_minutes?: number
  price?: number | null
  pricing_unit?: string
  min_participants?: number | null
  max_participants?: number | null
  notes?: string
  location_type?: string
  language?: string
  is_active?: boolean
}

interface RawSupplier {
  name: string
  slug: string
  logo_url?: string | null
  contact_email?: string | null
  description_short?: string | null
  is_active?: boolean
  services: RawService[]
}

async function seed() {
  console.log('Starting seed...\n')

  let totalSuppliers = 0
  let totalServices = 0

  for (const supplier of suppliersData as RawSupplier[]) {
    // Upsert supplier
    const { data: supData, error: supError } = await supabase
      .from('suppliers')
      .upsert(
        {
          name: supplier.name,
          slug: supplier.slug,
          logo_url: supplier.logo_url || null,
          contact_email: supplier.contact_email || null,
          description_short: supplier.description_short || null,
          is_active: supplier.is_active !== false,
        },
        { onConflict: 'slug' }
      )
      .select('id')
      .single()

    if (supError) {
      console.error(`Error upserting supplier ${supplier.name}:`, supError.message)
      continue
    }

    const supplierId = supData.id
    let serviceCount = 0

    for (const svc of supplier.services) {
      const descriptionShort = `${svc.service_name} — ${svc.category_secondary || svc.category_primary}`
      const legacyLocation = svc.location_type || 'onsite'
      const locationMode =
        legacyLocation === 'onsite' ? 'at_client'
        : legacyLocation === 'remote' ? 'remote'
        : legacyLocation === 'both'   ? 'hybrid'
        : null

      const { error: svcError } = await supabase.from('services').upsert(
        {
          supplier_id: supplierId,
          service_name: svc.service_name,
          category_primary: svc.category_primary,
          category_secondary: svc.category_secondary || null,
          description_short: descriptionShort,
          duration_minutes: svc.duration_minutes || null,
          price: svc.price ?? null,
          pricing_unit: svc.pricing_unit || null,
          min_participants: svc.min_participants ?? null,
          max_participants: svc.max_participants ?? null,
          notes: svc.notes || null,
          location_type: legacyLocation,
          location_mode: locationMode,
          language: svc.language || 'he',
          is_active: svc.is_active !== false,
        },
        // Composite tier key created in migration 002 — see services_tier_unique
        { onConflict: 'supplier_id,service_name,min_participants,max_participants' }
      )

      if (svcError) {
        console.error(
          `  Error upserting service "${svc.service_name}":`,
          svcError.message
        )
      } else {
        serviceCount++
      }
    }

    totalSuppliers++
    totalServices += serviceCount
    console.log(`✅ ${supplier.name}: ${serviceCount} שורות`)
  }

  console.log(`\nסה"כ: ${totalSuppliers} ספקים, ${totalServices} שורות שירות`)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
