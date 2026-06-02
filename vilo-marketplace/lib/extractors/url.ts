import * as cheerio from 'cheerio'
import type { ExtractedSource } from './types'

// A real browser UA — some sites return empty/blocked responses to bots.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Below this much visible text we assume the page is JS-rendered (an empty
// shell) and fall back to a reader that executes the page's JavaScript.
const THIN_TEXT = 400

/** Plain fetch + readability extraction. Returns '' on any failure. */
async function fetchStatic(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    const $ = cheerio.load(html)
    $('script, style, nav, footer, header, aside, noscript, iframe').remove()
    const main = $('main').first().text() || $('article').first().text() || $('body').text()
    return main.replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

/**
 * Render a JS-heavy page via Jina's reader (r.jina.ai). It runs the page's
 * JavaScript server-side and returns clean text — no API key, no bundled
 * browser. Used only as a fallback when the static HTML is an empty shell.
 */
async function fetchRendered(url: string): Promise<string> {
  try {
    const clean = url.split('#')[0] // fragments are client-only; the reader gets the whole page
    const res = await fetch('https://r.jina.ai/' + clean, {
      headers: { 'User-Agent': BROWSER_UA, 'X-Return-Format': 'text' },
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) return ''
    return (await res.text()).replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

/**
 * Fetch a public URL and return its main textual content. Tries a fast static
 * fetch first; if the page turns out to be JS-rendered (little/no static text),
 * falls back to a JS-executing reader so dynamic sites (Wix, React, etc.) work.
 */
export async function extractUrl(url: string): Promise<ExtractedSource> {
  let text = await fetchStatic(url)

  if (text.length < THIN_TEXT) {
    const rendered = await fetchRendered(url)
    if (rendered.length > text.length) text = rendered
  }

  if (!text || text.length < 30) {
    throw new Error(
      'לא הצלחנו לקרוא תוכן מהאתר (ייתכן שהוא טוען תוכן דינמית או חוסם בקשות). נסו להדביק את הטקסט מהעמוד בתיבת הטקסט.'
    )
  }

  return { source_type: 'url', source_label: url, raw_text: text }
}
