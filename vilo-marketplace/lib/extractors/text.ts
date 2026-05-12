import type { ExtractedSource } from './types'

export function extractText(content: string, label = 'pasted text'): ExtractedSource {
  return {
    source_type: 'text',
    source_label: label,
    raw_text: content.trim(),
  }
}
