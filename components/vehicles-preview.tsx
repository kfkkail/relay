"use client";

import { useState } from "react";
import { Vehicles } from "@/components/vehicles";
import { createVehiclePreviewRequest } from "@/lib/vehicles/preview";

export function VehiclesPreview() {
  const [request] = useState(() => createVehiclePreviewRequest());
  return (
    <>
      <Vehicles userEmail="sample@relay.local" request={request} preview />
      <footer className="vehicle-preview-credits">
        Illustrative photos, not the sample vehicles or live listings. Wikimedia
        Commons:{" "}
        <a href="https://commons.wikimedia.org/wiki/File:2022_Rivian_R1T_Adventure_in_Forest_Green,_front_left.jpg">
          Forest Green — Mr.choppers
        </a>{" "}
        (
        <a href="https://creativecommons.org/licenses/by-sa/3.0/">
          CC BY-SA 3.0
        </a>
        ),{" "}
        <a href="https://commons.wikimedia.org/wiki/File:2022_Rivian_R1T_(in_Glacier_White),_front_6.21.22.jpg">
          Glacier White — Kevauto
        </a>{" "}
        and{" "}
        <a href="https://commons.wikimedia.org/wiki/File:Rivian_R1T_-_2nd_Row_02.png">
          interior — Curlyrnd
        </a>{" "}
        (
        <a href="https://creativecommons.org/licenses/by-sa/4.0/">
          CC BY-SA 4.0
        </a>
        ). Photos scaled and cropped for display.
      </footer>
    </>
  );
}
