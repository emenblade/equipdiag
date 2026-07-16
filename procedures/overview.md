# EquipDiag Procedure Library

## Stats
- **211 total procedures** across 10 equipment manuals
- **45 quick-access procedures** (service mode, calibration, fault code retrieval)
- **166 non-QA procedures** (repair, removal, adjustment, testing)

## Coverage by Model

| Model | Total | QA | Key Procedures |
|-------|-------|----|----------------|
| Genie S-60 / S-65 / TRAX | 35 | 11 | Joystick cal, fault codes, load sense cal, clear ECM |
| Genie S-80 / S-85 | 44 | 8 | Joystick cal, Continental fault codes, platform overload cal |
| Genie Z-80 / Z-80/60 | 11 | 6 | Boom angle sensor cal, level sensor cal |
| Genie GS-1930 / GS-2632 / GS-3232 | 32 | 2 | Platform overload cal, clear recovery msg |
| Genie 1932 / 2032 / 2046 | 36 | 3 | Outrigger cal, platform overload cal |
| Genie GR-15 / GR-20 | 29 | 4 | Software config/revision, level sensor cal |
| JLG 800S / 860SJ | 5 | 4 | Analyzer connect, access level, fault codes, level sensor cal |
| JLG 450AJ | 10 | 2 | System test flow charts |
| JLG G5-18A | 6 | 4 | Calibration, towing |
| Skyjack SJ46AJ | 3 | 1 | Load sensing system calibration |

## Extraction Method
- **Parser**: `raw-sources/extract-blocks.cjs` — block-based extraction from PDF text
- **Manual**: 5 most critical JLG/Skyjack procedures written by hand
- **EMR3**: 128 fault codes with full descriptions in `raw-sources/dtcodes-parsed.json`
