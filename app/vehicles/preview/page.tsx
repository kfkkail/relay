import { notFound } from "next/navigation";
import { VehiclesPreview } from "@/components/vehicles-preview";
import "../vehicles.css";

export const dynamic = "force-dynamic";

export default function Preview() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.RELAY_VEHICLES_PREVIEW !== "1"
  )
    notFound();
  return <VehiclesPreview />;
}
