import { autoDevKey } from "./credentials.mjs";
import { autoDevPhotos, collectAutoDev } from "./auto-dev.mjs";

export function vehicleCapabilities(env = process.env) {
  return env.RELAY_VEHICLE_SEARCH === "1" ? ["vehicle_search"] : [];
}

export async function runVehicleJob(
  claimed,
  relayRequest,
  {
    getKey = autoDevKey,
    collect = collectAutoDev,
    photos = autoDevPhotos,
  } = {},
) {
  const endpoint = `/api/worker/runs/${claimed.run.id}/vehicles`;
  const lease = claimed.run.lease;
  // A heartbeat failure aborts this local collection before it can stage data
  // under a lease that another worker may have recovered.
  let leaseFailed = false;
  const heartbeat = setInterval(() => {
    relayRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({ action: "heartbeat", lease }),
    }).catch(() => {
      leaseFailed = true;
    });
  }, 30000);
  heartbeat.unref();
  try {
    const key = await getKey();
    const photoVin = claimed.run.job_payload?.photo_vin;
    if (photoVin) {
      const gallery = await photos({ key, vin: photoVin });
      if (leaseFailed)
        throw new Error("Vehicle worker lease could not be renewed.");
      return await retryRelay(() =>
        relayRequest(endpoint, {
          method: "POST",
          body: JSON.stringify({ action: "photos", lease, photos: gallery }),
        }),
      );
    }
    const result = await collect({ key, profile: claimed.profile });
    if (leaseFailed)
      throw new Error("Vehicle worker lease could not be renewed.");
    const { listings, ...health } = result;
    for (let offset = 0; offset < listings.length; offset += 50) {
      if (leaseFailed)
        throw new Error("Vehicle worker lease could not be renewed.");
      const init = {
        method: "POST",
        body: JSON.stringify({
          action: "batch",
          lease,
          batch: offset / 50,
          listings: listings.slice(offset, offset + 50),
        }),
      };
      await retryRelay(() => relayRequest(endpoint, init));
    }
    return await retryRelay(() =>
      relayRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({ action: "finalize", lease, health }),
      }),
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function retryRelay(action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch {
      if (attempt >= 2) throw new Error("Vehicle ingestion request failed.");
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}
