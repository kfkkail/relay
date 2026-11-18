import type { VehicleRecord } from "../../lib/vehicles/types";
type Nhtsa = NonNullable<VehicleRecord["nhtsa"]>;
export const RIVIAN_GEN1_BATTERIES: ReadonlyArray<{
  pack: string;
  official_kwh: number;
  raw_kwh: number;
}>;
export function rivianGen1Battery(
  capacity: number,
  identity?: { year?: unknown; make?: unknown; model?: unknown },
): (typeof RIVIAN_GEN1_BATTERIES)[number] | null;
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
