import type { ExtractedSource } from './types'

/**
 * Pass the PDF buffer straight through to the normalizer. Anthropic's
 * Messages API accepts PDFs as `{ type: 'document' }` content blocks on
 * Sonnet 4.6 and handles text, images, and tables natively — no separate
 * parsing library needed. Replaces the brittle pdf-parse dependency.
 */
export function extractPdf(
  buffer: Buffer,
  label: string
): ExtractedSource {
  return {
    source_type: 'pdf',
    source_label: label,
    pdf_buffer: buffer,
  }
}
