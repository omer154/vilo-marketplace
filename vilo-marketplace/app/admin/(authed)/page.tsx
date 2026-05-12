import Link from 'next/link'
import { Database, Package, Upload, History } from 'lucide-react'

export default function AdminHome() {
  const tiles = [
    {
      href: '/admin/services',
      icon: Package,
      title: 'שירותים',
      body: 'ערוך, הוסף או הסתר שירותים. שינויים מופיעים מיידית במרקטפלייס.',
    },
    {
      href: '/admin/suppliers',
      icon: Database,
      title: 'ספקים',
      body: 'נהל פרטי ספקים, לוגואים, ופרטי קשר.',
    },
    {
      href: '/admin/extract',
      icon: Upload,
      title: 'ייבוא ממקור חיצוני',
      body: 'גרור PDF / Word / Excel / קישור לאתר. השורות נכנסות לגיליון Google לאישור.',
    },
    {
      href: '/admin/audit',
      icon: History,
      title: 'שינויים אחרונים',
      body: 'מי עדכן מה, ומתי.',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">ברוך הבא לפאנל הניהול</h1>
        <p className="text-gray-600 text-sm mt-1">
          המקום היחיד שצריך לעדכן בו את הקטלוג. כל שינוי מסונכרן ל-Supabase ומופיע במרקטפלייס.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tiles.map(({ href, icon: Icon, title, body }) => (
          <Link
            key={href}
            href={href}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-400 hover:shadow-sm transition group"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-gray-900 group-hover:text-white transition">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-medium text-gray-900">{title}</h2>
                <p className="text-sm text-gray-600 mt-1">{body}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
