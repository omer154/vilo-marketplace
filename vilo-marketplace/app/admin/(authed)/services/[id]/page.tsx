import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ServiceEditForm from './EditForm'
import ActiveToggle from '../../ActiveToggle'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ServiceEditPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('services')
    .select(
      'id, service_name, category_primary, category_secondary, description_short, service_description, price, price_type, price_min, price_max, min_participants, max_participants, duration_minutes, location_mode, notes, is_active, supplier_id, suppliers(name)'
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    notFound()
  }

  const supplierName =
    (data.suppliers as unknown as { name: string } | null)?.name || '—'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/services" className="hover:text-gray-900">
          שירותים
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-gray-900 truncate max-w-md">{data.service_name}</span>
      </div>

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {data.service_name || '(ללא שם)'}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            ספק: <strong className="text-gray-900">{supplierName}</strong>
            {data.category_secondary && (
              <span className="text-gray-500"> · {data.category_secondary}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">פעיל?</span>
          <ActiveToggle table="services" id={data.id} initialActive={data.is_active} />
        </div>
      </div>

      <ServiceEditForm row={data} />
    </div>
  )
}
