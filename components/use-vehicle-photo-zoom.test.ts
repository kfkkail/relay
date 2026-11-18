import { describe, expect, it } from "vitest";
import { constrainPhotoZoom } from "./use-vehicle-photo-zoom";

describe("mobile vehicle photo zoom bounds", () => {
  it("returns the image to its original position when pinched back to fit", () => {
    expect(constrainPhotoZoom(0.5, 120, -90, 400, 300)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
  });
  it("limits enlargement and prevents panning beyond the scaled image", () => {
    expect(constrainPhotoZoom(8, 900, -900, 400, 300)).toEqual({
      scale: 4,
      x: 600,
      y: -450,
    });
  });
  it("preserves movement within the visible bounds", () => {
    expect(constrainPhotoZoom(2, 75, -50, 400, 300)).toEqual({
      scale: 2,
      x: 75,
      y: -50,
    });
  });
});
