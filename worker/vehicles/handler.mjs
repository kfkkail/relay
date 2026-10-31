import { autoDevKey } from "./credentials.mjs";
import { autoDevPhotos, collectAutoDev } from "./auto-dev.mjs";
import { enrichSellerListings } from "./detail-enrichment.mjs";
import { enrichVehicle } from "./browser-enrichment.mjs";

export function vehicleCapabilities(env = process.env) {
  return env.RELAY_VEHICLE_SEARCH === "1"
    ? ["vehicle_search", "vehicle_enrichment"]
    : [];
}

export async function runVehicleJob(
  claimed,
  relayRequest,
  {
    getKey = autoDevKey,
    collect = collectAutoDev,
    enrich = enrichSellerListings,
    photos = autoDevPhotos,
    detail = enrichVehicle,
  } = {},
) {
  const endpoint = `/api/worker/runs/${claimed.run.id}/vehicles`;
  const lease = claimed.run.lease;
  // Bound uploads/finalization as well as provider requests. A stalled Relay
  // connection must not keep renewing an otherwise abandoned vehicle job.
  const request = (body) =>
    relayRequest(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  // A heartbeat failure aborts this local collection before it can stage data
  // under a lease that another worker may have recovered.
  let leaseFailed = false;
  const heartbeat = setInterval(() => {
    request({ action: "heartbeat", lease }).catch(() => {
      leaseFailed = true;
    });
  }, 30000);
  heartbeat.unref();
  try {
    if (claimed.run.job_payload?.detail_vehicle) {
      const attributes = await detail(claimed.run.job_payload);
      if (leaseFailed)
        throw new Error("Vehicle worker lease could not be renewed.");
      return await retryRelay(() =>
        request({ action: "enrichment", lease, attributes }),
      );
    }
    const key = await getKey();
    const photoVin = claimed.run.job_payload?.photo_vin;
    if (photoVin) {
      const gallery = await photos({ key, vin: photoVin });
      if (leaseFailed)
        throw new Error("Vehicle worker lease could not be renewed.");
      return await retryRelay(() =>
        request({ action: "photos", lease, photos: gallery }),
      );
    }
    const collected = await collect({ key, profile: claimed.profile });
    const enrichment = await enrich({
      listings: collected.listings,
      profile: claimed.profile,
    });
    const result = {
      ...collected,
      counts: { ...collected.counts, ...enrichment.counts },
      listings: enrichment.listings,
    };
    if (leaseFailed)
      throw new Error("Vehicle worker lease could not be renewed.");
    const { listings, ...health } = result;
    for (let offset = 0; offset < listings.length; offset += 50) {
      if (leaseFailed)
        throw new Error("Vehicle worker lease could not be renewed.");
      const body = {
        action: "batch",
        lease,
        batch: offset / 50,
        listings: listings.slice(offset, offset + 50),
      };
      await retryRelay(() => request(body));
    }
    return await retryRelay(() =>
      request({ action: "finalize", lease, health }),
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
