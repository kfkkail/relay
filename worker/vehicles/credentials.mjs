export async function autoDevKey({ env = process.env } = {}) {
  const key = env.AUTODEV_API_KEY?.trim();
  if (!key)
    throw new Error(
      "Configure AUTODEV_API_KEY in the worker secret environment.",
    );
  return key;
}
