import mammoth from 'mammoth'
import type { ExtractedSource } from './types'

export async function extractDocx(
  buffer: Buffer,
  label: string
): Promise<ExtractedSource> {
  const result = await mammoth.extractRawText({ buffer })
  return {
    source_type: 'docx',
    source_label: label,
    raw_text: result.value.trim(),
  }
}
