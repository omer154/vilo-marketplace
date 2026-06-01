import type { ExtractedSource, ImageMediaType } from './types'

/**
 * Wrap an image (photo/scan of a Hebrew price list, flyer, menu, etc.) for the
 * normalizer. Claude reads the image natively (vision) — Hebrew text in the
 * picture is OCR'd by the model itself, so no Tesseract step is needed.
 */
export function extractImage(
  buffer: Buffer,
  label: string,
  mediaType: ImageMediaType
): ExtractedSource {
  return {
    source_type: 'image',
    source_label: label,
    image_buffer: buffer,
    image_media_type: mediaType,
  }
}

/** Map a file extension to a supported image media type, or null if unsupported. */
export function imageMediaType(ext: string): ImageMediaType | null {
  switch (ext.toLowerCase().replace(/^\./, '')) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return null
  }
}
