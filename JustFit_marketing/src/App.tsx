import JustFitHero from './demos/justfit-hero'
import JustFitCoach from './demos/justfit-coach'

// The landing page: the hero, then the AI Coach feature. Each demo is a
// Stageshow scene in src/demos.
export function App() {
  return (
    <main className="site">
      <section className="hero">
        <div className="hero__copy">
          <p className="hero__eyebrow">AI fitness and nutrition coach</p>
          <h1 className="hero__title">Eat to your plan. Your coach keeps up.</h1>
          <p className="hero__lede">
            justFit plans your meals and workouts, counts every calorie and macro you log, and adjusts the rest of your day the moment
            something changes.
          </p>
          <a className="hero__cta" href="#get-the-app">
            Get justFit
          </a>
        </div>
        <div className="hero__demo">
          <JustFitHero />
        </div>
      </section>

      <section className="feature" id="coach">
        <div className="feature__demo">
          <JustFitCoach />
        </div>
        <div className="feature__copy">
          <p className="hero__eyebrow">AI Coach</p>
          <h2 className="feature__title">Ask anything. Get an answer built from your plan.</h2>
          <p className="hero__lede">
            Priya knows what you planned and what you've logged today, so her answers come with real numbers, and the change she
            suggests goes into your meal plan with one tap.
          </p>
        </div>
      </section>
    </main>
  )
}
