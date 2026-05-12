import Anthropic from '@anthropic-ai/sdk'
import { INTENT_EXTRACTION_PROMPT } from '@/lib/anthropic'

export async function POST(req: Request) {
  const { query } = await req.json()

  if (!query || typeof query !== 'string') {
    return Response.json({ error: 'Missing query' }, { status: 400 })
  }

  const client = new Anthropic({ apiKey: process.env.VILO_ANTHROPIC_KEY })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: INTENT_EXTRACTION_PROMPT,
    messages: [{ role: 'user', content: query }],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return Response.json({
        categories: [],
        participants: null,
        total_budget: null,
        location: null,
        free_query: query,
      })
    }
    const intent = JSON.parse(jsonMatch[0])
    return Response.json(intent)
  } catch {
    return Response.json({
      categories: [],
      participants: null,
      total_budget: null,
      location: null,
      free_query: query,
    })
  }
}
