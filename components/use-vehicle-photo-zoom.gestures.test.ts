import { afterEach, expect, it, vi } from "vitest";
import { useVehiclePhotoZoom } from "./use-vehicle-photo-zoom";

const lifecycle = vi.hoisted(() => ({ cleanup: [] as (() => void)[] }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) lifecycle.cleanup.push(cleanup);
  },
}));
afterEach(() => {
  lifecycle.cleanup.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});
function setup(mobile = true) {
  const image = { style: { transform: "" } };
  const stage = Object.assign(new EventTarget(), {
    clientWidth: 400,
    clientHeight: 300,
    querySelector: () => image,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
  });
  const media = Object.assign(new EventTarget(), { matches: mobile });
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      matchMedia: () => media,
    }),
  );
  const cancelSwipe = vi.fn();
  // React hooks are mocked above to exercise native event listeners directly.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const consuming = useVehiclePhotoZoom(
    { current: stage as unknown as HTMLDivElement },
    "photo",
    cancelSwipe,
  );
  const touch = (type: string, points: number[][]) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, {
      touches: points.map(([clientX, clientY]) => ({ clientX, clientY })),
    });
    stage.dispatchEvent(event);
    return event;
  };
  return { image, cancelSwipe, consuming, touch, media };
}
it("pinches the photo, suppresses carousel swipes, and pans until all fingers lift", () => {
  const { image, cancelSwipe, consuming, touch } = setup();
  touch("touchstart", [[150, 150]]);
  expect(consuming.current).toBe(false);
  touch("touchstart", [
    [150, 150],
    [250, 150],
  ]);
  expect(cancelSwipe).toHaveBeenCalledOnce();
  expect(
    touch("touchmove", [
      [100, 150],
      [300, 150],
    ]).defaultPrevented,
  ).toBe(true);
  expect(image.style.transform).toBe("translate(0px, 0px) scale(2)");
  touch("touchend", [[100, 150]]);
  touch("touchmove", [[120, 160]]);
  expect(image.style.transform).toBe("translate(20px, 10px) scale(2)");
  expect(consuming.current).toBe(true);
  touch("touchend", []);
  expect(consuming.current).toBe(false);
  lifecycle.cleanup.splice(0).forEach((cleanup) => cleanup());
  expect(image.style.transform).toBe("");
});
it("leaves desktop gestures unchanged", () => {
  const { image, cancelSwipe, touch } = setup(false);
  touch("touchstart", [
    [150, 150],
    [250, 150],
  ]);
  expect(
    touch("touchmove", [
      [100, 150],
      [300, 150],
    ]).defaultPrevented,
  ).toBe(false);
  expect(cancelSwipe).not.toHaveBeenCalled();
  expect(image.style.transform).toBe("");
});

it("resumes ordinary swipes after pinching back to fit", () => {
  const { consuming, image, touch } = setup();
  touch("touchstart", [
    [150, 150],
    [250, 150],
  ]);
  touch("touchmove", [
    [100, 150],
    [300, 150],
  ]);
  touch("touchmove", [
    [150, 150],
    [250, 150],
  ]);
  expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
  expect(consuming.current).toBe(true);
  touch("touchend", []);
  expect(touch("touchstart", [[150, 150]]).defaultPrevented).toBe(false);
  expect(consuming.current).toBe(false);
});

it.each(["touchcancel", "resize"])("resets zoom on %s", (type) => {
  const { consuming, image, touch } = setup();
  touch("touchstart", [
    [150, 150],
    [250, 150],
  ]);
  touch("touchmove", [
    [100, 150],
    [300, 150],
  ]);
  if (type === "resize") window.dispatchEvent(new Event(type));
  else touch(type, []);
  expect(image.style.transform).toBe("");
  expect(consuming.current).toBe(false);
});

it("clears enlargement when switching out of the mobile layout", () => {
  const { image, consuming, touch, media } = setup();
  touch("touchstart", [
    [150, 150],
    [250, 150],
  ]);
  touch("touchmove", [
    [100, 150],
    [300, 150],
  ]);
  media.matches = false;
  media.dispatchEvent(new Event("change"));
  expect(image.style.transform).toBe("");
  expect(consuming.current).toBe(false);
  expect(
    touch("touchstart", [
      [150, 150],
      [250, 150],
    ]).defaultPrevented,
  ).toBe(false);
});
