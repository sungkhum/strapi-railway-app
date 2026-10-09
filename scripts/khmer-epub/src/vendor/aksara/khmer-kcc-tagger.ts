/**
 * Runtime side of the Khmer word-boundary tagger.
 *
 * Holds the weight table produced by `scripts/train-perceptron.ts` and scores each
 * cluster gap. The model decides boundaries *inside* runs of Khmer letters only —
 * breaks at spaces, punctuation and connectors are governed by rules that already
 * work and that the corpus cannot teach.
 *
 * Loading is optional. With no weights present the breaker falls back to beam
 * search alone, so a failed or slow fetch degrades quality rather than breaking
 * the editor.
 */

import { FEATURE_SET_VERSION, scoreGap, type DictionaryProbe } from "./khmer-kcc-features"

export class KhmerBoundaryTagger {
  private readonly weights: Map<string, number>

  constructor(weights: Record<string, number> | Map<string, number>) {
    this.weights = weights instanceof Map ? weights : new Map(Object.entries(weights))
  }

  get featureCount(): number {
    return this.weights.size
  }

  /**
   * Decide each gap in a run of clusters.
   *
   * Returns one flag per gap: `result[i]` is whether a boundary belongs between
   * `clusters[i]` and `clusters[i + 1]`.
   */
  predict(clusters: string[], dict: DictionaryProbe): boolean[] {
    const decisions: boolean[] = []
    for (let gap = 1; gap < clusters.length; gap++) {
      decisions.push(scoreGap(clusters, gap, dict, this.weights) > 0)
    }
    return decisions
  }

  /**
   * Fetch a weight table. Resolves to null when unavailable or when the weights
   * were trained against a different feature set, since stale weights would
   * degrade segmentation silently rather than failing.
   */
  static async load(url = "/dictionaries/km_kcc_tagger.json"): Promise<KhmerBoundaryTagger | null> {
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      return KhmerBoundaryTagger.fromJson(await response.json())
    } catch {
      return null
    }
  }

  /** Build from a parsed weights file, checking the feature-set version. */
  static fromJson(data: unknown): KhmerBoundaryTagger | null {
    if (!data || typeof data !== "object") return null
    const file = data as { version?: number; weights?: Record<string, number> }
    if (file.version !== FEATURE_SET_VERSION || !file.weights) {
      console.warn(
        `[khmer] Ignoring boundary tagger built for feature set v${file.version}; ` +
          `this build expects v${FEATURE_SET_VERSION}. Retrain with scripts/train-perceptron.ts.`,
      )
      return null
    }
    return new KhmerBoundaryTagger(file.weights)
  }
}
