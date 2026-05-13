import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import SupplierEditForm from './EditForm'
import ActiveToggle from '../../ActiveToggle'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SupplierEditPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('suppliers')
    .select(
      'id, name, name_en, slug, website, contact_email, description_short, logo_url, is_active, services(id, is_active)'
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) notFound()

  const allServices = (data.services as Array<{ id: string; is_active: boolean }>) || []
  const activeCount = allServices.filter((s) => s.is_active).length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/suppliers" className="hover:text-gray-900">
          ספקים
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-gray-900 truncate max-w-md">{data.name}</span>
      </div>

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{data.name}</h1>
          <p className="text-sm text-gray-600 mt-1">
            {activeCount}/{allServices.length} שירותים פעילים ·{' '}
            <Link
              href={`/admin/services?q=${encodeURIComponent(data.name)}`}
              className="text-gray-700 hover:text-gray-900 underline"
            >
              צפה בכל השירותים
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">פעיל?</span>
          <ActiveToggle table="suppliers" id={data.id} initialActive={data.is_active} />
        </div>
      </div>

      <SupplierEditForm row={data} />
    </div>
  )
}
