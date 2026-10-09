import { KhmerBreaker, KhmerCharSets } from './vendor/aksara/khmer-breaker'
import { KhmerBoundaryTagger } from './vendor/aksara/khmer-kcc-tagger'
import dictionary from './vendor/aksara/km_frequency_dictionary.json'
import model from './vendor/aksara/km_kcc_tagger.json'

export const VERSION = 'aksara-31740e9-kcc3-plovpit1'
export const WORD_CLASS = 'plovpit-khmer-word'
export const BREAK_CLASS = 'plovpit-khmer-break'
export const charSets = new KhmerCharSets()
let breaker: KhmerBreaker | undefined
export function getBreaker() {
  if (!breaker) {
    const start = performance.now()
    breaker = new KhmerBreaker(Object.entries(dictionary).map(([word, frequency]) => ({word, frequency})))
    const tagger = KhmerBoundaryTagger.fromJson(model)
    if (!tagger) throw new Error('Aksara model and feature versions do not match')
    breaker.setBoundaryTagger(tagger)
    initializationMs = performance.now() - start
  }
  return breaker
}
export let initializationMs = 0
export const dictionaryEntries = Object.keys(dictionary).length
export const modelFeatures = Object.keys(model.weights).length
