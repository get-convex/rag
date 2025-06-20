/**
 * This file contains functions for modifying embeddings to include importance.
 * Terminology is roughly: a "vector" is an "embedding" + importance.
 * Users pass in embeddings, the tables and vector search deal with vectors.
 */

/**
 * For a search, we need to add a 0 to the end of the embedding so we ignore
 * the weight value.
 */
export function searchVector(embedding: number[]) {
  if (embedding.length === 4096) {
    return [...embedding.slice(0, 4095), 0];
  }
  return [...embedding, 0];
}
/**
 * For an importance of x (0 to 1):
 * @param embedding - The vector to modify with an importance weight.
 * @param importance - 0 - 1, where 0 is no importance and 1 is full importance.
 * @returns The vector with the importance added.
 */
export function vectorWithImportance(embedding: number[], importance: number) {
  /*
   * Goal: add a weighting that reduces the magnitude of the target vector after
   * normalization.
   * 1. Scale the existing vector by importance and add a weight so |v| = 1.
   * 2. Search with [...embedding, 0].
   * e.g.:
   * Say we have an embedding of 2 numbers [.6, .8]
   * For 50% importance: [.6 * i, .8 * i, sqrt(1 - i^2)] ->  [.3, .4, .866]
   * For [.6, .8] we used to get 1.0.
   * Now we get .6*.3 + .8*.4 + 0*.866 = 0.5
   */
  // We drop the final dimension if it'd make it larger than 4096.
  // Unfortunate current limitation of Convex vector search.
  const vectorToModify = normalizeVector(
    embedding.length === 4096 ? embedding.slice(0, 4095) : embedding
  );
  const scaled = scaleVector(vectorToModify, importance);

  // |embedding| == 1
  // weight^2 + importance^2(|embedding|^2) == 1
  // weight = sqrt(1 - importance^2)
  const weight = Math.sqrt(1 - importance ** 2);
  return [...scaled, weight];
}

function normalizeVector(vector: number[]) {
  const sumOfSquares = vector.reduce((acc, v) => acc + v * v, 0);
  const magnitude = Math.sqrt(sumOfSquares);
  return magnitude === 0
    ? vector.map(() => 0)
    : vector.map((v) => v / magnitude);
}

function scaleVector(vector: number[], scale: number) {
  return vector.map((v) => v * scale);
}

export function modifyImportance(vector: number[], importance: number) {
  // Note: we don't need to handle 4096 explicitly here
  // vectorWithImportance will turn it from 4095 to 4096.
  const vectorToModify = vector.slice(0, vector.length - 1);
  return vectorWithImportance(vectorToModify, importance);
}

export function getImportance(vector: number[]) {
  return Math.sqrt(1 - vector[vector.length - 1] ** 2);
}

export function vectorWithImportanceDimension(dimensions: number) {
  // +1 for the importance weighting, but respect global limit
  return dimensions === 4096 ? 4096 : dimensions + 1;
}
