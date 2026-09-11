import "server-only";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_CHARACTERS = 500_000;

export function assertUploadSize(size: number) {
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(`Files must be ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller.`);
  }
}

export function assertExtractedTextSize(text: string) {
  if (text.length > MAX_EXTRACTED_TEXT_CHARACTERS) {
    throw new Error(`The extracted text is too large to process safely (maximum ${MAX_EXTRACTED_TEXT_CHARACTERS.toLocaleString()} characters). Split the source into smaller files.`);
  }
  return text;
}
