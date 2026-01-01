import { describe, it, expect } from "vitest";
import { distanceChebyshev, clampToGrid } from "./movement";
import type { Grid, Position } from "../types";

describe("combat movement", () => {
  describe("distanceChebyshev", () => {
    it("should calculate Chebyshev distance correctly", () => {
      const pos1: Position = { x: 0, y: 0 };
      const pos2: Position = { x: 3, y: 4 };

      const distance = distanceChebyshev(pos1, pos2);

      expect(distance).toBe(4); // max(3, 4) = 4
    });

    it("should handle same position", () => {
      const pos: Position = { x: 5, y: 5 };

      const distance = distanceChebyshev(pos, pos);

      expect(distance).toBe(0);
    });

    it("should handle negative coordinates", () => {
      const pos1: Position = { x: -2, y: -3 };
      const pos2: Position = { x: 1, y: 1 };

      const distance = distanceChebyshev(pos1, pos2);

      expect(distance).toBe(4); // max(3, 4) = 4
    });

    it("should handle diagonal movement", () => {
      const pos1: Position = { x: 0, y: 0 };
      const pos2: Position = { x: 5, y: 5 };

      const distance = distanceChebyshev(pos1, pos2);

      expect(distance).toBe(5);
    });
  });

  describe("clampToGrid", () => {
    it("should clamp position to grid bounds", () => {
      const grid: Grid = { width: 10, height: 10 };
      const pos: Position = { x: 15, y: 20 };

      const clamped = clampToGrid(pos, grid);

      expect(clamped.x).toBe(9);
      expect(clamped.y).toBe(9);
    });

    it("should clamp negative coordinates to 0", () => {
      const grid: Grid = { width: 10, height: 10 };
      const pos: Position = { x: -5, y: -10 };

      const clamped = clampToGrid(pos, grid);

      expect(clamped.x).toBe(0);
      expect(clamped.y).toBe(0);
    });

    it("should keep valid positions unchanged", () => {
      const grid: Grid = { width: 10, height: 10 };
      const pos: Position = { x: 5, y: 5 };

      const clamped = clampToGrid(pos, grid);

      expect(clamped.x).toBe(5);
      expect(clamped.y).toBe(5);
    });

    it("should handle edge cases", () => {
      const grid: Grid = { width: 10, height: 10 };
      const pos1: Position = { x: 0, y: 0 };
      const pos2: Position = { x: 9, y: 9 };

      const clamped1 = clampToGrid(pos1, grid);
      const clamped2 = clampToGrid(pos2, grid);

      expect(clamped1.x).toBe(0);
      expect(clamped1.y).toBe(0);
      expect(clamped2.x).toBe(9);
      expect(clamped2.y).toBe(9);
    });
  });
});

