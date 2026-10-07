/**
 * Feature extraction for the Khmer boundary tagger.
 *
 * The tagger decides, for each gap between two Khmer character clusters, whether
 * a word boundary belongs there. Features combine local orthographic context with
 * what the dictionary knows about the words meeting at the gap, which lets the
 * model learn decisions the frequency model cannot express — that ជាមួយ is one
 * word while ខិតខំ is two, even though both are pairs of common syllables.
 *
 * This module is shared by training and runtime. If the two ever disagree about
 * what a feature means, the learned weights become meaningless, so both sides
 * must import from here rather than reimplementing.
 */

/**
 * Bumped whenever the features produced here change.
 *
 * Weights are learned against one exact feature set. If the extractor changes and
 * old weights are loaded anyway, the mismatch is silent — features simply stop
 * matching and quality quietly drops. The tagger refuses weights whose version
 * does not match instead.
 */
export const FEATURE_SET_VERSION = 3

export interface DictionaryProbe {
  /** Whether the exact string is a dictionary word (ignored words report false) */
  isKnownWord(word: string): boolean
  /** Frequency of the word, 0 when absent. Entries the corpus consistently splits
   *  are demoted to 1, which a binary known/unknown flag would hide. */
  wordFrequency(word: string): number
}

/**
 * Frequency bands. The exact count matters far less than the order of magnitude,
 * and bucketing keeps the feature space small enough to learn from.
 *
 * Band "1" is meaningful on its own: it is what the dictionary builder assigns to
 * compounds the corpus consistently splits.
 */
function frequencyBand(frequency: number): string {
  if (frequency <= 0) return "0"
  if (frequency === 1) return "demoted"
  if (frequency < 100) return "rare"
  if (frequency < 2000) return "mid"
  if (frequency < 20000) return "high"
  return "top"
}

/**
 * Stands in for a cluster position past the start or end of the run, so that
 * "nothing here" is a value the model can weigh like any other context. Chosen to
 * be a string no real cluster can equal.
 */
const EDGE = "<edge>"

/** Longest dictionary word to consider on either side of a gap, in clusters. */
const MAX_SPAN_CLUSTERS = 6

/** Bucketed so a length of 7 and 9 share evidence rather than splitting it. */
function lengthBucket(n: number): string {
  if (n <= 0) return "0"
  if (n <= 2) return String(n)
  if (n <= 4) return "3-4"
  if (n <= 6) return "5-6"
  return "7+"
}

/**
 * Features for the gap immediately before `clusters[gap]`.
 *
 * `gap` must be in 1..clusters.length-1. Returns interned feature strings; the
 * weight table maps each to a learned score, and their sum decides the boundary.
 */
export function gapFeatures(clusters: string[], gap: number, dict: DictionaryProbe): string[] {
  const at = (i: number) => (i >= 0 && i < clusters.length ? clusters[i] : EDGE)

  const m3 = at(gap - 3)
  const m2 = at(gap - 2)
  const m1 = at(gap - 1)
  const p0 = at(gap)
  const p1 = at(gap + 1)
  const p2 = at(gap + 2)

  const features: string[] = [
    // Constant term: lets the model learn how readily it should split at all.
    "bias",
    // Local orthography around the gap.
    `a-3=${m3}`,
    `a-2=${m2}`,
    `a-1=${m1}`,
    `a+0=${p0}`,
    `a+1=${p1}`,
    `a+2=${p2}`,
    `b-2=${m2}|${m1}`,
    `bx=${m1}|${p0}`, // the pair straddling the gap: the single strongest cue
    `b+1=${p0}|${p1}`,
    `t-=${m2}|${m1}|${p0}`,
    `t+=${m1}|${p0}|${p1}`,
    `q=${m2}|${m1}|${p0}|${p1}`,
    // Distance from the edges of the run.
    `pos=${lengthBucket(gap)}|${lengthBucket(clusters.length - gap)}`,
  ]

  // What words could end at this gap, and what words could start from it.
  let longestLeft = 0
  let longestRight = 0
  let bestLeftBand = "0"
  let bestRightBand = "0"
  for (let n = 1; n <= MAX_SPAN_CLUSTERS; n++) {
    if (gap - n >= 0) {
      const left = clusters.slice(gap - n, gap).join("")
      if (dict.isKnownWord(left)) {
        const band = frequencyBand(dict.wordFrequency(left))
        features.push(`L${n}`, `L${n}f=${band}`)
        longestLeft = n
        bestLeftBand = band
      }
    }
    if (gap + n <= clusters.length) {
      const right = clusters.slice(gap, gap + n).join("")
      if (dict.isKnownWord(right)) {
        const band = frequencyBand(dict.wordFrequency(right))
        features.push(`R${n}`, `R${n}f=${band}`)
        longestRight = n
        bestRightBand = band
      }
    }
  }
  features.push(`Lf=${bestLeftBand}`, `Rf=${bestRightBand}`, `LRf=${bestLeftBand}|${bestRightBand}`)

  features.push(`Lmax=${longestLeft}`, `Rmax=${longestRight}`, `LR=${longestLeft}|${longestRight}`)

  // Both sides being real words is the core evidence for splitting here; it is
  // what the finer-breaks convention rests on.
  if (longestLeft > 0 && longestRight > 0) features.push("both")
  if (longestLeft === 0 && longestRight === 0) features.push("neither")

  // A dictionary word straddling the gap is the core evidence against splitting.
  let straddles = false
  for (let l = 1; l <= MAX_SPAN_CLUSTERS && !straddles; l++) {
    if (gap - l < 0) break
    for (let r = 1; r <= MAX_SPAN_CLUSTERS; r++) {
      if (gap + r > clusters.length) break
      const spanning = clusters.slice(gap - l, gap + r).join("")
      if (dict.isKnownWord(spanning)) {
        const band = frequencyBand(dict.wordFrequency(spanning))
        // A demoted straddling word is evidence *for* splitting, not against it.
        features.push(`X=${l}|${r}`, `Xf=${band}`, `Xf=${band}|${bestLeftBand}|${bestRightBand}`)
        straddles = true
        break
      }
    }
  }
  if (straddles) features.push("straddled")
  // The decisive configuration: a word spans the gap *and* both halves are words.
  if (straddles && longestLeft > 0 && longestRight > 0) features.push("contested")

  return features
}

/** Score a gap under a weight table. Positive means "boundary here". */
export function scoreGap(
  clusters: string[],
  gap: number,
  dict: DictionaryProbe,
  weights: Map<string, number>,
): number {
  let score = 0
  for (const feature of gapFeatures(clusters, gap, dict)) {
    const weight = weights.get(feature)
    if (weight !== undefined) score += weight
  }
  return score
}
