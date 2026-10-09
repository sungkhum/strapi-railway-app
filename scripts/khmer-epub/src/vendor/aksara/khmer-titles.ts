/**
 * Khmer Titles and Honorifics
 *
 * Used to detect proper nouns in text. When we see a pattern like:
 *   [title] [space] [unknown word]
 * the unknown word is likely a proper noun (name) and should NOT
 * be flagged as a spelling error.
 *
 * Examples:
 *   "លោក កូនេលាស" → "កូនេលាស" follows title "លោក", likely a name
 *   "លោកគ្រូ ហ័ដសិន ថេល័រ" → "ហ័ដសិន" and "ថេល័រ" follow title, likely names
 *
 * The spell check plugin uses this to skip spell checking words
 * that follow title patterns (up to 3 words after a title).
 */

import titlesData from './khmer-titles.json'

// All titles loaded from JSON
export const KHMER_TITLES: string[] = titlesData as string[]

// Fast O(1) lookup for checking if a word is a title
export const TITLE_SET = new Set<string>(KHMER_TITLES)

// Sorted by length (longest first) for greedy matching
export const TITLES_BY_LENGTH = [...KHMER_TITLES]
  .sort((a, b) => b.length - a.length)

/**
 * Check if a word is a known Khmer title/honorific.
 * Note: The word should be cleaned (ZWSP removed) before checking.
 */
export function isTitle(word: string): boolean {
  return TITLE_SET.has(word)
}
