# justFit marketing

The landing page and its product visuals: animated iPhone demos of the app, built with the Stageshow kit (`src/kit`, MIT, see `src/kit/STAGESHOW-LICENSE`). React 18 + Vite; no backend, no secrets, no third-party scripts.

```sh
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # type-checks, then writes dist/
```

## Demos

| Demo | Folder | Status |
|---|---|---|
| Hero: lunch reminder → plan → Log meal → calories and macros update → coach tip | `src/demos/justfit-hero` | Done, rehearsed (`REHEARSAL.md`) |
| AI Coach: "How can I reach my protein goal today?" → answer → Apply a dinner swap | `src/demos/justfit-coach` | Done, rehearsed |
| Weekly plan: Monday expands to meals, calories and workout | — | Planned |
| Nutrition tracking: calories and macros as a meal is logged | — | Planned |

Each demo is one React component (`<JustFitHero />`) that scales to its container: the wide design is 460 × 680, and below 460px it switches to its compact design (358 wide) for phone columns. Under `prefers-reduced-motion` it shows a still poster frame (the final beat) instead of playing. It pauses when scrolled offscreen.

## Brand

The demos use the app's own tokens (`JustFit_client/src/theme/tokens.css`): brand red `#d40005`, ink `#111111`, page `#f4f4f5`, white cards with 20px corners, and the macro colours (protein `#6cc28a`, carbs `#a9a3f0`, fat `#f2c14e`). Poppins (OFL, `assets/Poppins-OFL.txt`) is bundled as woff2. Images come from `JustFit_client/assets/images` (the app icon, the paneer tikka photo, Priya's coach photo).

The app's React Native components don't run on the web, so each screen is rebuilt in HTML from the real component (CaloriesCard, MealCard, the coach's Log button) with the same sizes and colours. When the app's look changes, update the demo's CSS to match.

## Placeholders

- The `Get justFit` button links to `#get-the-app`; point it at the App Store / Play Store pages once they exist.
- The hero copy is a first draft.
