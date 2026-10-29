# Vehicles visual review

The desktop, mobile and mobile-dark PNGs show the real Vehicles interface using
isolated sample data, not a live search, production database or complete inventory.
Screenshots were taken with no open notification overlays or development badge.

The design uses Relay's shared header, colors, type, buttons and filter controls.
Cards focus on photos, prices, mileage and location, with secondary facts under
Details & sources. Mobile queues are selectable without horizontal clipping.
Pass, Watch and Shortlist are the review actions; Passed requires explicit restore.

The local preview is `/vehicles/preview`, with `RELAY_VEHICLES_PREVIEW=1` and a
development server. The route is unavailable in production. Profile/decision
changes stay in memory and reset when reloaded; no real inventory is modified
and no worker jobs or Auto.dev requests are created. Global account controls are
disabled in the sample. Unit tests assert isolation and production gating.

Browser checks covered 1440px desktop, 390px and 320px mobile, light/dark modes,
header navigation, queue selection, Pass/Undo/restore, Watch, verification,
focus trapping/Escape, gallery selection, profile re-evaluation and actual pointer
swipes across photos without opening a gallery. No page errors or live vehicle
API requests were observed.

## Photo attribution

The sample photographs do not depict the fictitious listings. The PNGs contain
scaled/cropped photography from Wikimedia Commons under CC BY-SA licenses:

- Forest Green: [Mr.choppers, CC BY-SA 3.0](https://commons.wikimedia.org/wiki/File:2022_Rivian_R1T_Adventure_in_Forest_Green,_front_left.jpg).
- Glacier White: [Kevauto, CC BY-SA 4.0](<https://commons.wikimedia.org/wiki/File:2022_Rivian_R1T_(in_Glacier_White),_front_6.21.22.jpg>).
- Interior: [Curlyrnd, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Rivian_R1T_-_2nd_Row_02.png).

See [full credits and licenses](../../public/vehicles-demo/CREDITS.md). Keep this
attribution with screenshots when sharing them. These photos are preview assets,
not an entitlement to use or store images from a vehicle-listing provider.
