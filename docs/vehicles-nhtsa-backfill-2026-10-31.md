# NHTSA backfill — 2026-10-31

The owner requested VIN decoding for all stored Relay vehicles. The operator
backfill used the existing Supabase CLI Management API login; no API keys were
exported. It added the isolated `vehicles.nhtsa` evidence column and processed
all 575 confirmed VINs, including every review queue and availability state.

| Result                                           | Vehicles |
| ------------------------------------------------ | -------: |
| Clean, exact-VIN decode saved                    |      575 |
| Explicit motor configuration                     |      568 |
| Battery capacity reported                        |      240 |
| Explicit battery-pack name in `BatteryInfo`      |        7 |
| Failed decoding / missing VIN / changed identity |        0 |

The seven named packs were five **Max Pack**, one **Large Pack**, and one
**Standard Pack**, exactly as returned in `BatteryInfo`. No capacity-to-pack
conversion was used. All other named packs remain unresolved by this source.
Only `vehicles.nhtsa` was updated; owner overrides, decisions, seller evidence,
listing snapshots, coverage and notification state were not written.

The matching web deployment is still required to display this evidence and
apply it as a fallback for unknown fields. The migration uses `if not exists`
so the normal deployment can record the already-added column safely. A repeat
backfill skips clean results for the same VIN for 30 days.

Separately, the owner's native Chromium probe on the Pi and the updated local
public-only Chromium transport both returned Carvana HTTP 403 challenges. No
seller configuration was obtained by those probes. Local fixture tests verify
cookie-backed JavaScript rendering and specs-panel interaction, not live access
to Carvana. Model control of the same blocked session is not an access fix.
