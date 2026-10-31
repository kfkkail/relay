import type { VehicleRecord } from "../../lib/vehicles/types";
type Nhtsa = NonNullable<VehicleRecord["nhtsa"]>;
export function decodeNhtsa(
  vin: string,
  options?: { year?: unknown; fetchImpl?: typeof fetch; now?: () => Date },
): Promise<Nhtsa>;
export function decodeNhtsaResult(
  payload: unknown,
  vin: string,
  sourceUrl: string,
  now?: Date,
): Nhtsa;
export function freshNhtsa(value: unknown, vin: string, now?: number): boolean;
