/**
 * Khmer Text Breaking Utility
 * Uses Beam Search algorithm for word segmentation with frequency dictionary.
 * Also supports Intl.Segmenter as secondary validation when available.
 *
 * Based on Unicode's Khmer orthographic syllable structure:
 * Khmer-syllable ::= (K H)* K M*
 * where K = consonant/independent vowel, H = COENG (្), M = combining marks
 *
 * CRITICAL RULE: You can NEVER break after a COENG (្, U+17D2).
 *
 * VARIANT-AWARE LOOKUP:
 * The dictionary lookup includes fuzzy matching for doubled consonants.
 * When a direct match fails, it tries normalizing doubled consonants (ត្ត → ត)
 * to handle common misspellings. Example: ប្រត្តិកម្ម → ប្រតិកម្ម (dictionary form).
 */

import { KhmerBoundaryTagger } from "./khmer-kcc-tagger"
import { isDebugEnabled, isWordBreakerDebugEnabled } from "./debug"
import { PROTECTED_PHRASES } from "./protected-phrases"
import { PREFIX_MAP, SUFFIX_MAP, PREFIXES_BY_LENGTH, SUFFIXES_BY_LENGTH, type AffixConfig } from "./khmer-affixes"
import { TITLE_SET, TITLES_BY_LENGTH, isTitle } from "./khmer-titles"

const ZWSP = "\u200B"
const WJ = "\u2060" // Word Joiner - prevents breaks

// Connector characters that glue adjacent Khmer tokens together (no break inserted).
// These are character-level joiners (compounds, abbreviations, references).
// Em dash (—) and en dash (–) are excluded — they are clause/range separators
// and should produce separate tokens so spell checking works independently.
// Examples: ៤:២៥-២៦, បុត្រា/ព្រះ, ខ.២១-២៤
const CONNECTOR_CHARS = new Set([
  "-",      // hyphen-minus (U+002D)
  "/",      // slash
  ".",      // period (when between Khmer chars, e.g., ខ.២១)
  ":",      // colon (already handled for digits, now generalized)
])

// Closing punctuation stays with PREVIOUS segment
const CLOSING_PUNCTUATION = new Set([
  "។", // Khmer full stop
  "៕", // Khmer sign phnaek muan (similar to full stop)
  "៖", // Khmer sign camnuc pii kuuh
  "!", // exclamation
  "?", // question
  ")", // closing paren
  "]", // closing bracket
  "}", // closing brace
  "»", // closing guillemet
  "'", // closing single quote (U+2019)
  "›", // closing single guillemet
  '"', // ASCII double quote (U+0022)
  "\u201D", // right double quotation mark (U+201D)
  ",", // comma
  ".", // period
  ":", // colon
  ";", // semicolon
  "៚", // Khmer sign koomuut
  "'", // ASCII apostrophe (U+0027) - used in contractions like "don't"
  "\u2026", // horizontal ellipsis …
  "-", // hyphen-minus (U+002D) - stays with previous segment (e.g., ៣០-៣១)
])

// Opening punctuation stays with NEXT segment
const OPENING_PUNCTUATION = new Set([
  "(", // opening paren
  "[", // opening bracket
  "{", // opening brace
  "«", // opening guillemet
  "'", // opening single quote (U+2018)
  "‹", // opening single guillemet
  '"', // ASCII double quote (U+0022)
  "\u201C", // left double quotation mark (U+201C)
])

class TrieNode {
  children: Map<string, TrieNode>
  isWord: boolean
  frequency: number

  constructor() {
    this.children = new Map()
    this.isWord = false
    this.frequency = 0
  }
}

class KhmerTrie {
  root: TrieNode
  wordCount = 0
  maxWordLength = 0

  constructor() {
    this.root = new TrieNode()
  }

  insert(word: string, frequency = 1) {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode())
      }
      node = node.children.get(char)!
    }
    node.isWord = true
    node.frequency = frequency
    this.wordCount++
    if (word.length > this.maxWordLength) {
      this.maxWordLength = word.length
    }
  }

  /**
   * Reorder mistyped coeng sequences to canonical Unicode order.
   * C + Vowel/Sign + ្ + C → C + ្ + C + Vowel/Sign
   * This preserves string length (same chars, different order).
   */
  reorderCoengs(text: string): string {
    const COENG = "\u17D2"
    let result = ""
    let i = 0

    while (i < text.length) {
      const code_i = text[i].codePointAt(0)!
      const isConsonant_i = code_i >= 0x1780 && code_i <= 0x17a2

      if (isConsonant_i) {
        // Collect any vowels/signs immediately after this consonant
        let j = i + 1
        while (j < text.length) {
          const cj = text[j].codePointAt(0)!
          if ((cj >= 0x17b4 && cj <= 0x17c5) || (cj >= 0x17c6 && cj <= 0x17d1)) {
            j++
          } else {
            break
          }
        }
        const vowelSigns = text.substring(i + 1, j)

        // Check if what follows is COENG + consonant
        if (vowelSigns.length > 0 && j + 1 < text.length && text[j] === COENG) {
          const cAfterCoeng = text[j + 1].codePointAt(0)!
          if (cAfterCoeng >= 0x1780 && cAfterCoeng <= 0x17a2) {
            result += text[i] + COENG + text[j + 1] + vowelSigns
            i = j + 2
            continue
          }
        }
      }

      result += text[i]
      i++
    }

    return result
  }

  /**
   * Collapse doubled consonants: C + ្ + C(same) → C
   * Handles Pali/Sanskrit variant spellings (e.g., ត្ត → ត).
   */
  collapseDoubledConsonants(text: string): string {
    const COENG = "\u17D2"
    let result = ""
    let i = 0

    while (i < text.length) {
      if (i + 2 < text.length) {
        const char1 = text[i]
        const char2 = text[i + 1]
        const char3 = text[i + 2]

        const code1 = char1.codePointAt(0)!
        const code3 = char3.codePointAt(0)!

        if (code1 >= 0x1780 && code1 <= 0x17a2 &&
            char2 === COENG &&
            code3 >= 0x1780 && code3 <= 0x17a2 &&
            char1 === char3) {
          result += char1
          i += 3
          continue
        }
      }

      result += text[i]
      i++
    }

    return result
  }

  /**
   * Normalize Khmer text for variant-aware dictionary lookup.
   * Runs coeng reordering first, then doubled consonant collapsing.
   */
  normalizeForLookup(text: string): string {
    return this.collapseDoubledConsonants(this.reorderCoengs(text))
  }

  /**
   * Tolerant trie traversal that handles doubled consonants.
   * At each C + ្ + C(same), explores both paths: skip (treat as single C)
   * or keep (normal traversal). Returns the longest match found.
   * This selectively skips only the doubled consonants that aren't in the
   * dictionary path, preserving ones that are (e.g., ម្ម in កម្ម).
   */
  findVariantInTrie(text: string): { consumedLength: number; frequency: number } | null {
    const COENG = "\u17D2"
    let bestMatch: { consumedLength: number; frequency: number } | null = null

    // DFS exploring both paths at doubled consonants.
    // Bounded: words ~20 chars max, 1-2 doubled consonants → ~40 states max.
    const explore = (node: TrieNode, pos: number, didSkip: boolean) => {
      if (node.isWord && node.frequency !== 0 && pos > 0) {
        if (didSkip && (!bestMatch || pos > bestMatch.consumedLength)) {
          bestMatch = { consumedLength: pos, frequency: node.frequency }
        }
      }

      if (pos >= text.length) return

      const char = text[pos]
      const code = char.codePointAt(0)!
      const isConsonant = code >= 0x1780 && code <= 0x17a2

      // Check for doubled consonant: C + ្ + C(same)
      if (isConsonant && pos + 2 < text.length &&
          text[pos + 1] === COENG && text[pos + 2] === char) {
        if (node.children.has(char)) {
          // Path A: Skip doubled consonant (consume 3 text chars, advance 1 in trie)
          explore(node.children.get(char)!, pos + 3, true)
          // Path B: Keep it (normal traversal, consume 1 text char)
          explore(node.children.get(char)!, pos + 1, didSkip)
        }
      } else {
        // Normal single-character advancement
        if (node.children.has(char)) {
          explore(node.children.get(char)!, pos + 1, didSkip)
        }
      }
    }

    explore(this.root, 0, false)
    return bestMatch
  }

  /**
   * Find the longest dictionary match starting at position.
   * Falls back to tolerant variant matching for doubled consonants
   * and mis-ordered coeng sequences.
   */
  findLongestMatch(text: string, startIndex: number): { word: string; frequency: number } | null {
    let node = this.root
    let lastMatch: { word: string; frequency: number } | null = null
    let currentWord = ""

    const debugMatches: string[] = []

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i]

      if (!node.children.has(char)) {
        break
      }

      node = node.children.get(char)!
      currentWord += char

      if (node.isWord) {
        // Skip ignored words (frequency set to 0 by addIgnoredWords)
        if (node.frequency !== 0) {
          lastMatch = {
            word: currentWord,
            frequency: node.frequency,
          }
        }
        debugMatches.push(`"${currentWord}" (freq: ${node.frequency})${node.frequency === 0 ? " [IGNORED]" : ""}`)
      }
    }

    // Variant lookup via tolerant trie traversal.
    // At each doubled consonant (C + ្ + C_same), explores both paths:
    // skip (treat as single C) or keep (normal traversal).
    // This correctly handles cases like ប្រត្តិកម្ម → dictionary ប្រតិកម្ម:
    // skips ត្ត (not in dict) but keeps ម្ម (is in dict).
    // Also applies coeng reordering first to fix mis-typed Unicode order.
    const remainingText = text.substring(startIndex)
    if (remainingText.length >= 5 && remainingText.includes("\u17D2")) {
      const reordered = this.reorderCoengs(remainingText)
      const variantResult = this.findVariantInTrie(reordered)

      if (variantResult) {
        // reorderCoengs preserves length, so consumedLength maps directly to original
        const originalWord = remainingText.substring(0, variantResult.consumedLength)

        // Only use variant if it's longer than the direct match
        if (!lastMatch || originalWord.length > lastMatch.word.length) {
          // Reduce frequency to prefer exact matches when available (75% of original frequency)
          const adjustedFrequency = Math.floor(variantResult.frequency * 0.75)

          if (isWordBreakerDebugEnabled()) {
            console.log(
              `[v0] findLongestMatch at pos ${startIndex}: found VARIANT "${originalWord}" (freq: ${variantResult.frequency} → ${adjustedFrequency})${lastMatch ? `, beating direct match "${lastMatch.word}"` : ""}`,
            )
          }

          return {
            word: originalWord,
            frequency: adjustedFrequency,
          }
        }
      }
    }

    // Return direct match if we have one
    if (lastMatch) {
      if (isWordBreakerDebugEnabled()) {
        console.log(
          `[v0] findLongestMatch at pos ${startIndex} in "${text.substring(startIndex, startIndex + 10)}...": found matches: [${debugMatches.join(", ")}], returning: "${lastMatch.word}"`,
        )
      }
      return lastMatch
    }

    if (isWordBreakerDebugEnabled()) {
      console.log(
        `[v0] findLongestMatch at pos ${startIndex} in "${text.substring(startIndex, startIndex + 10)}...": found matches: [${debugMatches.join(", ")}], returning: null`,
      )
    }

    return null
  }

  /**
   * Find ALL dictionary matches starting at position (not just longest).
   * Returns array of { length, frequency } for each match found.
   * Used by beam search to explore multiple segmentation paths.
   *
   * If a match is followed by ៗ (repetition sign), extends the match to include it.
   */
  findAllMatches(
    text: string,
    startIndex: number,
    maxLength: number,
    charSets?: KhmerCharSets,
  ): Array<{ length: number; frequency: number }> {
    const matches: Array<{ length: number; frequency: number }> = []
    let node = this.root
    let currentLength = 0

    for (let i = startIndex; i < text.length && currentLength < maxLength; i++) {
      const char = text[i]

      if (!node.children.has(char)) break
      node = node.children.get(char)!
      currentLength++

      if (node.isWord) {
        let extendedLength = currentLength
        // Check if the next character is ៗ (repetition sign)
        // If so, include it with this word
        if (charSets && i + 1 < text.length && charSets.isRepetitionSign(text[i + 1])) {
          extendedLength = currentLength + 1
        }
        matches.push({ length: extendedLength, frequency: node.frequency })
      }
    }
    return matches
  }

  hasWord(word: string): boolean {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) {
        return false
      }
      node = node.children.get(char)!
    }
    // Skip ignored words (frequency set to 0 by addIgnoredWords)
    return node.isWord && node.frequency !== 0
  }

  getFrequency(word: string): number {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) {
        return 0
      }
      node = node.children.get(char)!
    }
    return node.isWord ? node.frequency : 0
  }

  /**
   * Check if a word exists in the trie, regardless of frequency.
   * Unlike hasWord() which returns false for ignored words (frequency 0),
   * this returns true for ANY word that was inserted, including ignored ones.
   * Used by loadFullDictionaryAsync to avoid overwriting ignored words.
   */
  existsInTrie(word: string): boolean {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) {
        return false
      }
      node = node.children.get(char)!
    }
    return node.isWord
  }
}

export class KhmerCharSets {
  KHMER_BASE_START = 0x1780
  KHMER_BASE_END = 0x17ff
  COENG = "\u17D2"
  BANTOC = "\u17CB" // ់ - Khmer sign BANTOC (final consonant marker)
  REPETITION_SIGN = "\u17D7" // ៗ - Khmer sign LEK TOO (repetition sign)

  consonants: Set<string>
  independentVowels: Set<string>
  dependentVowels: Set<string>
  signs: Set<string>
  combiningMarks: Set<string>
  baseChars: Set<string>

  constructor() {
    this.consonants = new Set()
    for (let i = 0x1780; i <= 0x17a2; i++) {
      this.consonants.add(String.fromCodePoint(i))
    }

    this.independentVowels = new Set()
    for (let i = 0x17a3; i <= 0x17b3; i++) {
      this.independentVowels.add(String.fromCodePoint(i))
    }

    this.dependentVowels = new Set()
    for (let i = 0x17b4; i <= 0x17c5; i++) {
      this.dependentVowels.add(String.fromCodePoint(i))
    }

    this.signs = new Set()
    for (let i = 0x17c6; i <= 0x17d1; i++) {
      this.signs.add(String.fromCodePoint(i))
    }
    // Only include actual combining marks from the upper sign range.
    // U+17D4-U+17DA are punctuation (Po), U+17DB is currency, U+17DC is a letter.
    this.signs.add(String.fromCodePoint(0x17d3)) // BATHAMASAT (Mn)
    this.signs.add(String.fromCodePoint(0x17dd)) // ATTHACAN (Mn)

    this.combiningMarks = new Set([...this.dependentVowels, ...this.signs])
    this.baseChars = new Set([...this.consonants, ...this.independentVowels])
  }

  isKhmerChar(char: string): boolean {
    const code = char.codePointAt(0)!
    return code >= this.KHMER_BASE_START && code <= this.KHMER_BASE_END
  }

  // Khmer digits are ០-៩ (U+17E0 - U+17E9)
  isKhmerDigit(char: string): boolean {
    const code = char.codePointAt(0)!
    return code >= 0x17e0 && code <= 0x17e9
  }

  isBase(char: string): boolean {
    return this.baseChars.has(char)
  }

  isCombiningMark(char: string): boolean {
    return this.combiningMarks.has(char)
  }

  isCoeng(char: string): boolean {
    return char === this.COENG
  }

  isBantoc(char: string): boolean {
    return char === this.BANTOC
  }

  isRepetitionSign(char: string): boolean {
    return char === this.REPETITION_SIGN
  }

  isConsonant(char: string): boolean {
    return this.consonants.has(char)
  }

  /**
   * Check if a token is a "dangling bantoc" pattern.
   * A dangling bantoc is exactly: one consonant followed by ់ (BANTOC).
   * Example: "ស់" - this is almost always a misbreak and should stay with the previous word.
   * In real Khmer, a consonant + ់ is a final consonant marker that belongs to the preceding syllable.
   */
  isDanglingBantoc(token: string): boolean {
    // Must be exactly 2 characters: consonant + bantoc
    if (token.length !== 2) return false
    return this.isConsonant(token[0]) && this.isBantoc(token[1])
  }

  /**
   * Check if a token STARTS with a "dangling bantoc" pattern (consonant + ់).
   * Example: "ស់ប្រិ" starts with "ស់" which is a dangling bantoc.
   * This indicates the break happened incorrectly BEFORE the consonant that should
   * have been the final consonant of the previous word.
   */
  startsWithDanglingBantoc(token: string): boolean {
    if (token.length < 2) return false
    return this.isConsonant(token[0]) && this.isBantoc(token[1])
  }

  /**
   * Check if a token ends with a "dangling dependent vowel" (dependent vowel without
   * a following consonant or sign).
   *
   * In Khmer, dependent vowels typically attach to consonants and are often followed
   * by final consonants, signs, or other marks. A word ending in a bare dependent vowel
   * is linguistically rare and often indicates an incorrect word break.
   *
   * Example: "ផាសុ" ends with ុ (U+17BB) which is suspicious - the correct break is
   * likely "ផា|សុខភាព" not "ផាសុ|ខភាព".
   *
   * Common dangling vowels: ុ ិ ី ួ (short vowels that rarely appear word-finally alone)
   */
  endsWithDanglingVowel(token: string): boolean {
    if (token.length === 0) return false
    const lastChar = token[token.length - 1]

    // Only consider certain dependent vowels that are suspicious when word-final
    // U+17BB (ុ), U+17B7 (ិ), U+17B8 (ី), U+17BD (ួ)
    const danglingVowels = new Set(['\u17BB', '\u17B7', '\u17B8', '\u17BD'])
    return danglingVowels.has(lastChar)
  }

  // Khmer semivowels យ (ya) and វ (va) - these often appear at the end of
  // syllables and can indicate the break point is mid-word if preceded by
  // combining marks
  private static readonly SEMIVOWELS = new Set(['យ', 'វ'])

  /**
   * Check if a character is a Khmer semivowel (យ or វ).
   * These are consonants that often act as glides/semivowels at syllable boundaries.
   */
  isSemivowel(char: string): boolean {
    return KhmerCharSets.SEMIVOWELS.has(char)
  }

  /**
   * Check if character is a dependent vowel or sign (combining mark).
   */
  isDependentMark(char: string): boolean {
    return this.dependentVowels.has(char) || this.signs.has(char)
  }

  /**
   * Check if character is punctuation (Khmer or common).
   * Khmer punctuation: ។ ៕ ៖ ៘ ៙ ៚ (U+17D4-U+17DA, excluding ៗ U+17D7)
   * Note: ៗ (U+17D7) is the repetition sign and is NOT punctuation - it's a suffix
   * that attaches to words (e.g., អ្វីៗ = "things", ផ្សេងៗ = "various")
   */
  isPunctuation(char: string): boolean {
    const code = char.codePointAt(0)!
    // Khmer punctuation range (excluding ៗ repetition sign at U+17D7)
    if (code >= 0x17d4 && code <= 0x17da && code !== 0x17d7) return true
    // Common punctuation
    if ('.,;:!?()[]{}"\'-–—…'.includes(char)) return true
    return false
  }

  /**
   * Find end of syllable starting at index.
   */
  findSyllableEnd(text: string, index: number): number {
    if (index >= text.length) return index

    const char = text[index]

    if (!this.isBase(char)) {
      return index + 1
    }

    let pos = index + 1

    while (pos < text.length) {
      const c = text[pos]

      if (this.isCoeng(c)) {
        if (pos + 1 < text.length && this.isBase(text[pos + 1])) {
          pos += 2
          continue
        } else {
          pos++
          continue
        }
      }

      if (this.isCombiningMark(c)) {
        pos++
        continue
      }

      break
    }

    return pos
  }

  /**
   * Check if position is a valid break point.
   * Implements Unicode-compliant break rules for Khmer:
   * - Never break before combining marks (dependent vowels, signs, etc.)
   * - Never break before or after COENG
   * - Never break before repetition sign (ៗ)
   * - Never break around Word Joiner (U+2060)
   */
  canBreakAt(text: string, index: number): boolean {
    if (index <= 0 || index >= text.length) return false

    const before = text[index - 1]
    const after = text[index]

    // 1) Word Joiner (U+2060) prevents breaking on either side
    if (before === WJ || after === WJ) return false

    // 2) CRITICAL: never break after or before COENG
    if (this.isCoeng(before) || this.isCoeng(after)) return false

    // 3) Never break AFTER samyok sannya (័, U+17D0)
    // Samyok sannya never appears at the end of a word in Khmer.
    // Example: ព័ណ៌នា (describe) — must not break after ័
    if (before === "\u17D0") return false

    // 4) Never break BEFORE repetition sign (ៗ)
    // The repetition sign is a suffix that must attach to the preceding word
    // Example: អ្វីៗ (things), ផ្សេងៗ (various)
    if (this.isRepetitionSign(after)) return false

    // 5) Never break around connector characters (-, /, ., :) between Khmer chars.
    // Examples: ៤:២៥-២៦, បុត្រា/ព្រះ, ខ.២១-២៤
    if (CONNECTOR_CHARS.has(before) && this.isKhmerChar(after)) return false
    if (CONNECTOR_CHARS.has(after) && this.isKhmerChar(before)) return false

    // 6) Unicode LB9: never break BEFORE a combining mark.
    // In Khmer this means dependent vowels, signs, and other marks
    // must stay attached to the previous base/cluster.
    if (this.isCombiningMark(after)) return false

    // 6) Don't break right after a combining mark unless the next char
    // begins a new cluster (is a base), or is whitespace/punctuation.
    // This prevents ugly breaks like "...VOWEL | non-base"
    if (this.isCombiningMark(before) && !this.isBase(after) && !/\s/.test(after) && !this.isPunctuation(after)) {
      return false
    }

    return true
  }

  /**
   * Count syllables in a word
   */
  countSyllables(word: string): number {
    let count = 0
    let pos = 0
    while (pos < word.length) {
      if (this.isKhmerChar(word[pos])) {
        const end = this.findSyllableEnd(word, pos)
        count++
        pos = end
      } else {
        pos++
      }
    }
    return count || 1
  }

  /**
   * Extract Khmer Character Clusters (KCCs) from text.
   * A KCC is the smallest unit that cannot be broken - similar to a grapheme cluster.
   * Returns array of cluster strings.
   *
   * KCC structure: Base (COENG + Consonant)* (DependentVowels | Signs)*
   * Where Base = Consonant | IndependentVowel
   */
  extractClusters(text: string): string[] {
    const clusters: string[] = []
    let pos = 0

    while (pos < text.length) {
      const char = text[pos]

      // Non-Khmer characters are their own "cluster"
      if (!this.isKhmerChar(char)) {
        clusters.push(char)
        pos++
        continue
      }

      // Start of a KCC - must begin with a base character (consonant or independent vowel)
      if (this.isBase(char)) {
        const clusterEnd = this.findSyllableEnd(text, pos)
        clusters.push(text.substring(pos, clusterEnd))
        pos = clusterEnd
      } else {
        // Orphaned combining mark - take it as its own unit
        clusters.push(char)
        pos++
      }
    }

    return clusters
  }
}

function isPunctuation(char: string): boolean {
  return CLOSING_PUNCTUATION.has(char) || OPENING_PUNCTUATION.has(char)
}

export interface DictionaryEntry {
  word: string
  frequency: number
}

/**
 * Tunable segmentation behaviour.
 *
 * These were hand-tuned before there was a way to measure segmentation quality.
 * They are exposed so `scripts/tune-constants.ts` can search them against the
 * gold corpus, and so experiments can toggle a rule without editing the class.
 * Anything changed here must be re-measured with `npm run eval:seg`.
 */
export interface SegmentationConfig {
  /** Paths kept per beam iteration */
  beamWidth: number
  /** Longest dictionary match considered, in JS characters */
  maxWordLen: number
  /** Cost of an unknown token */
  oovPenalty: number
  /** Extra cost when the unknown token is a single cluster */
  oovSingleClusterPenalty: number
  /** Clusters an unknown span may span before it is cut off */
  maxOovClusters: number
  /** Cost of a bare consonant + ់ token, which is almost always a mis-break */
  danglingBantocPenalty: number
  /** Cost of a token ending in a bare short vowel */
  danglingVowelPenalty: number
  /** Cost of breaking before យ/វ that follows a combining mark */
  semivowelBoundaryPenalty: number
  /** Cost per token boundary; the main control on how finely text is split */
  boundaryPenalty: number
  /** Reward per character for longer tokens */
  lengthBonus: number
  /** Reward for a token analysed as a fused compound */
  compoundBonus: number
  /** Frequency a single-cluster match needs before it is trusted as a word */
  minFrequencySingleCluster: number
  /** Frequency a two-cluster match needs before it is trusted as a word */
  minFrequencyTwoCluster: number
  /** Scales the penalty applied to under-frequent two-cluster matches */
  lowFrequencyPenaltyMultiplier: number
  /** Scales the penalty applied to under-frequent single-cluster matches */
  lowFrequencySingleClusterMultiplier: number
  /**
   * Re-join adjacent segments whose concatenation is a dictionary word.
   *
   * This runs after the beam search and overrides it without consulting scores,
   * so it collapses compounds the search deliberately split.
   */
  mergeKnownCompounds: boolean
}

/**
 * Fitted by `scripts/tune-constants.ts` against the dev split of the IDML gold
 * corpus, then confirmed on a held-out book. See docs/segmentation-policy.md.
 *
 * Two values look surprising and are load-bearing:
 *
 *   - `lengthBonus: 0` and a near-zero `boundaryPenalty`. Both existed to stop
 *     the breaker shattering words into syllables, but that job is done properly
 *     by the frequency term and the short-word penalties. Left high, they bias
 *     towards long tokens and glue real compounds together.
 *   - `mergeKnownCompounds: false`. Re-joining any adjacent pair that happens to
 *     be a dictionary entry overrode the search after the fact and was the single
 *     largest source of error, costing about 2.7 points of word F1.
 */
export const DEFAULT_SEGMENTATION_CONFIG: SegmentationConfig = {
  beamWidth: 12,
  maxWordLen: 20,
  oovPenalty: 10.0,
  oovSingleClusterPenalty: 12.0,
  maxOovClusters: 6,
  danglingBantocPenalty: 20.0,
  danglingVowelPenalty: 15.0,
  semivowelBoundaryPenalty: 0,
  boundaryPenalty: 0.25,
  lengthBonus: 0,
  compoundBonus: -2.0,
  minFrequencySingleCluster: 8000,
  minFrequencyTwoCluster: 500,
  lowFrequencyPenaltyMultiplier: 2.0,
  lowFrequencySingleClusterMultiplier: 8.0,
  mergeKnownCompounds: false,
}

export class KhmerBreaker {
  private trie: KhmerTrie
  private charSets: KhmerCharSets
  private useIntlSegmenter: boolean
  private previousUserWords: Set<string> = new Set()
  private tagger: KhmerBoundaryTagger | null = null
  private previousIgnoredWords: Set<string> = new Set()
  /** Frequencies held aside so un-ignoring a word can put it back as it was */
  private ignoredOriginalFrequency: Map<string, number> = new Map()
  /**
   * Bumped whenever the dictionary changes. Consumers that cache segmentation
   * results key on this so a cached paragraph is not reused after the dictionary
   * that produced it has been replaced.
   */
  private _dictionaryVersion = 0

  readonly config: SegmentationConfig

  constructor(
    dictionaryData: DictionaryEntry[] | null = null,
    config: Partial<SegmentationConfig> = {},
  ) {
    this.trie = new KhmerTrie()
    this.charSets = new KhmerCharSets()
    this.useIntlSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
    this.config = { ...DEFAULT_SEGMENTATION_CONFIG, ...config }

    if (dictionaryData) {
      this.loadDictionary(dictionaryData)
    }
  }

  // Track whether full dictionary has been loaded
  private fullDictionaryLoaded = false

  loadDictionary(dictionaryData: DictionaryEntry[]) {
    if (isDebugEnabled()) {
      console.log("[v0] Loading dictionary with", dictionaryData.length, "entries")
    }
    for (const entry of dictionaryData) {
      if (entry.word && entry.word.length > 0) {
        this.trie.insert(entry.word, entry.frequency || 1)
      }
    }
    if (isDebugEnabled()) {
      console.log("[v0] Loaded", this.trie.wordCount, "words into trie")
    }
  }

  /**
   * Asynchronously load the full frequency dictionary from JSON.
   * This supplements the embedded dictionary with additional words.
   * Called after initial page load to avoid blocking rendering.
   *
   * @param url Path to the JSON dictionary (default: /dictionaries/km_frequency_dictionary.json)
   * @returns Promise that resolves when dictionary is loaded
   */
  async loadFullDictionaryAsync(url = '/dictionaries/km_frequency_dictionary.json'): Promise<void> {
    if (this.fullDictionaryLoaded) {
      return // Already loaded
    }

    try {
      if (isDebugEnabled()) {
        console.log("[v0] Fetching full dictionary from", url)
      }

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch dictionary: ${response.status}`)
      }

      const data: Record<string, number> = await response.json()
      const newWords = this.mergeDictionary(data)

      this.fullDictionaryLoaded = true

      if (isDebugEnabled()) {
        console.log("[v0] Full dictionary loaded. Added", newWords, "new words. Total:", this.trie.wordCount)
      }
    } catch (error) {
      console.error("[v0] Failed to load full dictionary:", error)
      // Non-fatal - word breaking will still work with embedded dictionary
    }
  }

  /**
   * Merge additional dictionary entries into the trie.
   *
   * Existing entries always win, so user-ignored words (stored with frequency 0)
   * are never resurrected by a later merge. Kept free of I/O so scripts and tests
   * can supply entries read from disk.
   *
   * @returns how many words were new
   */
  mergeDictionary(data: Record<string, number>): number {
    let newWords = 0
    for (const [word, frequency] of Object.entries(data)) {
      // IMPORTANT: existsInTrie() rather than getFrequency() === 0 — ignored
      // words have frequency 0 but must keep that state.
      if (word && word.length > 0 && !this.trie.existsInTrie(word)) {
        this.trie.insert(word, frequency)
        newWords++
      }
    }
    if (newWords > 0) this._dictionaryVersion++
    return newWords
  }

  /**
   * Check if the full dictionary has been loaded
   */
  isFullDictionaryLoaded(): boolean {
    return this.fullDictionaryLoaded
  }

  /**
   * Whether a word is in the dictionary. Ignored words report false.
   */
  isKnownWord(word: string): boolean {
    return this.trie.hasWord(word)
  }

  /**
   * Dictionary frequency of a word; 0 when absent or ignored.
   *
   * Exposed because a binary known/unknown flag loses real signal: entries the
   * corpus consistently splits are demoted to frequency 1 rather than removed, and
   * a consumer that cannot see the difference treats them as ordinary words.
   */
  wordFrequency(word: string): number {
    return this.trie.getFrequency(word)
  }

  /**
   * Changes every time the dictionary is modified. Cache keys should include it
   * so results computed against an older dictionary are not reused.
   */
  get dictionaryVersion(): number {
    return this._dictionaryVersion
  }

  /**
   * Add user-defined words to the dictionary with high frequency.
   * These words will be prioritized by the word breaker.
   * @param words Array of word strings to add
   * @param frequency The frequency to assign (default: 50000, very high to prioritize)
   */
  addUserWords(words: string[], frequency = 50000): boolean {
    const currentWords = new Set<string>()
    let changed = false

    for (const word of words) {
      const cleanWord = word.trim()
      if (cleanWord && cleanWord.length > 0) {
        currentWords.add(cleanWord)
        if (!this.previousUserWords.has(cleanWord)) changed = true
        this.trie.insert(cleanWord, frequency)
      }
    }

    // Remove words that were in the previous set but not the current one.
    // Reset to frequency 0 so the beam search no longer matches them.
    for (const prevWord of this.previousUserWords) {
      if (!currentWords.has(prevWord)) {
        this.trie.insert(prevWord, 0)
        changed = true
      }
    }

    this.previousUserWords = currentWords
    if (changed) this._dictionaryVersion++
    return changed
  }

  /**
   * Mark words as ignored so the breaker stops treating them as single words,
   * which is how a user splits a word that the master dictionary contains.
   *
   * Ignoring is reversible: the frequency a word had beforehand is remembered, so
   * removing it from the ignored list restores it without reloading the page.
   *
   * @returns whether the ignored set actually changed
   */
  addIgnoredWords(words: string[]): boolean {
    const current = new Set<string>()
    for (const word of words) {
      const cleanWord = word.trim()
      if (cleanWord.length > 0) current.add(cleanWord)
    }

    let changed = false

    for (const word of current) {
      if (this.previousIgnoredWords.has(word)) continue
      if (!this.ignoredOriginalFrequency.has(word)) {
        this.ignoredOriginalFrequency.set(word, this.trie.getFrequency(word))
      }
      this.trie.insert(word, 0) // frequency 0 is the tombstone the beam search skips
      changed = true
    }

    for (const word of this.previousIgnoredWords) {
      if (current.has(word)) continue
      this.trie.insert(word, this.ignoredOriginalFrequency.get(word) ?? 0)
      this.ignoredOriginalFrequency.delete(word)
      changed = true
    }

    this.previousIgnoredWords = current
    if (changed) this._dictionaryVersion++
    return changed
  }

  // ============ Affix-Based Compound Detection ============

  /**
   * Check if a word can be decomposed into a valid compound using known affixes.
   *
   * Returns information about the decomposition if found:
   * - For prefix compounds: prefix + remainder (where remainder is in dictionary)
   * - For suffix compounds: stem + suffix (where stem is in dictionary)
   *
   * Break-point affixes (like អ្នក) indicate the compound should be segmented.
   * Non-break-point affixes indicate it should stay as one unit.
   *
   * @param word The word to check for compound decomposition
   * @returns Compound info if valid, null otherwise
   */
  checkAffixCompound(word: string): {
    type: 'prefix' | 'suffix'
    affix: AffixConfig
    affixText: string
    remainder: string
    remainderFreq: number
    isBreakPoint: boolean
  } | null {
    // Try prefix decomposition (longest prefix first)
    for (const prefixText of PREFIXES_BY_LENGTH) {
      if (word.startsWith(prefixText) && word.length > prefixText.length) {
        const remainder = word.slice(prefixText.length)
        const remainderFreq = this.trie.getFrequency(remainder)

        // Check if remainder is a known dictionary word with sufficient frequency
        // For single-cluster remainders, require higher frequency to prevent spurious compounds
        if (remainderFreq > 0) {
          const remainderClusters = this.charSets.extractClusters(remainder).length
          const minRemainderFreq = remainderClusters === 1 ? 5000 : 0

          if (remainderFreq < minRemainderFreq) {
            // Remainder is too low-frequency for a valid compound
            continue
          }

          const affix = PREFIX_MAP.get(prefixText)!

          if (isWordBreakerDebugEnabled()) {
            console.log(
              `[v0] checkAffixCompound: "${word}" = prefix "${prefixText}" + "${remainder}" (freq: ${remainderFreq}, breakPoint: ${affix.isBreakPoint})`
            )
          }

          return {
            type: 'prefix',
            affix,
            affixText: prefixText,
            remainder,
            remainderFreq,
            isBreakPoint: affix.isBreakPoint,
          }
        }
      }
    }

    // Try suffix decomposition (longest suffix first)
    for (const suffixText of SUFFIXES_BY_LENGTH) {
      if (word.endsWith(suffixText) && word.length > suffixText.length) {
        const stem = word.slice(0, -suffixText.length)
        let stemFreq = this.trie.getFrequency(stem)

        // If exact stem not found, try variant lookup (handles doubled consonants)
        if (stemFreq === 0 && stem.length >= 3 && stem.includes("\u17D2")) {
          const reordered = this.trie.reorderCoengs(stem)
          const variantResult = this.trie.findVariantInTrie(reordered)
          if (variantResult && variantResult.consumedLength === reordered.length) {
            stemFreq = Math.floor(variantResult.frequency * 0.75)
          }
        }

        // Check if stem is a known dictionary word with sufficient frequency
        // For single-cluster stems, require higher frequency to prevent spurious compounds
        // like "ខភាព" (ខ + ភាព) where "ខ" is too low-meaning
        if (stemFreq > 0) {
          const stemClusters = this.charSets.extractClusters(stem).length
          const minStemFreq = stemClusters === 1 ? 5000 : 0

          if (stemFreq < minStemFreq) {
            // Stem is too low-frequency for a valid compound
            continue
          }

          const affix = SUFFIX_MAP.get(suffixText)!

          if (isWordBreakerDebugEnabled()) {
            console.log(
              `[v0] checkAffixCompound: "${word}" = "${stem}" + suffix "${suffixText}" (freq: ${stemFreq}, breakPoint: ${affix.isBreakPoint})`
            )
          }

          return {
            type: 'suffix',
            affix,
            affixText: suffixText,
            remainder: stem,
            remainderFreq: stemFreq,
            isBreakPoint: affix.isBreakPoint,
          }
        }
      }
    }

    return null
  }

  // ============ Title-Based Proper Noun Detection ============

  /**
   * Analyze segmented text to detect likely proper nouns.
   *
   * A word is likely a proper noun if:
   * 1. It follows a known title (like លោក, អ្នកស្រី, etc.)
   * 2. There's whitespace between the title and the word
   * 3. The word is not in the dictionary (unknown/OOV)
   *
   * Example: "លោក កូនេលាស" → "កូនេលាស" is likely a proper noun
   *
   * @param segments Array of segmented text (from getSegments)
   * @returns Set of words that are likely proper nouns
   */
  detectLikelyProperNouns(segments: string[]): Set<string> {
    const likelyProperNouns = new Set<string>()

    for (let i = 0; i < segments.length - 2; i++) {
      const current = segments[i]
      const space = segments[i + 1]
      const next = segments[i + 2]

      // Check pattern: [title] [whitespace] [word]
      if (isTitle(current) && /^\s+$/.test(space)) {
        // Check if the word after the title is unknown (not in dictionary)
        // and is Khmer text (not punctuation, numbers, etc.)
        const nextClean = next.trim()
        if (nextClean && !this.trie.hasWord(nextClean) && this.hasKhmerLetters(nextClean)) {
          likelyProperNouns.add(nextClean)

          if (isWordBreakerDebugEnabled()) {
            console.log(
              `[v0] detectLikelyProperNouns: "${nextClean}" follows title "${current}" - marking as likely proper noun`
            )
          }

          // Also check for multi-part names (e.g., "លោក ហ៊ុន សែន")
          // If the next-next segment is also whitespace + unknown word, it might be part of the name
          if (i + 4 < segments.length) {
            const space2 = segments[i + 3]
            const next2 = segments[i + 4]
            if (/^\s+$/.test(space2)) {
              const next2Clean = next2.trim()
              if (next2Clean && !this.trie.hasWord(next2Clean) && this.hasKhmerLetters(next2Clean)) {
                likelyProperNouns.add(next2Clean)

                if (isWordBreakerDebugEnabled()) {
                  console.log(
                    `[v0] detectLikelyProperNouns: "${next2Clean}" follows title "${current}" (2nd part) - marking as likely proper noun`
                  )
                }
              }
            }
          }
        }
      }
    }

    return likelyProperNouns
  }

  /**
   * Check if a string contains any Khmer letters (not just digits/punctuation)
   */
  private hasKhmerLetters(text: string): boolean {
    for (const char of text) {
      if (this.charSets.isKhmerChar(char) && !this.charSets.isKhmerDigit(char)) {
        return true
      }
    }
    return false
  }

  /**
   * Check if a word is a known title/honorific
   */
  isKnownTitle(word: string): boolean {
    return isTitle(word)
  }

  /**
   * Wrap protected phrases with Word Joiner (WJ) characters to prevent splitting.
   * Only applies if the text doesn't already contain WJ around the phrase.
   */
  private applyProtectedPhrases(text: string): string {
    if (!text || PROTECTED_PHRASES.length === 0) return text

    // Sort longest-first to avoid overlapping issues
    const phrases = [...PROTECTED_PHRASES].sort((a, b) => b.length - a.length)

    let result = text
    for (const phrase of phrases) {
      if (result.includes(phrase)) {
        // Check if already wrapped with WJ
        const wrappedPhrase = WJ + phrase + WJ
        if (!result.includes(wrappedPhrase)) {
          // Wrap the phrase with WJ on both sides to prevent splitting
          result = result.split(phrase).join(wrappedPhrase)
        }
      }
    }
    return result
  }

  /**
   * Replace the boundaries chosen inside runs of Khmer letters with the tagger's.
   *
   * Only decisions strictly inside such a run are revisited. Everything the rest
   * of the pipeline established — punctuation attachment, connector gluing, digit
   * runs, non-Khmer text, and the user's own ZWSP splits, which are already chunk
   * boundaries by the time this runs — is preserved exactly.
   *
   * The frequency model cannot separate ជាមួយ (one word) from ខិតខំ (two): both
   * are pairs of common syllables, and no boundary penalty tells them apart. The
   * tagger learned the distinction from the corpus.
   */
  private applyBoundaryTagger(text: string, segments: string[]): string[] {
    if (!this.tagger || segments.length === 0) return segments

    // Boundaries the pipeline produced, as offsets into `text`.
    const boundaries = new Set<number>()
    let offset = 0
    for (let i = 0; i < segments.length - 1; i++) {
      offset += segments[i].length
      boundaries.add(offset)
    }

    for (const run of this.findKhmerLetterRuns(text)) {
      const clusters = this.charSets.extractClusters(run.text)
      if (clusters.length < 2) continue

      // Offsets of every cluster edge, which are the only positions the tagger
      // can express — and drop the pipeline's opinion about the run's interior.
      const edges: number[] = []
      let edge = run.start
      for (const cluster of clusters) {
        edge += cluster.length
        edges.push(edge)
      }
      for (let position = run.start + 1; position < run.start + run.text.length; position++) {
        boundaries.delete(position)
      }

      const decisions = this.tagger.predict(clusters, this)
      for (let gap = 0; gap < decisions.length; gap++) {
        // isSafeBoundary keeps the tagger from proposing a break that would be
        // invalid Khmer, such as inside a COENG cluster or before ៗ.
        if (decisions[gap] && this.isSafeBoundary(text, edges[gap])) boundaries.add(edges[gap])
      }
    }

    const ordered = [...boundaries].filter((b) => b > 0 && b < text.length).sort((a, b) => a - b)
    const out: string[] = []
    let start = 0
    for (const boundary of ordered) {
      if (boundary > start) out.push(text.slice(start, boundary))
      start = boundary
    }
    if (start < text.length) out.push(text.slice(start))
    return out
  }

  /** Maximal runs of Khmer letters, digits and signs — excludes punctuation. */
  private findKhmerLetterRuns(text: string): Array<{ start: number; text: string }> {
    const runs: Array<{ start: number; text: string }> = []
    let start = -1
    for (let i = 0; i <= text.length; i++) {
      const ch = i < text.length ? text[i] : ""
      const isLetter = ch !== "" && this.charSets.isKhmerChar(ch) && !this.charSets.isPunctuation(ch)
      if (isLetter && start < 0) start = i
      else if (!isLetter && start >= 0) {
        runs.push({ start, text: text.slice(start, i) })
        start = -1
      }
    }
    return runs
  }

  /**
   * Use a trained boundary tagger for decisions inside Khmer runs.
   * Pass null to go back to beam search alone.
   */
  setBoundaryTagger(tagger: KhmerBoundaryTagger | null): void {
    this.tagger = tagger
    this._dictionaryVersion++
  }

  /**
   * Load tagger weights in the background. Failure is non-fatal: segmentation
   * keeps working from the beam search alone.
   */
  async loadBoundaryTaggerAsync(url = "/dictionaries/km_kcc_tagger.json"): Promise<boolean> {
    const tagger = await KhmerBoundaryTagger.load(url)
    if (!tagger) return false
    this.setBoundaryTagger(tagger)
    return true
  }

  /**
   * Merge adjacent segments if their concatenation forms a known dictionary word.
   * This is a "safety net" that fixes cases where segmentation split a compound word.
   * E.g., ["កោត", "ខ្លាច"] -> ["កោតខ្លាច"] if កោតខ្លាច is in the dictionary.
   */
  private mergeKnownCompounds(segments: string[]): string[] {
    if (segments.length <= 1 || !this.config.mergeKnownCompounds) return segments

    const out: string[] = []
    let i = 0

    while (i < segments.length) {
      const seg = segments[i]

      // Don't merge whitespace or punctuation tokens
      if (/^\s+$/.test(seg) || this.isPurelyClosingPunctuation(seg) || this.isPurelyOpeningPunctuation(seg)) {
        out.push(seg)
        i++
        continue
      }

      let best = seg
      let bestJ = i

      // Try merging up to 4 tokens ahead
      let combined = seg
      for (let j = i + 1; j < Math.min(i + 5, segments.length); j++) {
        const next = segments[j]
        // Stop if next is whitespace or punctuation
        if (/^\s+$/.test(next) || this.isPurelyClosingPunctuation(next) || this.isPurelyOpeningPunctuation(next)) {
          break
        }
        combined += next
        if (this.trie.hasWord(combined)) {
          best = combined
          bestJ = j
        }
      }

      out.push(best)
      i = bestJ + 1
    }

    return out
  }

  /**
   * Main segmentation method.
   * Respects existing ZWSP characters as user-defined break points.
   * Respects Word Joiner (WJ) characters to keep words together.
   * Uses Intl.Segmenter if available, otherwise falls back to bidirectional matching.
   */
  getSegments(text: string): string[] {
    if (!text || text.length === 0) return []

    // Pre-process: Remove ZWSP that incorrectly breaks around connector chars between Khmer chars.
    // This fixes cases where previous word-breaking inserted ZWSP in patterns like "២៣:​៨" or "បុត្រា​/​ព្រះ"
    // Khmer range: U+1780-U+17FF
    const cleanedText = text.replace(/([\u1780-\u17FF])([-\/.:\u2013\u2014])\u200B+([\u1780-\u17FF])/g, '$1$2$3')
      .replace(/([\u1780-\u17FF])\u200B+([-\/.:\u2013\u2014])([\u1780-\u17FF])/g, '$1$2$3')

    const userChunks = cleanedText.split(ZWSP)
    const allSegments: string[] = []

    for (const chunk of userChunks) {
      if (!chunk) continue // Skip empty chunks from consecutive ZWSP

      // Post-process each ZWSP-separated chunk independently so that
      // mergeKnownCompounds cannot re-merge segments the user explicitly split.
      const chunkSegments = this.segmentChunk(chunk)
      const connectorMerged = this.mergeConnectors(chunkSegments)
      const punctMerged = this.mergePunctuation(connectorMerged)
      const compoundMerged = this.mergeKnownCompounds(punctMerged)
      allSegments.push(...this.applyBoundaryTagger(chunk, compoundMerged))
    }

    return allSegments
  }

  /**
   * Merge segments connected by connector characters (-, /, ., :).
   * E.g., ["បុត្រា", "/", "ព្រះ"] → ["បុត្រា/ព្រះ"]
   * E.g., ["៤", ":", "២៥"] → ["៤:២៥"]
   */
  private mergeConnectors(segments: string[]): string[] {
    if (segments.length <= 2) return segments

    const result: string[] = []

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]

      // Check if this segment is a lone connector char between other segments
      if (
        segment.length === 1 &&
        CONNECTOR_CHARS.has(segment) &&
        result.length > 0 &&
        i + 1 < segments.length
      ) {
        // Check that previous and next segments contain Khmer chars
        const prev = result[result.length - 1]
        const next = segments[i + 1]
        const prevHasKhmer = [...prev].some(c => isKhmerCodePoint(c.codePointAt(0) || 0))
        const nextHasKhmer = [...next].some(c => isKhmerCodePoint(c.codePointAt(0) || 0))

        if (prevHasKhmer && nextHasKhmer) {
          // Merge: prev + connector + next
          result[result.length - 1] = prev + segment + next
          i++ // Skip next segment (already merged)
          continue
        }
      }

      result.push(segment)
    }

    return result
  }

  /**
   * Merge punctuation with appropriate segments:
   * - Closing punctuation attaches to PREVIOUS segment
   * - Opening punctuation attaches to NEXT segment
   * Simplified since edge punctuation is now handled in segmentChunk
   */
  private mergePunctuation(segments: string[]): string[] {
    if (segments.length <= 1) return segments

    const result: string[] = []

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]

      // Check if this segment is ONLY opening punctuation (standalone)
      if (this.isPurelyOpeningPunctuation(segment)) {
        // Attach to next segment if exists
        if (i + 1 < segments.length) {
          segments[i + 1] = segment + segments[i + 1]
          continue
        }
      }

      // Check if this segment is ONLY closing punctuation (standalone)
      if (this.isPurelyClosingPunctuation(segment)) {
        // Attach to previous segment if exists
        if (result.length > 0) {
          result[result.length - 1] += segment
          continue
        }
      }

      result.push(segment)
    }

    return result
  }

  /**
   * Check if segment is purely opening punctuation (no other content)
   */
  private isPurelyOpeningPunctuation(segment: string): boolean {
    if (!segment || segment.length === 0) return false
    for (const char of segment) {
      if (!OPENING_PUNCTUATION.has(char)) {
        return false
      }
    }
    return true
  }

  /**
   * Check if segment is purely closing punctuation (no other content)
   */
  private isPurelyClosingPunctuation(segment: string): boolean {
    if (!segment || segment.length === 0) return false
    for (const char of segment) {
      if (!CLOSING_PUNCTUATION.has(char)) {
        return false
      }
    }
    return true
  }

  /**
   * Segment a chunk of text (without existing ZWSP).
   * Extract punctuation before segmentation to prevent it from
   * interfering with dictionary lookups, then reattach after.
   * Handle WJ-joined regions as unsplittable units
   * Split by script first - don't break non-Khmer text like English
   */
  private segmentChunk(text: string): string[] {
    const parts = text.split(/(\s+)/)
    const segments: string[] = []

    for (const part of parts) {
      if (!part) continue
      if (/^\s+$/.test(part)) {
        segments.push(part)
        continue
      }

      const scriptRuns = splitByScript(part)

      for (const run of scriptRuns) {
        // Non-Khmer runs (like English) should not be word-broken
        if (!run.isKhmer) {
          segments.push(run.text)
          continue
        }

        // Check if this Khmer run has any actual Khmer characters
        const hasKhmer = [...run.text].some((c) => this.charSets.isKhmerChar(c))
        if (!hasKhmer) {
          segments.push(run.text)
          continue
        }

        const { leading, core, trailing } = this.extractPunctuation(run.text)

        if (!core) {
          // Only punctuation
          if (leading) segments.push(leading)
          if (trailing) segments.push(trailing)
          continue
        }

        // Apply protected phrases before splitting by WJ
        const protectedCore = this.applyProtectedPhrases(core)
        const joinedRegions = this.splitByWJ(protectedCore)
        const coreSegments: string[] = []

        for (const region of joinedRegions) {
          if (region.isJoined) {
            // WJ characters will be preserved in the text for future segmentations
            coreSegments.push(region.text)
          } else {
            // This region has no WJ - segment using beam search for globally optimal result
            const beamSegments = this.beamSegment(region.text)

            // If Intl.Segmenter is available, use it to validate/improve our result
            let finalSegments = beamSegments
            if (this.useIntlSegmenter) {
              try {
                const intlSegments = this.segmentWithIntl(region.text)
                finalSegments = this.improveWithIntlHints(beamSegments, intlSegments, region.text)
              } catch {
                // Fall through to beam search result
              }
            }
            coreSegments.push(...finalSegments)
          }
        }

        // Reattach punctuation to the segmented words for proper line-breaking.
        // Leading punctuation (e.g., «) attaches to the first word.
        // Trailing punctuation (e.g., ») attaches to the last word.
        // Note: Grammar/spell check replacement must handle stripping punctuation.
        if (coreSegments.length > 0) {
          if (leading) {
            coreSegments[0] = leading + coreSegments[0]
          }
          if (trailing) {
            coreSegments[coreSegments.length - 1] += trailing
          }
          segments.push(...coreSegments)
        } else {
          // No segments - just add punctuation
          if (leading) segments.push(leading)
          if (trailing) segments.push(trailing)
        }
      }
    }

    return segments
  }

  /**
   * Split text into regions that are joined (contain WJ) and not joined.
   * WJ is used as bookends: WJ + text + WJ marks a joined region
   */
  private splitByWJ(text: string): Array<{ text: string; isJoined: boolean }> {
    const hasWJ = text.includes(WJ)
    if (isWordBreakerDebugEnabled()) {
      console.log(`[v0] splitByWJ - input: "${text}" (length: ${text.length}, hasWJ: ${hasWJ})`)
    }

    if (!hasWJ) {
      return [{ text, isJoined: false }]
    }

    if (isWordBreakerDebugEnabled()) {
      console.log(`[v0] splitByWJ - WJ detected, processing joined regions`)
    }

    const regions: Array<{ text: string; isJoined: boolean }> = []
    let pos = 0

    while (pos < text.length) {
      const wjStart = text.indexOf(WJ, pos)

      if (wjStart === -1) {
        // No more WJ - rest is non-joined
        if (pos < text.length) {
          const remaining = text.substring(pos)
          if (remaining) {
            if (isWordBreakerDebugEnabled()) {
              console.log(`[v0] splitByWJ - non-joined remainder: "${remaining}"`)
            }
            regions.push({ text: remaining, isJoined: false })
          }
        }
        break
      }

      // Add non-joined text before this WJ
      if (wjStart > pos) {
        const beforeText = text.substring(pos, wjStart)
        if (isWordBreakerDebugEnabled()) {
          console.log(`[v0] splitByWJ - non-joined before: "${beforeText}"`)
        }
        regions.push({ text: beforeText, isJoined: false })
      }

      // Find the closing WJ
      const wjEnd = text.indexOf(WJ, wjStart + 1)

      if (wjEnd === -1) {
        // No closing WJ - treat rest as joined (backwards compatibility)
        const joinedText = text.substring(wjStart)
        if (isWordBreakerDebugEnabled()) {
          console.log(`[v0] splitByWJ - joined (no end marker): "${joinedText}"`)
        }
        regions.push({ text: joinedText, isJoined: true })
        break
      }

      // Extract the joined region (including the WJ bookends for preservation)
      const joinedText = text.substring(wjStart, wjEnd + 1)
      if (isWordBreakerDebugEnabled()) {
        console.log(`[v0] splitByWJ - joined region: "${joinedText}"`)
      }
      regions.push({ text: joinedText, isJoined: true })

      pos = wjEnd + 1
    }

    return regions
  }

  /**
   * Use Intl.Segmenter for word segmentation
   */
  private segmentWithIntl(text: string): string[] {
    const segmenter = new Intl.Segmenter("km", { granularity: "word" })
    const segments: string[] = []

    for (const { segment, isWordLike } of segmenter.segment(text)) {
      if (isWordLike || segment.trim()) {
        segments.push(segment)
      }
    }

    return segments
  }

  /**
   * Improve beam search segments with Intl.Segmenter hints.
   * Beam search takes priority, but Intl can help with unknown words.
   */
  private improveWithIntlHints(beamSegments: string[], intlSegments: string[], originalText: string): string[] {
    // If beam search produced good results (mostly known words), use them
    const knownWordCount = beamSegments.filter((s) => this.trie.hasWord(s)).length
    const knownWordRatio = knownWordCount / beamSegments.length

    // If most segments are known dictionary words, trust beam search
    if (knownWordRatio >= 0.5) {
      return beamSegments
    }

    // Special case: if beam search kept Khmer digit:digit patterns together but Intl split them,
    // prefer beam search result for these patterns
    // Pattern matches: digits:digits OR digits: (for mid-typing scenarios)
    const khmerDigitColonPattern = /^[\u17E0-\u17E9]+:[\u17E0-\u17E9]*$/
    if (beamSegments.length === 1 && khmerDigitColonPattern.test(beamSegments[0])) {
      return beamSegments
    }

    // Also check if ANY beam segment contains this pattern - if so, preserve the beam results
    // to avoid Intl.Segmenter splitting these patterns incorrectly
    const hasDigitColonPattern = beamSegments.some(seg => khmerDigitColonPattern.test(seg))
    if (hasDigitColonPattern) {
      return beamSegments
    }

    // Otherwise, try to use Intl segments but validate against dictionary
    return this.validateAndMergeSegments(intlSegments)
  }

  /**
   * Validate segments against dictionary and merge where possible.
   * This corrects bad Intl.Segmenter splits by combining adjacent segments
   * that form known dictionary words.
   */
  private validateAndMergeSegments(segments: string[]): string[] {
    if (segments.length <= 1) return segments

    // First pass: merge any dangling bantoc tokens with their preceding segment
    // This is a safety net in case beam search still produces them
    // Also handles tokens that START with dangling bantoc (like "ស់ប្រិ")
    const merged: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]

      // If this is or starts with a dangling bantoc (consonant + ់) and not a known word,
      // merge it with the previous segment
      const hasDanglingBantoc = this.charSets.isDanglingBantoc(seg) || this.charSets.startsWithDanglingBantoc(seg)
      if (hasDanglingBantoc && !this.trie.hasWord(seg) && merged.length > 0) {
        merged[merged.length - 1] += seg
      } else {
        merged.push(seg)
      }
    }

    // Second pass: try to find longer dictionary matches
    const result: string[] = []
    let i = 0

    while (i < merged.length) {
      // Try to find the longest dictionary match by combining consecutive segments
      let bestMatch = merged[i]
      let bestMatchLen = 1
      let combined = merged[i]

      // Try combining with next segments (up to 4 ahead for compound words)
      for (let j = i + 1; j < Math.min(i + 5, merged.length); j++) {
        combined += merged[j]

        if (this.trie.hasWord(combined)) {
          bestMatch = combined
          bestMatchLen = j - i + 1
        }
      }

      // Use the best match found
      result.push(bestMatch)
      i += bestMatchLen
    }

    return result
  }

  // Scoring constants live in SegmentationConfig so they can be tuned and measured.

  /**
   * Check if a position is a safe token boundary.
   * End-of-text is always safe; otherwise delegate to canBreakAt.
   */
  private isSafeBoundary(text: string, endIndex: number): boolean {
    if (endIndex <= 0 || endIndex >= text.length) return true
    return this.charSets.canBreakAt(text, endIndex)
  }

  /**
   * Extend a position past trailing combining marks to find a valid boundary.
   *
   * When a dictionary match ends right before a combining mark (dependent vowel,
   * sign, etc.), the combining mark belongs to the matched word — it attaches to
   * the last cluster's base consonant. The dictionary entry may simply omit it.
   *
   * Example: dictionary has "ពិនិត្យ" (7 chars) but the text has "ពិនិត្យេ" (8 chars)
   * where org org (dependent vowel) belongs to the ត org org org cluster. We extend the match
   * to include org org, giving a valid boundary after it.
   *
   * Returns the extended position if a valid boundary is found, or -1 if not.
   */
  private extendPastCombiningMarks(text: string, pos: number): number {
    const endPos = text.length
    if (pos >= endPos) return pos

    // Only extend if the current position is blocked by a combining mark
    if (this.isSafeBoundary(text, pos)) return pos

    let extended = pos
    // Walk past combining marks (dependent vowels, signs) and any COENG+consonant sequences
    while (extended < endPos) {
      const ch = text[extended]
      if (this.charSets.isCombiningMark(ch) || this.charSets.isCoeng(ch) || this.charSets.isRepetitionSign(ch)) {
        extended++
        // After COENG, also consume the subscript consonant
        if (this.charSets.isCoeng(ch) && extended < endPos && this.charSets.isBase(text[extended])) {
          extended++
        }
      } else {
        break
      }
    }

    // Check if the extended position is a valid boundary
    if (extended > pos && this.isSafeBoundary(text, extended)) {
      return extended
    }

    return -1 // No valid boundary found
  }

  // Maximum number of clusters to consume in an OOV chunk before forcing a break

  /**
   * Find the end of an OOV (out-of-vocabulary) chunk starting at position.
   * Instead of consuming just one cluster, consume multiple clusters until:
   * - We hit whitespace or punctuation
   * - We find a "strong start" of a known dictionary word
   * - We hit the maximum cluster limit
   *
   * This prevents over-splitting of unknown words like names, technical terms,
   * and transliterations (e.g., "វ៉កគ័រ" for "Walker" should stay as one chunk).
   */
  private findOovChunkEnd(text: string, start: number): number {
    const endPos = text.length
    let pos = start

    // Always consume at least one cluster
    pos = this.charSets.findSyllableEnd(text, pos)
    if (pos <= start) pos = start + 1

    // Ensure we're at a safe boundary after the first cluster
    while (pos < endPos && !this.isSafeBoundary(text, pos)) {
      pos++
    }

    let clusters = 1

    while (pos < endPos) {
      const ch = text[pos]

      // Stop at whitespace
      if (/\s/.test(ch)) break

      // Stop at punctuation
      if (this.charSets.isPunctuation(ch)) break

      // Stop if we can break here and there's a strong known word starting here
      // BUT don't stop if there's a longer dictionary word starting at `start` that
      // crosses this boundary - that would indicate we're in the middle of a valid word
      if (this.charSets.canBreakAt(text, pos)) {
        // Check if any dictionary word starting at `start` extends past `pos`
        // If so, we shouldn't break here because we'd be cutting that word short
        const maxLen = Math.min(this.config.maxWordLen, endPos - start)
        const crossBoundaryMatches = this.trie.findAllMatches(text, start, maxLen)
        const hasCrossingWord = crossBoundaryMatches.some(m => {
          const wordEnd = start + m.length
          // Word crosses this position AND ends at a safe boundary
          return wordEnd > pos && this.isSafeBoundary(text, wordEnd)
        })

        if (!hasCrossingWord) {
          const match = this.trie.findLongestMatch(text, pos)
          if (match && this.isSignificantWord(match)) {
            const matchEnd = pos + match.word.length
            // Verify the match ends at a valid boundary
            if (matchEnd >= endPos || this.charSets.canBreakAt(text, matchEnd)) {
              break // Found a significant known word, stop here
            }
          }
        }
      }

      // Otherwise extend by another cluster
      const nextPos = this.charSets.findSyllableEnd(text, pos)
      if (nextPos > pos) {
        pos = nextPos
      } else {
        pos++
      }

      // Ensure we end at a safe boundary
      while (pos < endPos && !this.isSafeBoundary(text, pos)) {
        pos++
      }

      clusters++

      // Don't consume too many clusters - force a break at max
      if (clusters >= this.config.maxOovClusters) break
    }

    return pos
  }

  /**
   * Beam search segmentation algorithm.
   * Explores multiple segmentation paths and keeps the top N best ones.
   *
   * Simpler than full Viterbi but captures most of its benefit.
   * Key insight: greedy fails when you need to look 2-4 words ahead.
   */
  private beamSegment(text: string): string[] {
    if (!text || text.length === 0) return []

    const endPos = text.length

    // Pieces are held as a backwards-linked list shared between states rather than
    // a per-candidate array copy. Copying made expanding a state O(tokens so far),
    // so segmenting one paragraph cost O(n^2) allocations.
    type PieceNode = { piece: string; prev: PieceNode | null }
    type BeamState = { pos: number; score: number; tail: PieceNode | null; count: number }

    const extend = (s: BeamState, pos: number, score: number, piece: string): BeamState => ({
      pos,
      score,
      tail: { piece, prev: s.tail },
      count: s.count + 1,
    })

    const materialise = (state: BeamState | undefined): string[] => {
      const out: string[] = []
      for (let node = state?.tail ?? null; node !== null; node = node.prev) out.push(node.piece)
      return out.reverse()
    }

    let states: BeamState[] = [{ pos: 0, score: 0, tail: null, count: 0 }]

    while (states.length > 0) {
      // If every state finished, break
      if (states.every(s => s.pos >= endPos)) break

      const nextStates: BeamState[] = []

      for (const s of states) {
        if (s.pos >= endPos) {
          nextStates.push(s)
          continue
        }

        const ch = text[s.pos]

        // Handle whitespace as its own token
        if (ch === ' ' || ch === '\t' || ch === '\n') {
          nextStates.push(extend(s, s.pos + 1, s.score, ch))
          continue
        }

        // Handle Khmer digit runs (including connector-separated patterns like ៤:២៥-២៦, ខ.២១-២៤)
        if (this.charSets.isKhmerDigit(ch)) {
          let runEnd = s.pos + 1
          while (runEnd < endPos) {
            const nextCh = text[runEnd]
            if (this.charSets.isKhmerDigit(nextCh)) {
              runEnd++
            } else if (CONNECTOR_CHARS.has(nextCh)) {
              // Connector after Khmer digit - check if followed by another Khmer digit
              if (runEnd + 1 < endPos && this.charSets.isKhmerDigit(text[runEnd + 1])) {
                runEnd++
              } else if (runEnd + 1 >= endPos) {
                // Connector at end of text - keep with digits to prevent break insertion
                runEnd++
                break
              } else {
                break
              }
            } else {
              break
            }
          }
          nextStates.push(extend(s, runEnd, s.score, text.slice(s.pos, runEnd)))
          continue
        }

        // Handle punctuation as its own token
        if (this.charSets.isPunctuation(ch)) {
          nextStates.push(extend(s, s.pos + 1, s.score, ch))
          continue
        }

        // Handle non-Khmer characters (Latin, numbers, etc.)
        if (!this.charSets.isKhmerChar(ch)) {
          // Consume entire non-Khmer run
          let runEnd = s.pos + 1
          while (runEnd < endPos && !this.charSets.isKhmerChar(text[runEnd]) &&
                 text[runEnd] !== ' ' && !this.charSets.isPunctuation(text[runEnd])) {
            runEnd++
          }
          nextStates.push(extend(s, runEnd, s.score, text.slice(s.pos, runEnd)))
          continue
        }

        // Khmer text - find dictionary matches
        const maxLen = Math.min(this.config.maxWordLen, endPos - s.pos)
        const matches = this.trie.findAllMatches(text, s.pos, maxLen, this.charSets)

        // Also try variant matching (handles doubled consonants, coeng reordering)
        const remainingForVariant = text.substring(s.pos)
        if (remainingForVariant.length >= 5 && remainingForVariant.includes("\u17D2")) {
          const reordered = this.trie.reorderCoengs(remainingForVariant)
          const variantResult = this.trie.findVariantInTrie(reordered)
          if (variantResult) {
            const longestDirect = matches.length > 0 ? Math.max(...matches.map(m => m.length)) : 0
            if (variantResult.consumedLength > longestDirect) {
              const adjustedFreq = Math.floor(variantResult.frequency * 0.75)
              matches.push({ length: variantResult.consumedLength, frequency: adjustedFreq })
            }
          }
        }

        // Build candidate tokens
        // segments?: string[] allows a single candidate to produce multiple output pieces
        // (used for break-point compounds like អ្នក + ចំរorg)
        const candidates: Array<{ len: number; score: number; segments?: string[] }> = []

        // Add dictionary matches as candidates (only if they end at safe boundaries)
        for (const m of matches) {
          let end = s.pos + m.length

          // Skip ignored words (frequency set to 0 by addIgnoredWords)
          if (m.frequency === 0) {
            continue
          }

          // If the match ends at an illegal boundary, try extending past trailing
          // combining marks. A combining mark after a dictionary word's last cluster
          // belongs to that word (e.g., dictionary has "ពorg org org org org org org" but text has
          // "ពorg org org org org org org org" — the org org belongs to the ត org org org cluster).
          if (!this.isSafeBoundary(text, end)) {
            const extended = this.extendPastCombiningMarks(text, end)
            if (extended < 0) {
              continue // No valid boundary found even after extension
            }
            end = extended
          }

          // Get the actual word (including any extended combining marks)
          const word = text.slice(s.pos, end)
          const len = end - s.pos

          // When a match was extended past combining marks, the original dictionary
          // frequency may be inflated. E.g. "បង" (freq 27466) extended to "បង្រorg org org org org org"
          // — the extended word is NOT "បorg org" so using freq 27466 is wrong.
          // Use the extended word's actual trie frequency if available, else cap it.
          let freq = m.frequency
          if (len > m.length) {
            const extendedFreq = this.trie.getFrequency(word)
            freq = extendedFreq > 0 ? extendedFreq : Math.min(freq, 10)
          }

          // Calculate penalty for short low-frequency words
          // This replaces the hard gate of isSignificantWord with a soft penalty
          const penalty = this.shortWordPenalty(word, freq)

          // Skip if penalty is infinite (single-cluster below threshold)
          if (!Number.isFinite(penalty)) {
            continue
          }

          let sc = Math.log((freq || 1) + 1)
          sc += this.config.lengthBonus * len
          sc -= this.config.boundaryPenalty
          sc -= penalty // Apply frequency-based penalty for short words
          candidates.push({ len, score: sc })
        }

        // FIRST: Check for affix-based compounds BEFORE determining OOV chunk
        // This is important because findOovChunkEnd may stop at a boundary between
        // prefix and remainder (since the remainder is a dictionary word), but we
        // want to detect the compound as a whole.
        //
        // Try progressively shorter strings to find the longest valid compound
        let compound: ReturnType<typeof this.checkAffixCompound> = null
        let compoundLen = 0

        for (let tryLen = maxLen; tryLen >= 4; tryLen--) {
          let tryEnd = s.pos + tryLen
          let wasExtended = false

          // Only try lengths that end at valid boundaries.
          // If the boundary fails due to a trailing combining mark, extend past it —
          // the combining mark belongs to the compound's last cluster.
          if (!this.isSafeBoundary(text, tryEnd)) {
            const extended = this.extendPastCombiningMarks(text, tryEnd)
            if (extended < 0) continue
            tryEnd = extended
            wasExtended = true
          }

          // When extended, check compound decomposition on the ORIGINAL word
          // (the trie stores words without trailing combining marks). The extra
          // combining marks are then included in the compound's actual text span.
          const tryWord = wasExtended
            ? text.slice(s.pos, s.pos + tryLen)
            : text.slice(s.pos, tryEnd)
          const tryCompound = this.checkAffixCompound(tryWord)
          if (tryCompound) {
            // Lookahead: reject fused suffix compounds whose suffix portion overlaps
            // with a longer dictionary word. Example: "ចorg org org org org org org org org org org org" = "ចorg org" + suffix "org org org org"
            // — reject because "org org org org org org org org org org org org org org org org" (8 chars) starts where the suffix starts
            // and extends past the compound's end.
            if (!tryCompound.isBreakPoint && tryCompound.type === 'suffix') {
              const suffixStartInText = s.pos + tryWord.length - tryCompound.affixText.length
              const longestAtSuffix = this.trie.findLongestMatch(text, suffixStartInText)
              if (longestAtSuffix && suffixStartInText + longestAtSuffix.word.length > tryEnd) {
                if (isWordBreakerDebugEnabled()) {
                  console.log(
                    `[v0] beamSegment: rejected fused compound "${tryWord}" (suffix "${tryCompound.affixText}" overlaps with longer word "${longestAtSuffix.word}" at pos ${suffixStartInText})`
                  )
                }
                continue // Suffix eats into a longer dictionary word — try shorter compounds
              }
            }

            // If extended, update the remainder to include the trailing combining marks
            if (wasExtended && tryCompound.isBreakPoint) {
              if (tryCompound.type === 'prefix') {
                tryCompound.remainder = text.slice(s.pos + tryCompound.affixText.length, tryEnd)
              } else {
                // Suffix: the combining marks trail the suffix
                const affixStart = s.pos + tryLen - tryCompound.affixText.length
                tryCompound.affixText = text.slice(affixStart, tryEnd)
              }
            }
            compound = tryCompound
            compoundLen = tryEnd - s.pos
            break // Found longest compound
          }
        }

        // OOV fallback: consume multiple clusters until next strong known word start
        // This prevents over-splitting of unknown words like names and transliterations
        let oovEnd = this.findOovChunkEnd(text, s.pos)

        // If the OOV chunk is followed by ៗ (repetition sign), include it
        if (oovEnd < endPos && this.charSets.isRepetitionSign(text[oovEnd])) {
          oovEnd++
        }

        // OOV+suffix fusion: when no compound was found (stem is OOV) and the OOV
        // chunk is immediately followed by a non-breakpoint suffix, fuse them into
        // a single token. E.g. "ទុរណ" (OOV) + "កម្ម" (suffix) → "ទុរណកម្ម"
        if (!compound) {
          const oovText = text.slice(s.pos, oovEnd)
          const oovClusterCount = this.charSets.extractClusters(oovText).length

          // Only fuse if:
          // 1. OOV has at least 2 clusters (avoid fusing single stray consonants)
          // 2. No strong dictionary match exists at this position — if there's a known
          //    word here (like ពេល freq 50000), the beam should take the dictionary path
          //    rather than swallowing it into a giant OOV+suffix fusion
          const hasStrongDictMatch = matches.some(m => m.frequency >= 1000 && m.length >= 3)
          if (oovClusterCount >= 2 && !hasStrongDictMatch) {
            for (const suffixText of SUFFIXES_BY_LENGTH) {
              const affix = SUFFIX_MAP.get(suffixText)!
              if (affix.isBreakPoint) continue // Only fuse non-breakpoint suffixes

              const suffixEnd = oovEnd + suffixText.length
              if (suffixEnd > endPos) continue

              if (text.substring(oovEnd, suffixEnd) === suffixText) {
                // Verify suffix end is at a safe boundary
                let extendedEnd = suffixEnd
                if (extendedEnd < endPos && !this.isSafeBoundary(text, extendedEnd)) {
                  const extended = this.extendPastCombiningMarks(text, extendedEnd)
                  if (extended < 0) continue
                  extendedEnd = extended
                }

                const suffixFreq = this.trie.getFrequency(suffixText)
                if (suffixFreq > 0) {
                  compound = {
                    type: 'suffix',
                    affix,
                    affixText: suffixText,
                    remainder: oovText,
                    remainderFreq: Math.floor(suffixFreq * 0.5),
                    isBreakPoint: false,
                  }
                  compoundLen = extendedEnd - s.pos

                  if (isWordBreakerDebugEnabled()) {
                    console.log(
                      `[v0] beamSegment: OOV+suffix fusion "${text.slice(s.pos, extendedEnd)}" = OOV "${oovText}" + suffix "${suffixText}" (score basis: ${compound.remainderFreq})`
                    )
                  }
                  break // Longest matching suffix (SUFFIXES_BY_LENGTH sorted longest first)
                }
              }
            }
          }
        }

        // If compound is followed by ៗ (repetition sign), extend compound length
        if (compound && s.pos + compoundLen < endPos && this.charSets.isRepetitionSign(text[s.pos + compoundLen])) {
          compoundLen++
        }

        // Use compound length if we found a compound, otherwise use OOV chunk
        const oovLen = compound ? compoundLen : (oovEnd - s.pos)
        const oovChunk = text.slice(s.pos, s.pos + oovLen)

        if (compound) {
          // Valid compound found - give it a much better score than regular OOV
          if (compound.isBreakPoint) {
            // Break-point compound: add a SINGLE candidate that outputs MULTIPLE segments
            // This ensures the compound stays together as [prefix][remainder] and doesn't
            // get split differently by subsequent beam search iterations
            if (compound.type === 'prefix') {
              const prefixLen = compound.affixText.length
              const remainderLen = compound.remainder.length

              // Calculate combined score for the compound path
              // This is a SINGLE candidate, so only ONE boundary penalty total
              //
              // Prefix: look up actual dictionary frequency (not a fixed value)
              // This is important because prefixes like អ្នក have high freq (50000)
              // and using that makes the compound path competitive with the
              // "step-by-step" path that uses the prefix as a standalone word
              const prefixDictFreq = this.trie.getFrequency(compound.affixText)
              const prefixFreq = prefixDictFreq > 0 ? prefixDictFreq : 10000 // Fallback if not in dict
              const prefixContrib = Math.log(prefixFreq + 1) + this.config.lengthBonus * prefixLen

              // Remainder: use its actual dictionary frequency (NO shortWordPenalty since
              // we know it's a valid compound remainder)
              const remainderContrib = Math.log(compound.remainderFreq + 1) + this.config.lengthBonus * remainderLen

              // Total score: sum of both parts, minus ONE boundary penalty (single candidate)
              // We only subtract ONE boundary penalty because this is a single candidate
              // that produces two pieces. The non-compound path would pay TWO penalties
              // (one for each word), so the compound has a 2.0 point advantage.
              const compoundScore = prefixContrib + remainderContrib - this.config.boundaryPenalty

              // Add as a single candidate with multiple segments
              // The segments array tells the state expansion to add both pieces
              candidates.push({
                len: oovLen, // Full compound length
                score: compoundScore,
                segments: [compound.affixText, compound.remainder],
              })

              if (isWordBreakerDebugEnabled()) {
                // Also log competing candidates at same position
                const competingScores = candidates
                  .filter(c => !c.segments) // Non-compound candidates
                  .map(c => `len=${c.len}:${c.score.toFixed(2)}`)
                  .slice(0, 5)
                console.log(
                  `[v0] beamSegment: break-point compound "${oovChunk}" → ["${compound.affixText}", "${compound.remainder}"] score: ${compoundScore.toFixed(2)}, competing: [${competingScores.join(', ')}]`
                )
              }
            } else {
              // Suffix break-point (rare) - stem comes first, then suffix
              const stemLen = compound.remainder.length
              const suffixLen = compound.affixText.length

              const stemContrib = Math.log(compound.remainderFreq + 1) + this.config.lengthBonus * stemLen
              // Look up actual suffix frequency from dictionary
              const suffixDictFreq = this.trie.getFrequency(compound.affixText)
              const suffixFreq = suffixDictFreq > 0 ? suffixDictFreq : 10000 // Fallback if not in dict
              const suffixContrib = Math.log(suffixFreq + 1) + this.config.lengthBonus * suffixLen
              const compoundScore = stemContrib + suffixContrib - this.config.boundaryPenalty

              candidates.push({
                len: oovLen,
                score: compoundScore,
                segments: [compound.remainder, compound.affixText],
              })

              if (isWordBreakerDebugEnabled()) {
                console.log(
                  `[v0] beamSegment: break-point suffix compound "${oovChunk}" → ["${compound.remainder}", "${compound.affixText}"] score: ${compoundScore.toFixed(2)}`
                )
              }
            }
          } else {
            // Non-break-point compound: keep as single unit with good score
            // For suffix compounds, also consider the suffix's dictionary frequency.
            // A known suffix (e.g. ការណ៍ freq 1519) attached to even a low-freq stem
            // (e.g. ព្រឹត្ត freq 2) should score competitively against splitting them.
            let effectiveFreq = compound.remainderFreq
            if (compound.type === 'suffix') {
              const suffixDictFreq = this.trie.getFrequency(compound.affixText)
              effectiveFreq = Math.max(effectiveFreq, suffixDictFreq)
            }
            const compoundScore = Math.log(effectiveFreq + 1) +
              this.config.lengthBonus * oovLen +
              this.config.compoundBonus - // Bonus for being a valid compound
              this.config.boundaryPenalty

            candidates.push({
              len: oovLen,
              score: compoundScore,
            })

            if (isWordBreakerDebugEnabled()) {
              console.log(
                `[v0] beamSegment: fused compound "${oovChunk}" (${compound.type}: ${compound.affixText} + ${compound.remainder}) score: ${compoundScore.toFixed(2)}`
              )
            }
          }
        }

        // Count clusters in the OOV chunk for better scoring
        const oovClusters = this.charSets.extractClusters(oovChunk).length

        // Scoring: penalize OOV, but give a small length bonus so one longer OOV chunk
        // is preferred over many small OOV chunks
        // Single-cluster OOVs still get heavier penalty to encourage dictionary matches
        const oovPenalty = oovClusters <= 1
          ? this.config.oovSingleClusterPenalty
          : this.config.oovPenalty

        // Length bonus encourages keeping OOV chunks together
        const oovLengthBonus = this.config.lengthBonus * oovLen * 0.5

        // Always add the raw OOV as a fallback candidate (compound detection might have
        // added better alternatives above, but beam search will choose the best one)
        candidates.push({
          len: oovLen,
          score: -oovPenalty - this.config.boundaryPenalty + oovLengthBonus,
        })

        // Expand states with all candidates
        for (const c of candidates) {
          const pieceEnd = s.pos + c.len
          let score = c.score

          // If candidate has explicit segments (from compound detection), use them
          // Otherwise, extract the piece from text
          const pieces = c.segments ?? [text.slice(s.pos, pieceEnd)]

          // Apply penalties to single-piece candidates (skip for multi-segment compounds
          // since they've already been validated)
          if (pieces.length === 1) {
            const piece = pieces[0]

            // Apply heavy penalty for "dangling bantoc" tokens (consonant + ់)
            // These are almost always misbreaks and should stay with the previous word
            // e.g., "របស់" should not be split as "រប|ស់"
            // Also penalize tokens that START with consonant + ់ (like "ស់ប្រorg")
            if (this.charSets.isDanglingBantoc(piece) || this.charSets.startsWithDanglingBantoc(piece)) {
              // Only allow if it's a known dictionary word (very rare)
              if (!this.trie.hasWord(piece)) {
                score -= this.config.danglingBantocPenalty
              }
            }

            // Apply heavy penalty for words ending in dangling dependent vowel
            // Example: "ផាសុ" ends with ុ which is suspicious - likely should be "ផា|សុខភាព"
            // not "ផាសុ|ខភាព". In Khmer, words rarely end in bare short vowels (ុ ិ ី ួ)
            // without following consonants or signs.
            if (this.charSets.endsWithDanglingVowel(piece)) {
              // Only allow if it's a known dictionary word
              if (!this.trie.hasWord(piece)) {
                score -= this.config.danglingVowelPenalty
              }
            }

            // Apply penalty for breaking before a semivowel (org/org) when the current
            // token ends with a combining mark. This pattern often indicates we're
            // cutting a word too early (e.g., "org org org|org..." instead of "org org org...")
            if (pieceEnd < text.length && piece.length > 0) {
              const lastChar = piece[piece.length - 1]
              const nextChar = text[pieceEnd]
              if (this.charSets.isDependentMark(lastChar) && this.charSets.isSemivowel(nextChar)) {
                // Check if the next-next char is a base consonant (indicating a new word)
                // If so, breaking here might still be wrong
                const nextNextChar = pieceEnd + 1 < text.length ? text[pieceEnd + 1] : ''
                if (nextNextChar && this.charSets.isBase(nextNextChar)) {
                  score -= this.config.semivowelBoundaryPenalty
                }
              }
            }
          }

          let tail = s.tail
          for (const piece of pieces) tail = { piece, prev: tail }
          nextStates.push({
            pos: pieceEnd,
            score: s.score + score,
            tail,
            count: s.count + pieces.length,
          })
        }
      }

      // Keep top BEAM_WIDTH states, favoring higher scores and further progress
      nextStates.sort((a, b) => (b.score - a.score) || (b.pos - a.pos))

      // Debug: Log state counts and top scores at each iteration
      if (isWordBreakerDebugEnabled() && nextStates.length > this.config.beamWidth) {
        // Find states that have the compound segments (pieces ending with two specific words)
        const statesWithCompound = nextStates.filter(s => {
          if (s.count < 2) return false
          const last = s.tail!.piece
          const secondLast = s.tail!.prev!.piece
          // Check if these look like a prefix + remainder compound split
          // Prefix "org org org" is 4 chars, remainder would be around 5 chars
          return secondLast.length >= 3 && secondLast.length <= 5 && last.length >= 4 && last.length <= 7
        })
        if (statesWithCompound.length > 0) {
          const bestCompound = statesWithCompound.reduce((a, b) => a.score > b.score ? a : b)
          const rank = nextStates.indexOf(bestCompound)
          console.log(`[v0] beamSegment: ${nextStates.length} states, possible compound at rank ${rank}, score ${bestCompound.score.toFixed(2)}, pieces: [${materialise(bestCompound).slice(-3).map(p => `"${p}"`).join(', ')}]`)
        }
      }

      states = nextStates.slice(0, this.config.beamWidth)
    }

    // Choose best finished state: furthest position, then highest average score per segment.
    // Normalizing by segment count prevents over-segmentation where many short dictionary
    // words accumulate more total score than fewer correct longer words.
    states.sort((a, b) => {
      if (a.pos !== b.pos) return b.pos - a.pos
      const avgA = a.count > 0 ? a.score / a.count : a.score
      const avgB = b.count > 0 ? b.score / b.count : b.score
      return avgB - avgA
    })
    const result = states.length > 0 ? materialise(states[0]) : [text]

    // Post-processing: merge orphaned single-cluster OOV tokens into the previous word.
    // A bare consonant (e.g., "រ") is almost never a valid Khmer word — it typically
    // indicates a dictionary gap or misspelling. Merging it back produces cleaner breaks.
    const merged: string[] = []
    for (let i = 0; i < result.length; i++) {
      const piece = result[i]
      if (
        merged.length > 0 &&
        !this.trie.hasWord(piece) &&
        this.charSets.extractClusters(piece).length <= 1
      ) {
        if (isWordBreakerDebugEnabled()) {
          console.log(`[v0] beamSegment: merging orphan "${piece}" into previous "${merged[merged.length - 1]}"`)
        }
        merged[merged.length - 1] += piece
      } else {
        merged.push(piece)
      }
    }

    if (isWordBreakerDebugEnabled()) {
      console.log(`[v0] beamSegment: "${text}" -> [${merged.map((s) => `"${s}"`).join(", ")}]`)
    }

    return merged
  }

  /**
   * Bidirectional Maximum Matching algorithm.
   * Compares forward and backward maximum matching and picks the better result.
   * Kept as fallback method.
   */
  private bidirectionalSegment(text: string): string[] {
    const forward = this.forwardMaximumMatch(text)
    const backward = this.backwardMaximumMatch(text)

    // Pick the better segmentation
    // Prefer: fewer segments > fewer single-char segments > backward
    if (forward.length < backward.length) {
      return forward
    } else if (forward.length > backward.length) {
      return backward
    } else {
      const forwardSingleChars = forward.filter((w) => this.charSets.countSyllables(w) === 1).length
      const backwardSingleChars = backward.filter((w) => this.charSets.countSyllables(w) === 1).length

      if (forwardSingleChars < backwardSingleChars) {
        return forward
      } else {
        return backward // Prefer backward when tied
      }
    }
  }

  /**
   * Forward Maximum Matching - scan left to right, take longest match
   */
  private forwardMaximumMatch(text: string): string[] {
    const segments: string[] = []
    let pos = 0

    if (isWordBreakerDebugEnabled()) {
      console.log(`[v0] forwardMaximumMatch starting for: "${text}"`)
    }

    while (pos < text.length) {
      // Try dictionary match first
      const match = this.trie.findLongestMatch(text, pos)

      const isValidMatch = match && match.word.length > 0 && this.isSignificantWord(match)

      if (isValidMatch) {
        // Verify the match ends at a valid break point
        const endPos = pos + match.word.length
        const canBreak = endPos >= text.length || this.charSets.canBreakAt(text, endPos)

        if (isWordBreakerDebugEnabled()) {
          console.log(
            `[v0] forwardMM pos=${pos}: found "${match.word}" (freq: ${match.frequency}), endPos=${endPos}, canBreakAt=${canBreak}`,
          )
        }

        if (canBreak) {
          segments.push(match.word)
          pos = endPos
          continue
        }
      } else if (match && isWordBreakerDebugEnabled()) {
        console.log(
          `[v0] forwardMM pos=${pos}: skipping low-freq short match "${match.word}" (freq: ${match.frequency})`,
        )
      }

      // No valid dictionary match - find next natural break point
      // instead of breaking into individual syllables/characters
      const unknownEnd = this.findNextBreakPoint(text, pos)
      const unknownSegment = text.substring(pos, unknownEnd)

      if (isWordBreakerDebugEnabled()) {
        console.log(
          `[v0] forwardMM pos=${pos}: no valid dict match, taking unknown segment to ${unknownEnd}: "${unknownSegment}"`,
        )
      }

      if (unknownEnd > pos) {
        segments.push(unknownSegment)
        pos = unknownEnd
      } else {
        // Fallback: take one character (should rarely happen)
        segments.push(text[pos])
        pos++
      }
    }

    if (isWordBreakerDebugEnabled()) {
      console.log(`[v0] forwardMaximumMatch result: [${segments.map((s) => `"${s}"`).join(", ")}]`)
    }

    return segments
  }

  /**
   * Find the next natural break point from the given position.
   * This looks for: end of text, whitespace, punctuation, or start of a known dictionary word.
   * Used to keep unknown words together instead of breaking into individual syllables.
   */
  private findNextBreakPoint(text: string, startPos: number): number {
    let pos = startPos

    // Always advance at least one syllable
    const firstSyllableEnd = this.charSets.findSyllableEnd(text, pos)
    if (firstSyllableEnd > pos) {
      pos = firstSyllableEnd
    } else {
      pos++ // at minimum advance one character
    }

    // Now scan forward looking for a natural break point
    while (pos < text.length) {
      const char = text[pos]

      // Stop at whitespace
      if (/\s/.test(char)) {
        break
      }

      // Stop at punctuation
      if (isPunctuation(char)) {
        break
      }

      // Stop if we can break here AND there's a significant dictionary word starting here
      if (this.charSets.canBreakAt(text, pos)) {
        const match = this.trie.findLongestMatch(text, pos)
        if (match && match.word.length > 0 && this.isSignificantWord(match)) {
          // Verify this match would end at a valid break point
          const matchEnd = pos + match.word.length
          if (matchEnd >= text.length || this.charSets.canBreakAt(text, matchEnd)) {
            break // Found a significant known word, stop here
          }
        }
      }

      // Continue to next syllable
      const nextSyllableEnd = this.charSets.findSyllableEnd(text, pos)
      if (nextSyllableEnd > pos) {
        pos = nextSyllableEnd
      } else {
        pos++
      }
    }

    return pos
  }

  /**
   * Backward Maximum Matching - scan right to left, take longest match
   */
  private backwardMaximumMatch(text: string): string[] {
    const segments: string[] = []
    let pos = text.length

    while (pos > 0) {
      let found = false

      // Try all possible start positions from longest to shortest
      const maxLen = Math.min(pos, this.trie.maxWordLength)
      for (let len = maxLen; len >= 1; len--) {
        const startPos = pos - len
        const candidate = text.substring(startPos, pos)

        const match = this.trie.findLongestMatch(text, startPos)
        if (match && match.word === candidate && this.isSignificantWord(match)) {
          if (startPos === 0 || this.charSets.canBreakAt(text, startPos)) {
            segments.unshift(candidate)
            pos = startPos
            found = true
            break
          }
        }
      }

      if (!found) {
        const unknownStart = this.findPreviousBreakPoint(text, pos)
        const unknownSegment = text.substring(unknownStart, pos)

        if (unknownStart < pos) {
          segments.unshift(unknownSegment)
          pos = unknownStart
        } else {
          // Fallback: take one character
          segments.unshift(text[pos - 1])
          pos--
        }
      }
    }

    return segments
  }

  /**
   * Find the previous natural break point from the given position (scanning backwards).
   * This looks for: start of text, whitespace, punctuation, or end of a known dictionary word.
   * Used to keep unknown words together instead of breaking into individual syllables.
   */
  private findPreviousBreakPoint(text: string, endPos: number): number {
    let pos = endPos

    // Always go back at least one syllable
    let syllableStart = pos - 1
    while (syllableStart > 0 && !this.charSets.canBreakAt(text, syllableStart)) {
      syllableStart--
    }
    pos = syllableStart

    // Now scan backward looking for a natural break point
    while (pos > 0) {
      const charBefore = text[pos - 1]

      // Stop after whitespace
      if (/\s/.test(charBefore)) {
        break
      }

      // Stop after punctuation
      if (isPunctuation(charBefore)) {
        break
      }

      // Stop if there's a SIGNIFICANT dictionary word ending just before pos
      if (this.charSets.canBreakAt(text, pos)) {
        // Check if there's a known word ending here by looking backwards
        const maxLen = Math.min(pos, this.trie.maxWordLength)
        for (let len = maxLen; len >= 1; len--) {
          const candidateStart = pos - len
          const candidate = text.substring(candidateStart, pos)

          const match = this.trie.findLongestMatch(text, candidateStart)
          if (match && match.word === candidate && this.isSignificantWord(match)) {
            if (candidateStart === 0 || this.charSets.canBreakAt(text, candidateStart)) {
              return pos // Found a significant known word ending here, stop
            }
          }
        }
      }

      // Continue to previous syllable
      syllableStart = pos - 1
      while (syllableStart > 0 && !this.charSets.canBreakAt(text, syllableStart)) {
        syllableStart--
      }
      pos = syllableStart
    }

    return pos
  }

  /**
   * Insert ZWSP between words, but avoid duplicating existing ZWSP.
   * Preserve spaces - don't add ZWSP around whitespace
   */
  insertBreakOpportunities(text: string): string {
    const segments = this.getSegments(text)

    // Join segments, but don't add ZWSP before/after whitespace segments
    let result = ""
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const isWhitespace = /^\s+$/.test(segment)
      const prevIsWhitespace = i > 0 && /^\s+$/.test(segments[i - 1])

      // Add ZWSP between non-whitespace segments (not at start, not around whitespace)
      if (i > 0 && !isWhitespace && !prevIsWhitespace) {
        result += ZWSP
      }
      result += segment
    }

    return result
  }

  getTextWithBreaks(text: string): string {
    return this.insertBreakOpportunities(text)
  }

  /**
   * Extract leading and trailing punctuation from a text segment.
   * Returns { leading, core, trailing } where core is the text without edge punctuation.
   */
  private extractPunctuation(text: string): { leading: string; core: string; trailing: string } {
    let leading = ""
    let trailing = ""
    let start = 0
    let end = text.length

    // Extract leading punctuation
    while (start < text.length && (OPENING_PUNCTUATION.has(text[start]) || CLOSING_PUNCTUATION.has(text[start]))) {
      leading += text[start]
      start++
    }

    // Extract trailing punctuation
    while (end > start && (CLOSING_PUNCTUATION.has(text[end - 1]) || OPENING_PUNCTUATION.has(text[end - 1]))) {
      trailing = text[end - 1] + trailing
      end--
    }

    const core = text.substring(start, end)
    return { leading, core, trailing }
  }

  findWordBreaks(text: string): number[] {
    const segments = this.getSegments(text)
    const breaks: number[] = []
    let pos = 0

    for (const segment of segments) {
      const idx = text.indexOf(segment, pos)
      if (idx !== -1) {
        pos = idx + segment.length
        if (pos < text.length) {
          breaks.push(pos)
        }
      }
    }

    return breaks
  }

  findLineBreaks(text: string): number[] {
    return this.findWordBreaks(text).filter((pos) => this.charSets.canBreakAt(text, pos))
  }

  /**
   * Check if a dictionary match is significant enough to be treated as a word.
   * Short matches (1-2 clusters) need high frequency to be considered real words.
   * This prevents low-frequency single-character matches from breaking up
   * transliterated foreign names like "វ៉កគ័រ" (Walker).
   *
   * Uses cluster count instead of JS string length for accurate thresholds,
   * since Khmer uses many combining marks that affect string length but not
   * the visual/linguistic length of the word.
   */
  private isSignificantWord(match: { word: string; frequency: number }): boolean {
    // Count clusters for more accurate length measurement
    const clusterCount = this.charSets.extractClusters(match.word).length

    // Long words (3+ clusters) are always significant
    if (clusterCount >= 3) {
      return true
    }

    // Most single Khmer clusters are consonants/vowels, not standalone words
    if (clusterCount <= 1) {
      return match.frequency >= this.config.minFrequencySingleCluster
    }

    // Two-cluster words need moderately high frequency
    return match.frequency >= this.config.minFrequencyTwoCluster
  }

  // Penalty multiplier for low-frequency short words

  /**
   * Calculate a penalty for short words based on their frequency.
   * Unlike isSignificantWord() which is a hard gate, this returns a continuous
   * penalty that allows low-frequency words to be considered but with a cost.
   *
   * This is important for Khmer because many real 2-cluster words may have
   * low corpus frequency but are still valid (e.g., "ប្រិយ" freq=398).
   *
   * Single-cluster words now use a soft penalty instead of hard rejection to
   * allow valid words like "ផា" (freq=548) to compete when they lead to better
   * overall segmentations (e.g., "ផា|សុខភាព" instead of "ផាសុ|ខភាព").
   *
   * Returns:
   * - 0 for words that meet frequency thresholds
   * - Positive penalty for low-frequency short words
   * - Higher penalty for single-cluster words (but no longer infinity)
   */
  private shortWordPenalty(word: string, freq: number): number {
    const clusters = this.charSets.extractClusters(word).length

    // 3+ clusters: always ok, no penalty
    if (clusters >= 3) return 0

    // 1 cluster: use soft penalty instead of hard reject
    // This allows valid low-freq single-cluster words like "ផា" (freq=548)
    // to compete when they lead to better overall paths, while still keeping
    // junk consonants heavily penalized
    if (clusters <= 1) {
      if (freq >= this.config.minFrequencySingleCluster) return 0

      // Soft penalty scaled by distance from threshold
      // Uses higher multiplier (8.0) than 2-cluster words (4.0) to maintain
      // strong preference against single-cluster words
      const ratio = (this.config.minFrequencySingleCluster - freq) / this.config.minFrequencySingleCluster
      return this.config.lowFrequencySingleClusterMultiplier * ratio
    }

    // 2 clusters: allow but penalize if low frequency
    const threshold = this.config.minFrequencyTwoCluster
    if (freq >= threshold) return 0

    // Scale penalty smoothly based on how far below threshold
    // ratio goes from 0 (at threshold) to ~1 (at 0 frequency)
    const ratio = (threshold - freq) / threshold
    return this.config.lowFrequencyPenaltyMultiplier * ratio
  }
}

export default KhmerBreaker

const KHMER_RANGE_START = 0x1780
const KHMER_RANGE_END = 0x17ff
const KHMER_DIGIT_START = 0x17e0
const KHMER_DIGIT_END = 0x17e9

function isKhmerCodePoint(codePoint: number): boolean {
  return codePoint >= KHMER_RANGE_START && codePoint <= KHMER_RANGE_END
}

function isKhmerDigit(codePoint: number): boolean {
  return codePoint >= KHMER_DIGIT_START && codePoint <= KHMER_DIGIT_END
}

// Khmer letters are Khmer characters that are NOT digits
function isKhmerLetter(codePoint: number): boolean {
  return isKhmerCodePoint(codePoint) && !isKhmerDigit(codePoint)
}

function isNonBreakableScript(char: string): boolean {
  const cp = char.codePointAt(0) || 0
  // Latin, numbers, and other non-Khmer scripts shouldn't be word-broken
  // This includes: Basic Latin (0-127), Latin Extended, numbers, etc.
  // Exclude spaces and common punctuation which ARE breakable
  if (char === " " || OPENING_PUNCTUATION.has(char) || CLOSING_PUNCTUATION.has(char)) {
    return false
  }
  // If it's not Khmer and not whitespace/punctuation, it's a non-breakable script character
  return !isKhmerCodePoint(cp) && !/\s/.test(char)
}

/**
 * Split text into runs of Khmer vs non-Khmer (Latin/etc) characters.
 * Non-Khmer runs should not be word-broken.
 * Punctuation and spaces are treated as boundaries.
 *
 * Additionally, Khmer digits (០-៩) following Khmer letters are split into
 * separate runs, so "តែ១១៣៤���" becomes "តែ" | "១១៣៤៤".
 * Consecutive Khmer digits stay together.
 */
function splitByScript(text: string): Array<{ text: string; isKhmer: boolean }> {
  if (!text) return []

  const runs: Array<{ text: string; isKhmer: boolean }> = []
  let currentRun = ""
  let currentIsKhmer: boolean | null = null
  let currentIsKhmerDigit: boolean | null = null  // Track if current run is Khmer digits

  const chars = [...text] // Use array to handle iteration with lookahead
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    const cp = char.codePointAt(0) || 0
    const charIsKhmer = isKhmerCodePoint(cp)
    const charIsKhmerDigit = isKhmerDigit(cp)

    // Check if this is a connector character (-, /, ., :) between Khmer chars.
    // If so, keep it in the current run rather than splitting.
    // Also handle ZWSP that may appear after the connector (from previous word-breaking).
    const ZWSP_CHAR = '\u200B'
    let isConnectorBetweenKhmer = false
    let skipZwspAfterConnector = false
    if (CONNECTOR_CHARS.has(char) && currentIsKhmer === true && currentRun.length > 0) {
      const nextChar = i + 1 < chars.length ? chars[i + 1] : null
      const nextNextChar = i + 2 < chars.length ? chars[i + 2] : null
      if (nextChar && isKhmerCodePoint(nextChar.codePointAt(0) || 0)) {
        isConnectorBetweenKhmer = true
      } else if (nextChar === ZWSP_CHAR && nextNextChar && isKhmerCodePoint(nextNextChar.codePointAt(0) || 0)) {
        // Connector followed by ZWSP followed by Khmer char
        isConnectorBetweenKhmer = true
        skipZwspAfterConnector = true
      }
    }

    // Check if this is a ZWSP between a connector and Khmer char (should be kept with the run)
    const isZwspAfterConnector = char === ZWSP_CHAR &&
      currentRun.length > 0 &&
      CONNECTOR_CHARS.has(currentRun[currentRun.length - 1]) &&
      currentIsKhmer === true &&
      i + 1 < chars.length &&
      isKhmerCodePoint((chars[i + 1].codePointAt(0) || 0))

    const isBreakPoint = !isConnectorBetweenKhmer && !isZwspAfterConnector && (
      char === " " || /\s/.test(char) || OPENING_PUNCTUATION.has(char) || CLOSING_PUNCTUATION.has(char)
    )

    // Handle connector between Khmer chars - keep in same run
    if (isConnectorBetweenKhmer) {
      currentRun += char
      if (skipZwspAfterConnector) {
        currentRun += chars[i + 1] // Add the ZWSP
        i++ // Skip the ZWSP in the next iteration
      }
      // After a connector, the next Khmer char may be a different type (letter vs digit)
      // but we keep the run together. Reset digit tracking since it's mixed.
      currentIsKhmerDigit = null
    } else if (isZwspAfterConnector) {
      // ZWSP between connector and Khmer char - keep it with the run
      currentRun += char
    } else if (isBreakPoint) {
      // Flush current run
      if (currentRun) {
        runs.push({ text: currentRun, isKhmer: currentIsKhmer ?? false })
        currentRun = ""
        currentIsKhmer = null
        currentIsKhmerDigit = null
      }
      // Add the break character as its own run (treat as Khmer so it goes through normal processing)
      runs.push({ text: char, isKhmer: true })
    } else if (currentIsKhmer === null) {
      // Start new run
      currentRun = char
      currentIsKhmer = charIsKhmer
      currentIsKhmerDigit = charIsKhmerDigit
    } else if (charIsKhmer !== currentIsKhmer) {
      // Script changed (Khmer <-> non-Khmer) - flush and start new run
      if (currentRun) {
        runs.push({ text: currentRun, isKhmer: currentIsKhmer })
      }
      currentRun = char
      currentIsKhmer = charIsKhmer
      currentIsKhmerDigit = charIsKhmerDigit
    } else if (charIsKhmer && currentIsKhmer) {
      // Both are Khmer - check if transitioning from letter to digit
      // Split when: current run is Khmer letters AND new char is Khmer digit
      if (currentIsKhmerDigit === false && charIsKhmerDigit) {
        // Transitioning from Khmer letters to Khmer digits - split
        if (currentRun) {
          runs.push({ text: currentRun, isKhmer: true })
        }
        currentRun = char
        currentIsKhmerDigit = true
      } else {
        // Same type (both letters or both digits) or digits followed by letters - continue
        currentRun += char
        // Update digit status (digits can be followed by more digits or by letters)
        if (!charIsKhmerDigit) {
          currentIsKhmerDigit = false
        }
      }
    } else {
      // Continue current run (non-Khmer)
      currentRun += char
    }
  }

  // Flush final run
  if (currentRun) {
    runs.push({ text: currentRun, isKhmer: currentIsKhmer ?? false })
  }

  return runs
}
