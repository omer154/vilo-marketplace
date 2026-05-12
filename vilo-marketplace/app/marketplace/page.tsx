'use client'

import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import CategoryPills from '@/components/marketplace/CategoryPills'
import SupplierGrid from '@/components/marketplace/SupplierGrid'
import ConciergeBar from '@/components/concierge/ConciergeBar'
import ConciergePanel from '@/components/concierge/ConciergePanel'

export default function MarketplacePage() {
  return (
    <div className="min-h-screen">
      <Header />
      <CategoryPills />

      {/* RTL: sidebar RIGHT, content LEFT */}
      <div className="flex flex-row-reverse">
        <aside className="w-64 shrink-0 sticky top-32 h-[calc(100vh-8rem)] overflow-y-auto border-r border-gray-100 bg-white hidden md:block">
          <Sidebar />
        </aside>
        <main className="flex-1 p-6">
          <SupplierGrid />
        </main>
      </div>

      <ConciergeBar />
      <ConciergePanel />
    </div>
  )
}
