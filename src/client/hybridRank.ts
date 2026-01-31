/**
 * Rank results from multiple results, e.g. from vector search and text search.
 * Uses the "Reciprocal Rank Fusion" algorithm.
 * @param sortedResults The results arrays ordered by most important first.
 */
export function hybridRank<T extends string>(
  sortedResults: T[][],
  opts?: {
    /**
     * A constant used to change the bias of the top results in each list vs.
     * results in the middle of multiple lists.
     * A higher k means less of a bias toward the top few results.
     */
    k: number;
    /**
     * The weights of each sortedResults array.
     * Used to prefer results from one sortedResults array over another.
     */
    weights: number[];
    /**
     * The cutoff score for a result to be returned.
     */
    cutoffScore?: number;
  },
): T[] {
  const k = opts?.k ?? 10;
  const scores: Map<T, number> = new Map();
  for (const [i, results] of sortedResults.entries()) {
    const weight = opts?.weights?.[i] ?? 1;
    for (let j = 0; j < results.length; j++) {
      const key = results[j];
      scores.set(key, (scores.get(key) ?? 0) + weight / (k + j));
    }
  }
  const sortedScores = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  return sortedScores
    .filter(([_, score]) => score >= (opts?.cutoffScore ?? 0))
    .map(([key]) => key);
}
