'use client'

import { useState, useRef } from 'react'
import { Sparkles, Send } from 'lucide-react'
import { useMarketplaceStore } from '@/store/marketplaceStore'

export default function ConciergeBar() {
  const [input, setInput] = useState('')
  const openConcierge = useMarketplaceStore((s) => s.openConcierge)
  const conciergeOpen = useMarketplaceStore((s) => s.conciergeOpen)
  const inputRef = useRef<HTMLInputElement>(null)

  if (conciergeOpen) return null

  const handleSubmit = () => {
    if (input.trim()) {
      openConcierge(input.trim())
      setInput('')
    } else {
      openConcierge()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <div
        className="bg-gray-900/95 backdrop-blur-xl rounded-full px-6 py-3.5 flex items-center gap-3 shadow-float cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <Sparkles className="w-5 h-5 text-blue-400 animate-pulse shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="מה אתם מחפשים היום? תארו לנו את הפעילות..."
          className="flex-1 bg-transparent text-white placeholder-gray-400 text-right outline-none text-sm"
        />
        <button
          onClick={handleSubmit}
          className="rounded-full bg-brand-500 p-2 hover:bg-brand-600 transition-colors shrink-0"
        >
          <Send className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  )
}
