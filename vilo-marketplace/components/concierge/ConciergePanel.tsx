'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X, Send, Coins, Users, ArrowLeft } from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import { useConcierge } from '@/hooks/useConcierge'
import type { Service, PricingUnit, CategorySlug } from '@/lib/types'

const PRICING_UNIT_HE: Record<PricingUnit, string> = {
  person: 'לאדם',
  group: 'לקבוצה',
  hour: 'לשעה',
  project: 'לפרויקט',
  month: 'לחודש',
  unit: 'ליחידה',
}

const CATEGORY_NAMES: Record<CategorySlug, string> = {
  wellbeing: 'וולנס ובריאות',
  teambuilding: 'גיבוש וחברה',
  learning: 'למידה והעשרה',
  food: 'אוכל ואירוח',
  culture: 'תרבות ויצירה',
  travel: 'טיולים ואתגר',
  sport: 'ספורט ופעילות',
  tech: 'טכנולוגיה ו-AI',
  consulting: 'ייעוץ ופיתוח',
}

const GREETING =
  'שלום! אני כאן כדי לעזור לך למצוא את הפעילות המושלמת לצוות שלך \u{1F3AF} ספרו לי — מה המטרה של הפעילות?'

function MiniServiceCard({ service }: { service: Service }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
      <p className="text-sm font-medium text-gray-900 truncate">
        {service.service_name}
      </p>
      <p className="text-xs text-gray-500">{service.supplier_name}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <Coins className="w-3 h-3" />
          {service.price != null ? (
            <>
              <span dir="ltr">
                &#8362;{service.price.toLocaleString('he-IL')}
              </span>
              {service.pricing_unit && (
                <span className="text-gray-400">
                  {PRICING_UNIT_HE[service.pricing_unit]}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-400 italic">מחיר לפי פנייה</span>
          )}
        </div>
        {service.min_participants != null && service.max_participants != null && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Users className="w-3 h-3" />
            {service.min_participants}–{service.max_participants}
          </div>
        )}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 mr-2 p-3">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 bg-gray-400 rounded-full"
          animate={{ y: [0, -6, 0] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  )
}

export default function ConciergePanel() {
  const conciergeOpen = useMarketplaceStore((s) => s.conciergeOpen)
  const closeConcierge = useMarketplaceStore((s) => s.closeConcierge)
  const pendingMessage = useMarketplaceStore((s) => s.pendingMessage)
  const pendingCategory = useMarketplaceStore((s) => s.pendingCategory)
  const { messages, sendMessage, isStreaming } = useConcierge()
  const [input, setInput] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const hasSentPending = useRef(false)

  // Auto-open on first visit
  useEffect(() => {
    const visited = localStorage.getItem('vilo_visited')
    if (!visited) {
      localStorage.setItem('vilo_visited', '1')
      useMarketplaceStore.getState().openConcierge()
    }
  }, [])

  // Handle pending message from ConciergeBar
  useEffect(() => {
    if (conciergeOpen && !hasSentPending.current) {
      if (pendingMessage) {
        hasSentPending.current = true
        sendMessage(pendingMessage)
        useMarketplaceStore.setState({ pendingMessage: '' })
      } else if (pendingCategory) {
        hasSentPending.current = true
        const categoryName = CATEGORY_NAMES[pendingCategory] || pendingCategory
        sendMessage(`אני מחפש פעילות בקטגוריית ${categoryName}`)
        useMarketplaceStore.setState({ pendingCategory: null })
      }
    }
    if (!conciergeOpen) {
      hasSentPending.current = false
    }
  }, [conciergeOpen, pendingMessage, pendingCategory, sendMessage])

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConcierge()
    },
    [closeConcierge]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleShowInMarketplace = () => {
    closeConcierge()
  }

  return (
    <AnimatePresence>
      {conciergeOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 z-40"
            onClick={closeConcierge}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: 460 }}
            animate={{ x: 0 }}
            exit={{ x: 460 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 h-full w-[460px] max-w-full z-50 bg-white shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="bg-brand-900 text-white p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-400" />
                <span className="font-semibold">קונסיירז&apos; AI</span>
              </div>
              <button
                onClick={closeConcierge}
                className="flex items-center gap-1 text-sm text-gray-300 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
                סגור
              </button>
            </div>

            {/* Chat area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Greeting */}
              <div className="flex justify-end">
                <div className="mr-2 bg-blue-50 border border-blue-100 rounded-2xl rounded-tr-sm text-gray-800 max-w-[85%] p-3 text-sm">
                  {GREETING}
                </div>
              </div>

              {/* Messages */}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === 'assistant' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="mr-2 max-w-[85%] space-y-2">
                      <div className="bg-blue-50 border border-blue-100 rounded-2xl rounded-tr-sm text-gray-800 p-3 text-sm whitespace-pre-wrap">
                        {msg.content || (isStreaming ? '' : '...')}
                      </div>

                      {/* Inline service results */}
                      {msg.matchedServices &&
                        msg.matchedServices.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-500 font-medium px-1">
                              מצאתי {msg.matchedServices.length} פעילויות
                              מתאימות:
                            </p>
                            {msg.matchedServices.map((svc) => (
                              <MiniServiceCard key={svc.id} service={svc} />
                            ))}
                            <button
                              onClick={handleShowInMarketplace}
                              className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
                            >
                              הצג את כל התוצאות במרקטפלייס
                              <ArrowLeft className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                    </div>
                  ) : (
                    <div className="ml-2 bg-brand-500 text-white rounded-2xl rounded-tl-sm max-w-[85%] p-3 text-sm self-start">
                      {msg.content}
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {isStreaming && (
                <div className="flex justify-end">
                  <TypingIndicator />
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input area */}
            <div className="bg-gray-50 border-t border-gray-200 p-3 flex items-end gap-2 shrink-0">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="כתבו הודעה..."
                dir="rtl"
                rows={1}
                className="flex-1 resize-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors text-right"
              />
              <button
                onClick={handleSend}
                disabled={isStreaming || !input.trim()}
                className="rounded-full bg-brand-500 p-2.5 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
