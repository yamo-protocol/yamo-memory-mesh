/**
 * Token counting — character-class-aware heuristic.
 *
 * Replaces the previous naive chars/4 estimate, which dramatically
 * undercounted CJK (each kanji/hiragana is ~1-2 BPE tokens, not 0.25)
 * and code (dense punctuation, short identifiers tokenize aggressively).
 * Under the old approximation, chunks routinely violated maxTokens for
 * downstream models.
 *
 * Calibrated against cl100k_base / o200k_base (GPT-4 / 4o / Claude
 * sentencepiece have similar profiles). Synchronous API preserved so
 * the chunker's hot path doesn't need to go async.
 *
 * Tradeoff: still an estimate. For exact-budget use cases (e.g. capping
 * to a model's hard context limit), call a real BPE tokenizer at the
 * boundary. This is the cheap, fast pre-check.
 */
export declare class TokenCounter {
    /**
     * Estimate token count for a string.
     * Empirically within ~10-15% of cl100k_base on mixed English / code / CJK.
     */
    count(text: string): number;
    /**
     * Whitespace-and-punctuation word count. Kept for callers that want a
     * pure word-level metric independent of model tokenization.
     */
    countAccurate(text: string): number;
}
