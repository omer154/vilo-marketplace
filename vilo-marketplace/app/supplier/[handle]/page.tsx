import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import SupplierProfile from '@/components/marketplace/SupplierProfile'
import type { Service, Supplier } from '@/lib/types'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function load(handle: string) {
  const sb = await createSupabaseServerClient()
  const col = UUID_RE.test(handle) ? 'id' : 'slug'
  const { data: supplier } = await sb.from('suppliers').select('*').eq(col, handle).maybeSingle()
  if (!supplier) return null
  const { data: services } = await sb
    .from('services')
    .select('*')
    .eq('supplier_id', supplier.id)
    .eq('is_active', true)
    .order('category_primary', { ascending: true })
    .order('service_name', { ascending: true })
  return { supplier: supplier as Supplier, services: (services || []) as Service[] }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  const { handle } = await params
  const data = await load(handle)
  if (!data) return { title: 'ספק לא נמצא · Vilo' }
  return {
    title: `${data.supplier.name} · Vilo Marketplace`,
    description: data.supplier.description_short || `השירותים של ${data.supplier.name} במרקטפלייס של Vilo`,
  }
}

export default async function SupplierProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams: Promise<{ edit?: string }>
}) {
  const { handle } = await params
  const { edit } = await searchParams
  const data = await load(handle)
  if (!data) notFound()
  // Editing is enabled only via explicit intent (?edit=1, added by the admin
  // "ערוך בעמוד" link). Plain marketplace links omit it → read-only for everyone.
  return (
    <SupplierProfile
      supplier={data.supplier}
      services={data.services}
      editable={edit === '1'}
    />
  )
}
