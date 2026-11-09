# justFit: iOS vs Android feature parity (2026-11-08)

"Same" means the same code path works on both. "Native" means each phone uses its own system
look on purpose. Verification: **code** = confirmed by reading the code and library sources;
**device** = checked on the OnePlus CPH2467 (Android 15, 360×800, gesture navigation);
**web** = the seven-width web suite. No iPhone or iOS simulator was available (no iOS simulator
runtime installed on this Mac), so every iOS cell is verified from code only.

| Feature | iOS | Android | Status after this pass | Verified |
| --- | --- | --- | --- | --- |
| Phone sign-in, code sheet | same | same | Android keyboard covered the number field and the code sheet: **fixed** (`KeyboardAvoider`, nav-bar offset in `VerificationModal`) | code; Android keyboard fix device-checked on a gym form |
| SMS code autofill | QuickType (`oneTimeCode`) | Autofill / Gboard (`one-time-code` → `sms-otp`) | native, both set | code |
| Camera photo (body scan, food scan, member photo, bills, logo) | same | same | permission asked first on both; Android "app killed while camera open" not recovered (see remaining) | code |
| Gallery | system picker | system picker | same | code |
| Image upload | shrunk on the phone, same JPEG | same | same | code |
| Invoice PDF share | expo-print + share sheet | same, content URI | same | code |
| Attendance CSV export | share sheet | share sheet | same | code |
| Admin App Usage CSV export | saved to private cache (unreachable) | same | **fixed**: share sheet on both, timeout, never spins forever | code |
| QR attendance (scan, deep link `justfit://attendance`) | same | same | scanner hint under the nav bar / home indicator: **fixed**; back now steps back inside the flow | code |
| GPS check | `isSimulatedBySoftware` | Android mock flag | native, both feed `mocked` | code |
| Maps | Apple Maps (or Google with key) | Google Maps | native; Android draws square corners (cosmetic, remaining) | device (map renders) |
| Local meal reminders | on time | may fire late under Doze (no exact-alarm permission) | remaining, documented | code |
| Voice input, phone recogniser | Apple | Google | same | code |
| Voice input, server transcription | AAC m4a | **was 3GP/AMR labelled m4a** | **fixed**: AAC m4a 64 kbps on both (needs a new dev build) | code |
| Sharing (`Share`) | same | same | same | code |
| Back gesture / button | edge swipe | system + predictive back | confirm cards (scan report, measurements), attendance steps and unsaved Role & Permission edits now handled on both; workout prompts now take Android back | code |
| Keyboard on forms | worked | **covered fields on every form** | **fixed** everywhere (11 screens, 8 admin forms, gym sheets, HUD) | device (Android) |
| Haptics | same | same | same | code |
| Confirmations / action sheets | UIKit sheet | Material dialog / app sheet | native; Android action sheet's Cancel was under the nav bar: **fixed** | code |
| Date pickers | spinner in a sheet | system dialog | native | code |
| HUD feedback | centred HUD | snackbar | native; snackbar hidden behind the keyboard on Android: **fixed** | code |
| Calls from enquiries | `tel:` prompt | dialer | "How did it go?" after a cancelled iOS call: **fixed** | code |
| WhatsApp / SMS / email links | `&body=` | `?body=` | same, no `<queries>` needed for `openURL` | code |

No feature exists on one phone and is missing on the other. Push notifications from a server, file
downloads to shared storage and a "Notification" reminder channel are not built on either phone.
