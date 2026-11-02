# Vehicle exterior and interior colors from a VIN

A VIN alone cannot reliably tell Relay a vehicle's exterior paint or interior
color. It can be used as a lookup key for a separate vehicle-specific listing,
factory build record, or window sticker. Whether that lookup succeeds depends
on the source's coverage, not on decoding more VIN characters.

For Relay, the recommended first step is to check whether the existing Auto.dev
inventory response supplies actual listing colors, preserve them if it does,
and support owner confirmation. Do not purchase a specifications endpoint on
the assumption that its color list describes the individual vehicle.

## What is possible

| Source                                                  | Exterior color            | Interior color              | Interpretation                                                                                 |
| ------------------------------------------------------- | ------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| VIN characters / NHTSA vPIC                             | Not supplied              | Not supplied                | Keep unknown; retrying the decoder will not recover paint or upholstery.                       |
| VIN-matched OEM build record or original window sticker | Often factory name/code   | Often factory trim/color    | Strong factory evidence when explicitly recorded; access and Rivian coverage must be verified. |
| VIN-matched inventory or seller listing                 | Possible                  | Possible, but may be absent | Seller-reported, potentially stale or mistaken; not proof of factory configuration.            |
| Model/style specification catalog                       | Available paint choices   | Available interior choices  | Options offered for the model/style, not the selected options on this VIN.                     |
| Photos                                                  | Approximate visible color | Approximate visible color   | Lighting, stock photos, wraps and modifications prevent reliable paint-code identification.    |
| Owner/dealer confirmation or vehicle labels             | Possible                  | Possible                    | Record the evidence and distinguish current appearance from factory configuration.             |

Generic “color” should mean exterior color in the UI, with interior shown
separately. Preserve the original marketing name (for example, a named Rivian
paint) separately from a broad family such as green. Interior color is also
separate from upholstery material and trim. A family or photograph is not enough
to invent an OEM paint code. Two-tone colors should retain both components.

A factory lookup cannot establish the current color after repainting, wrapping,
or interior replacement. Keep factory configuration and current observed color
separate if both are needed.

## Current Relay implementation

Reviewed GitHub main at `dc3e636` on 2026-11-02. The original local checkout was
older and lacked Vehicles; these findings refer to the current remote code.

- `worker/vehicles/auto-dev.mjs`, `normalizeAutoDev`, maps inventory identity,
  listing, history, configuration and photos, but does not map any color fields.
- `lib/vehicles/types.ts`, `VehicleListing`, has no exterior/interior color
  properties. Photo categories named exterior/interior describe photos, not colors.
- `worker/vehicles/nhtsa.mjs` extracts identity, motor and battery facts.
  `lib/vehicles/nhtsa-backfill.ts` stores this evidence in `vehicles.nhtsa`.
  Neither supplies colors.
- `docs/vehicles.md` describes Auto.dev inventory, optional seller enrichment,
  owner verification and NHTSA decoding. Its proposed paid Specifications API
  path must not be treated as proof of the selected color.

This PR documents feasibility only; it does not add color capture, change vehicle
records, call authenticated inventory endpoints, or enable a paid service.

## Recommended implementation follow-up

1. Inspect permitted Auto.dev inventory responses for a representative sample of
   Relay's actual Rivian VINs. Confirm exact field paths and whether values are
   listing-specific, factory-specific, or merely available options. Measure
   exterior and interior coverage separately and compare with original listings.
   No live account sample was taken for this assessment.
2. Add nullable exterior and interior values through normalization, validation,
   listing storage, review UI and owner verification. Store each value's raw name,
   optional normalized family/code, source URL/type, timestamp and verification
   status. Old records must continue to render as Unknown.
3. Present listing colors as “Seller reported.” Allow independent confirmation of
   each color. Preserve owner-confirmed values during imports; flag contradictory
   sources rather than silently replacing them. Keep seller evidence tied to its
   listing context, and associate factory evidence only with the exact VIN.
4. For missing colors on Interested/Shortlist vehicles, request a VIN-matched
   sticker/build record or dealer confirmation. Consider a licensed build-data
   provider only after validating Rivian model-year coverage, actual installed
   color fields, storage rights and cost. Do not infer a color from trim, year,
   VIN patterns, or the first item in an options array.
5. Test missing/blank values, partial exterior-only data, two-tone labels, option
   arrays, contradictory listings, seller changes, VIN identity changes and
   preservation of owner corrections before enabling ingestion. Color absence
   should not exclude a vehicle unless a future explicit preference requires it.

## Evidence and validation

Public sources checked on 2026-11-02:

- [NHTSA vehicle variable list](https://vpic.nhtsa.dot.gov/api/vehicles/getvehiclevariablelist?format=json):
  live JSON returned 145 variables, with no variable names matching color,
  colour, paint or upholstery. This supports the absence of dedicated color
  fields; it is not a test of Relay's actual inventory VINs.
- [NHTSA API documentation](https://vpic.nhtsa.dot.gov/api/): describes the
  manufacturer-submitted VIN/specification data used by Relay's decoder.
- [DataOne VIN decoder explanation](https://www.dataonesoftware.com/vin-decoder):
  explicitly lists exterior color, interior color and upholstery as not encoded
  in the VIN and explains enrichment from additional data. This is not a verified
  guarantee of DataOne's Rivian build-data coverage.
- [Auto.dev Specifications API](https://docs.auto.dev/v2/products/specifications):
  documents **Color Options** and example arrays at `color.exterior` and
  `color.interior`. Those arrays must not be interpreted as installed colors.
  The page lists Growth/Scale access and ambiguous-style handling. Even a
  uniquely resolved style does not establish the chosen paint or interior.
- [Auto.dev Vehicle Listings API](https://docs.auto.dev/v2/products/vehicle-listings):
  supports VIN-based listing retrieval. Color field paths and coverage in the
  owner's actual responses remain unverified.

Validation for this documentation-only change consists of source inspection,
public documentation/API checks, Markdown formatting and Git diff whitespace
checks. No application behavior changed, so no application test suite or
production backfill is required. No paid-provider coverage, current vehicle
colors, or deployed database state is claimed as verified.
