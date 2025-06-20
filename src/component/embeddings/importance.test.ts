import { describe, it, expect, beforeEach } from "vitest";
import {
  searchVector,
  vectorWithImportance,
  modifyImportance,
  getImportance,
  vectorWithImportanceDimension,
} from "./importance.js";

describe("importance.ts", () => {
  describe("searchVector", () => {
    it("should add a 0 to the end of a normal embedding", () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      const result = searchVector(embedding);

      expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0]);
      expect(result).toHaveLength(embedding.length + 1);
    });

    it("should handle 4096 dimension embeddings by slicing to 4095 and adding 0", () => {
      const embedding = new Array(4096).fill(0).map((_, i) => i / 4096);
      const result = searchVector(embedding);

      expect(result).toHaveLength(4096);
      expect(result[4095]).toBe(0);
      expect(result.slice(0, 4095)).toEqual(embedding.slice(0, 4095));
    });
  });

  function normalizeVector(vector: number[]) {
    const sumOfSquares = vector.reduce((acc, v) => acc + v * v, 0);
    const magnitude = Math.sqrt(sumOfSquares);
    return magnitude === 0
      ? vector.map(() => 0)
      : vector.map((v) => v / magnitude);
  }

  describe("vectorWithImportance", () => {
    it("should return normalized vector relative to importance", () => {
      const embedding = [0.6, 0.8]; // magnitude = 1.0
      const importance = 0.5;
      const result = vectorWithImportance(embedding, importance);

      expect(result).toHaveLength(3);
      expect(result[0]).toBeCloseTo(embedding[0] * importance);
      expect(result[1]).toBeCloseTo(embedding[1] * importance);
      expect(
        Math.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2)
      ).toBeCloseTo(1);
    });

    it("should handle maximum importance", () => {
      const embedding = [0.6, 0.8];
      const importance = 1.0;
      const result = vectorWithImportance(embedding, importance);

      expect(result).toHaveLength(3);
      expect(result[0]).toBeCloseTo(0.6);
      expect(result[1]).toBeCloseTo(0.8);
    });

    it("should handle minimum importance", () => {
      const embedding = [0.6, 0.8];
      const importance = 0.0;
      const result = vectorWithImportance(embedding, importance);

      expect(result).toHaveLength(3);
      expect(result[0]).toBeCloseTo(0);
      expect(result[1]).toBeCloseTo(0);
    });

    it("should handle 4096 dimension embedding by slicing to 4095", () => {
      const embedding = new Array(4096).fill(0.1);
      const importance = 0.5;
      const result = vectorWithImportance(embedding, importance);

      expect(result).toHaveLength(4096);
      expect(getImportance(result)).toBeCloseTo(0.5);
    });

    it("should properly normalize non-unit vectors", () => {
      const embedding = [3, 4]; // magnitude = 5
      const importance = 1;
      const result = vectorWithImportance(embedding, importance);

      // After normalization: [3/5, 4/5] = [0.6, 0.8]
      expect(result).toHaveLength(3);
      expect(result[0]).toBeCloseTo(0.6);
      expect(result[1]).toBeCloseTo(0.8);
    });
  });

  describe("getImportance", () => {
    it("should correctly extract importance from vector", () => {
      const vector = vectorWithImportance([0.1, 0.2, 0.3], 0.49);
      const importance = getImportance(vector);

      expect(importance).toBeCloseTo(0.49);
    });

    it("should handle zero importance", () => {
      const vector = [0.1, 0.2, 0.3, 0];
      const importance = getImportance(vector);

      expect(importance).toBe(1);
    });

    it("should handle maximum importance", () => {
      const vector = [0.1, 0.2, 0.3, 0];
      const importance = getImportance(vector);

      expect(importance).toBe(1);
    });
  });

  describe("modifyImportance", () => {
    it("should modify importance of existing vector", () => {
      const originalVector = [0.6, 0.8, Math.sqrt(0.75)]; // original importance = 0.25
      const newImportance = 0.64;
      const result = modifyImportance(originalVector, newImportance);

      expect(result).toHaveLength(3);
      expect(result[0]).toBeCloseTo(0.6 * newImportance);
      expect(result[1]).toBeCloseTo(0.8 * newImportance);
      expect(getImportance(result)).toBeCloseTo(0.64);
    });

    it("should handle zero importance modification", () => {
      const originalVector = [0.6, 0.8, 0.5];
      const newImportance = 0;
      const result = modifyImportance(originalVector, newImportance);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(1);
      expect(getImportance(result)).toBe(0);
    });
  });

  describe("vectorWithImportanceDimension", () => {
    it("should return dimensions + 1 for normal dimensions", () => {
      expect(vectorWithImportanceDimension(128)).toBe(129);
      expect(vectorWithImportanceDimension(256)).toBe(257);
      expect(vectorWithImportanceDimension(512)).toBe(513);
      expect(vectorWithImportanceDimension(1024)).toBe(1025);
      expect(vectorWithImportanceDimension(1536)).toBe(1537);
    });

    it("should return 4096 for 4096 input (respecting global limit)", () => {
      expect(vectorWithImportanceDimension(4096)).toBe(4096);
    });

    it("should handle edge cases", () => {
      expect(vectorWithImportanceDimension(0)).toBe(1);
      expect(vectorWithImportanceDimension(1)).toBe(2);
    });
  });

  describe("round-trip importance testing", () => {
    const testCases = [
      { importance: 0.0, tolerance: 0.001 },
      { importance: 0.1, tolerance: 0.001 },
      { importance: 0.25, tolerance: 0.001 },
      { importance: 0.5, tolerance: 0.001 },
      { importance: 0.75, tolerance: 0.001 },
      { importance: 1.0, tolerance: 0.001 },
    ];

    testCases.forEach(({ importance, tolerance }) => {
      it(`should round-trip importance value ${importance} approximately`, () => {
        const embedding = [0.6, 0.8]; // unit vector
        const vectorWithImp = vectorWithImportance(embedding, importance);
        const retrievedImportance = getImportance(vectorWithImp);

        expect(retrievedImportance).toBeCloseTo(importance, 3);
        expect(Math.abs(retrievedImportance - importance)).toBeLessThan(
          tolerance
        );
      });
    });

    it("should round-trip with non-unit vectors", () => {
      const embedding = [3, 4, 5]; // magnitude = sqrt(50)
      const originalImportance = 0.36;

      const vectorWithImp = vectorWithImportance(embedding, originalImportance);
      const retrievedImportance = getImportance(vectorWithImp);

      expect(retrievedImportance).toBeCloseTo(originalImportance, 3);
    });

    it("should round-trip after modifyImportance", () => {
      const embedding = [0.1, 0.2, 0.3];
      const initialImportance = 0.5;
      const newImportance = 0.8;

      // Create vector with initial importance
      const vectorWithInitialImp = vectorWithImportance(
        embedding,
        initialImportance
      );

      // Modify importance
      const vectorWithModifiedImp = modifyImportance(
        vectorWithInitialImp,
        newImportance
      );

      // Retrieve and verify
      const retrievedImportance = getImportance(vectorWithModifiedImp);
      expect(retrievedImportance).toBeCloseTo(newImportance, 3);
    });
  });

  describe("edge cases and error conditions", () => {
    it("should handle very small importance values", () => {
      const embedding = [1, 0];
      const importance = 1e-10;
      const result = vectorWithImportance(embedding, importance);

      expect(getImportance(result)).toBeCloseTo(importance);
    });

    it("should handle very large embeddings", () => {
      const embedding = new Array(2048).fill(0.1);
      const importance = 0.234;
      const result = vectorWithImportance(embedding, importance);

      expect(result).toHaveLength(2049);
    });

    it("should maintain vector properties after importance weighting", () => {
      const embedding = [0.6, 0.8]; // unit vector
      const importance = 0.25;
      const result = vectorWithImportance(embedding, importance);

      const normalized = normalizeVector(result.slice(0, 2));
      // The first two components should be normalized versions of original
      expect(normalized[0]).toBeCloseTo(0.6);
      expect(normalized[1]).toBeCloseTo(0.8);

      // When used in search (ignoring importance), should behave correctly
      const searchVec = searchVector(embedding);
      expect(searchVec[0]).toBeCloseTo(0.6);
      expect(searchVec[1]).toBeCloseTo(0.8);
    });
  });
});
