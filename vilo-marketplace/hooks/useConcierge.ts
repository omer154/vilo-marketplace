'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useMarketplaceStore } from '@/store/marketplaceStore'
import type { ChatMessage, Service, CategorySlug, LocationType } from '@/lib/types'

function mapRow(row: Record<string, unknown>): Service {
  return {
    id: row.id as string,
    supplier_id: row.supplier_id as string,
    supplier_name: row.supplier_name as string,
    service_name: row.service_name as string,
    category_primary: row.category_primary as CategorySlug,
    category_secondary: row.category_secondary as string | null,
    description_short: row.description_short as string | null,
    price: row.price != null ? Number(row.price) : null,
    pricing_unit: row.pricing_unit as Service['pricing_unit'],
    min_participants: row.min_participants as number | null,
    max_participants: row.max_participants as number | null,
    duration_minutes: row.duration_minutes as number | null,
    location_type: (row.location_type as LocationType) || 'onsite',
    language: 'he',
    tags: null,
    notes: row.notes as string | null,
    is_active: true,
  }
}

interface ChatIntent {
  query?: string
  categories?: CategorySlug[] | null
  totalBudget?: number | null
  participants?: number | null
  location?: LocationType | null
}

export function useConcierge() {
  const [isStreaming, setIsStreaming] = useState(false)
  const chatMessages = useMarketplaceStore((s) => s.chatMessages)
  const addMessage = useMarketplaceStore((s) => s.addMessage)
  const applyAIFilters = useMarketplaceStore((s) => s.applyAIFilters)
  const abortRef = useRef<AbortController | null>(null)

  // Abort any in-flight SSE stream on unmount so we don't keep writing to
  // a stale store after navigation, and we don't leak the fetch + reader.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return

      // 1. Add user message (use crypto.randomUUID to avoid ID collisions)
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.slice(0, 2000), // Limit message length
        timestamp: new Date(),
      }
      addMessage(userMsg)
      setIsStreaming(true)

      // 2. Add empty AI placeholder
      const aiMsgId = crypto.randomUUID()
      addMessage({
        id: aiMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      })

      // 3. Build conversation history for API (keep last 18 messages + current = ~20 max)
      const history = useMarketplaceStore
        .getState()
        .chatMessages.filter(
          (m) => m.role === 'user' || (m.role === 'assistant' && m.content)
        )
        .slice(0, -1) // exclude the empty placeholder
        .slice(-18) // keep only recent history to prevent token overflow
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      // Add current user message
      history.push({ role: 'user', content: text.slice(0, 2000) })

      let retrievedServices: Service[] = []
      let chatIntent: ChatIntent | null = null

      try {
        abortRef.current = new AbortController()
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
          signal: abortRef.current.signal,
        })

        if (!response.ok) throw new Error('Chat request failed')
        if (!response.body) throw new Error('No response body')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let fullText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6).trim()
            if (!jsonStr) continue

            try {
              const parsed = JSON.parse(jsonStr)

              // Handle services payload from RAG pipeline
              if (parsed.services) {
                retrievedServices = (parsed.services as Record<string, unknown>[])
                  .slice(0, 10)
                  .map(mapRow)
              }

              // Server now ships the parsed intent alongside services so the
              // main grid can sync its budget / participants / location
              // filters to what the AI actually heard — not just the
              // categories of the result set.
              if (parsed.intent) {
                chatIntent = parsed.intent as ChatIntent
              }

              if (parsed.text) {
                fullText += parsed.text
                // Update the AI message in store with accumulated text
                const msgs = useMarketplaceStore.getState().chatMessages
                const updated = msgs.map((m) =>
                  m.id === aiMsgId ? { ...m, content: fullText } : m
                )
                useMarketplaceStore.setState({ chatMessages: updated })
              }

              if (parsed.done && parsed.full) {
                // Attach retrieved services to the final message
                if (retrievedServices.length > 0) {
                  const msgs = useMarketplaceStore.getState().chatMessages
                  const updatedMsgs = msgs.map((m) =>
                    m.id === aiMsgId
                      ? { ...m, content: fullText, matchedServices: retrievedServices }
                      : m
                  )
                  useMarketplaceStore.setState({ chatMessages: updatedMsgs })

                  // Apply intent if the server reported one, otherwise fall
                  // back to the union of result-set categories.
                  if (chatIntent) {
                    const intentCats = (chatIntent.categories ?? null) as
                      | CategorySlug[]
                      | null
                    applyAIFilters({
                      categories: intentCats && intentCats.length > 0
                        ? intentCats
                        : (retrievedServices
                            .map((s) => s.category_primary)
                            .filter((v, i, a) => a.indexOf(v) === i) as CategorySlug[]),
                      total_budget: chatIntent.totalBudget ?? null,
                      participants: chatIntent.participants ?? null,
                      location: chatIntent.location ?? null,
                      query: chatIntent.query,
                    })
                  } else {
                    applyAIFilters({
                      categories: retrievedServices
                        .map((s) => s.category_primary)
                        .filter((v, i, a) => a.indexOf(v) === i) as CategorySlug[],
                    })
                  }
                }
              }

              if (parsed.error) {
                console.error('Chat API error:', parsed.error)
                // Drop any retrieved-services cards we'd attached so far —
                // they came from a successful first SSE frame but the
                // Anthropic call after them blew up. Leaving them attached
                // implies the search succeeded, which is misleading.
                retrievedServices = []
                const msgs = useMarketplaceStore.getState().chatMessages
                const updated = msgs.map((m) =>
                  m.id === aiMsgId
                    ? {
                        ...m,
                        content: `מצטער, אירעה שגיאה: ${parsed.error}`,
                        matchedServices: undefined,
                      }
                    : m
                )
                useMarketplaceStore.setState({ chatMessages: updated })
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          const msgs = useMarketplaceStore.getState().chatMessages
          const updated = msgs.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content: 'מצטער, לא הצלחתי להתחבר. אנא נסה שנית.',
                  matchedServices: undefined,
                }
              : m
          )
          useMarketplaceStore.setState({ chatMessages: updated })
        }
      } finally {
        setIsStreaming(false)
      }
    },
    [isStreaming, addMessage, applyAIFilters]
  )

  return { messages: chatMessages, sendMessage, isStreaming }
}
