import { useEffect, useRef, type RefObject } from "react";

export const mobilePhotoQuery = "(max-width: 767px) and (pointer: coarse)";

export function constrainPhotoZoom(
  scale: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  scale = Math.min(4, Math.max(1, scale));
  if (scale === 1) return { scale: 1, x: 0, y: 0 };
  const maxX = (width * (scale - 1)) / 2;
  const maxY = (height * (scale - 1)) / 2;
  return {
    scale,
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  };
}

// Native, non-passive touch listeners keep a pinch local to the photo instead
// of zooming the entire page. Pointer handlers still own ordinary slide swipes.
export function useVehiclePhotoZoom(
  stageRef: RefObject<HTMLDivElement | null>,
  photoKey: string | undefined,
  cancelSwipe: () => void,
) {
  const consumingGesture = useRef(false);
  const cancelSwipeRef = useRef(cancelSwipe);
  useEffect(() => {
    cancelSwipeRef.current = cancelSwipe;
  });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const media = window.matchMedia(mobilePhotoQuery);
    let zoom = { scale: 1, x: 0, y: 0 };
    let previous: { x: number; y: number; distance: number } | null = null;
    const photo = () =>
      stage.querySelector<HTMLImageElement>('[aria-hidden="false"] img');
    let transformedImage: HTMLImageElement | null = null;
    const reset = () => {
      const image = transformedImage;
      if (image) image.style.transform = "";
      zoom = { scale: 1, x: 0, y: 0 };
      previous = null;
      consumingGesture.current = false;
    };
    const position = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1] ?? a;
      const rect = stage.getBoundingClientRect();
      return {
        x: (a.clientX + b.clientX) / 2 - rect.left - rect.width / 2,
        y: (a.clientY + b.clientY) / 2 - rect.top - rect.height / 2,
        distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
      };
    };
    const start = (event: TouchEvent) => {
      if (!media.matches || !photo()) return;
      if (event.touches.length > 1 || zoom.scale > 1) {
        consumingGesture.current = true;
        cancelSwipeRef.current();
        event.preventDefault();
      }
      previous = position(event.touches);
    };
    const move = (event: TouchEvent) => {
      if (!consumingGesture.current || !previous || !event.touches.length)
        return;
      event.preventDefault();
      const point = position(event.touches);
      const scale = Math.max(
        1,
        Math.min(
          4,
          zoom.scale *
            (previous.distance > 0 && point.distance > 0
              ? point.distance / previous.distance
              : 1),
        ),
      );
      const ratio = scale / zoom.scale;
      zoom = constrainPhotoZoom(
        scale,
        point.x - (previous.x - zoom.x) * ratio,
        point.y - (previous.y - zoom.y) * ratio,
        stage.clientWidth,
        stage.clientHeight,
      );
      const image = photo();
      if (image) {
        transformedImage = image;
        image.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
      }
      previous = point;
    };
    const end = (event: TouchEvent) => {
      previous = event.touches.length ? position(event.touches) : null;
      if (!event.touches.length) consumingGesture.current = false;
    };
    stage.addEventListener("touchstart", start, { passive: false });
    stage.addEventListener("touchmove", move, { passive: false });
    stage.addEventListener("touchend", end);
    stage.addEventListener("touchcancel", reset);
    media.addEventListener("change", reset);
    window.addEventListener("resize", reset);
    return () => {
      reset();
      stage.removeEventListener("touchstart", start);
      stage.removeEventListener("touchmove", move);
      stage.removeEventListener("touchend", end);
      stage.removeEventListener("touchcancel", reset);
      media.removeEventListener("change", reset);
      window.removeEventListener("resize", reset);
    };
  }, [stageRef, photoKey]);
  return consumingGesture;
}
