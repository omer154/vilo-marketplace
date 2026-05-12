import * as cheerio from 'cheerio'
import type { ExtractedSource } from './types'

/**
 * Fetch a public URL and return its main textual content. Strips nav, footer,
 * scripts, styles — heuristic, not perfect.
 */
export async function extractUrl(url: string): Promise<ExtractedSource> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; ViloExtractor/1.0; +https://vilo.local)',
    },
  })
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`)
  }
  const html = await res.text()
  const $ = cheerio.load(html)

  // Drop noise
  $('script, style, nav, footer, header, aside, noscript, iframe').remove()

  // Prefer <main> or <article>, fall back to body
  const main = $('main').first().text() || $('article').first().text() || $('body').text()
  const text = main.replace(/\s+/g, ' ').trim()

  return {
    source_type: 'url',
    source_label: url,
    raw_text: text,
  }
}
