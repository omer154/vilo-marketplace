import type { ExtractedSource } from './types'

// pdf-parse has no exported types in some versions; use a loose import.
// Lazy require so the dep is only loaded when this extractor runs.
type PdfParse = (buf: Buffer) => Promise<{ text: string; numpages: number }>

export async function extractPdf(
  buffer: Buffer,
  label: string
): Promise<ExtractedSource> {
  const mod = await import('pdf-parse')
  const pdfParse = (mod.default || mod) as unknown as PdfParse
  const result = await pdfParse(buffer)
  return {
    source_type: 'pdf',
    source_label: label,
    raw_text: result.text.trim(),
  }
}
