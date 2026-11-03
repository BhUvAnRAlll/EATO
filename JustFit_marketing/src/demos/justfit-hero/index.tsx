import { Stage, Phone, LockScreen, Notification, Expand, Collapse, Roll, States, Stream, Bar, Icon, type Act } from '../../kit'
import logo from './assets/icon.png'
import paneer from './assets/paneer.jpg'
import priya from './assets/coach-priya-face.jpg'
import './justfit.css'

// justFit's landing-page hero, phone only. Story in five beats:
// a lunch reminder on the lock screen is tapped and the app opens out of it
// (open); today's plan loads into its cards (plan); Log meal on lunch (log);
// the calories ring and the three macros roll to the new day (result); the
// coach answers the new numbers with one protein tip (payoff). It loops the
// way a phone does: it locks, the day is reset unseen, and the next reminder
// arrives on the lock screen.
//
// Figures change with Roll rather than Count: Count sets tabular digits, and
// Poppins' tabular 1 leaves a gap ("1 ,040") the app never shows.
//
// The screen is the app's own Macro look (theme tokens, Poppins, the
// CaloriesCard ring and macro tracks, the shared MealCard), rebuilt for the
// web from JustFit_client because the app's React Native views don't run here.
//
// Real strings: the notification, Today, the kcal figures, the three macros,
// Paneer tikka bowl and its chips, Log meal / Logged, Priya's tip.

type App = 'off' | 'on'
type S = { app: App; open: boolean; lit: boolean; cover: boolean; notif: boolean; plan: boolean; logged: boolean; fed: boolean; coach: boolean; words: number }

const TIP = 'You’re 68 g short on protein today. Have a bowl of Greek curd at 5 PM and swap dinner for tandoori chicken.'
const WORDS = TIP.split(' ').length

const START: S = { app: 'off', open: false, lit: false, cover: false, notif: true, plan: false, logged: false, fed: false, coach: false, words: 0 }
const POSTER: S = { app: 'on', open: true, lit: true, cover: false, notif: false, plan: true, logged: true, fed: true, coach: true, words: WORDS }

// The day before and after lunch is logged, against a 2,000 kcal target
const TARGET = { kcal: 2000, p: 120, c: 230, f: 60 }
const BEFORE = { kcal: 420, p: 18, c: 58, f: 12 }
const LUNCH = { kcal: 540, p: 34, c: 48, f: 22 }
const AFTER = { kcal: BEFORE.kcal + LUNCH.kcal, p: BEFORE.p + LUNCH.p, c: BEFORE.c + LUNCH.c, f: BEFORE.f + LUNCH.f }

const MACROS = [
  { key: 'p', label: 'Protein', color: 'var(--jf-protein)' },
  { key: 'c', label: 'Carbs', color: 'var(--jf-carbs)' },
  { key: 'f', label: 'Fat', color: 'var(--jf-fat)' },
] as const

// A flat lock screen in the app's own near-black (inverse), not a decorative gradient
const WALL = '#1c1c1e'

const inr = (n: number) => Math.round(n).toLocaleString('en-IN')

const REST = { wide: { x: 300, y: 560 }, compact: { x: 250, y: 520 } }

const script = async (a: Act<S>) => {
  await a.wait(1000)
  a.mark('open')
  await a.click('notif')
  a.put({ open: true, app: 'on', notif: false })
  // The status bar turns dark once the app has covered the top, not before:
  // the banner it grows out of keeps its lock screen look
  await a.wait(320)
  a.put({ lit: true })
  await a.wait(380)
  a.mark('plan')
  a.put({ plan: true })
  await a.wait(1500)
  a.mark('log')
  await a.click({ at: 'log', x: 0.5, y: 0.5 })
  a.put({ logged: true })
  await a.wait(350)
  a.put({ fed: true })
  await a.wait(1400)
  a.mark('coach')
  // The card opens with its first words in, so it never arrives blank
  a.put({ coach: true, words: 3 })
  await a.wait(500)
  for (let i = 4; i <= WORDS; i++) {
    a.put({ words: i })
    await a.wait(45)
  }
  await a.wait(2600)
  a.mark('lock')
  // The phone locks: the lock screen comes down over the app as iOS's cover
  // sheet does, never back into the banner. Under it the day is reset unseen,
  // then the cover hands over to the identical lock screen beneath
  a.put({ cover: true, lit: false })
  await a.wait(650)
  await a.snap({ app: 'off', open: false, cover: false, plan: false, logged: false, fed: false, coach: false, words: 0 })
  await a.wait(150)
  a.put({ notif: true })
  // The finger lifts away; the touch style shows nothing between taps
  await a.move(REST[a.layout])
}

function Ring({ value, target }: { value: number; target: number }) {
  const size = 132
  const stroke = 12
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="jf-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--jf-line)" strokeWidth={stroke} />
        <circle
          className="jf-ring__arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--jf-primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / target)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="jf-ring__text">
        <span className="jf-hero-number">
          <Roll>{inr(target - value)}</Roll>
        </span>
        <span className="jf-of">kcal left</span>
      </span>
    </div>
  )
}

function TheApp({ s }: { s: S }) {
  const day = s.fed ? AFTER : BEFORE
  return (
    <div className="jf-app__screen">
      <header className="jf-head">
        <span className="jf-head__text">
          <span className="jf-note">Monday, 2 November</span>
          <span className="jf-title">Today</span>
        </span>
        <img className="jf-coach-face" src={priya} alt="" width={40} height={40} />
      </header>

      <div className="jf-stack">
        <section className="jf-card jf-calories">
          <div className="jf-calories__top">
            <Ring value={day.kcal} target={TARGET.kcal} />
            <div className="jf-calories__stats">
              <span className="jf-stat">
                <span className="jf-overline">Eaten</span>
                <span className="jf-stat__line">
                  <span className="jf-stat__value"><Roll>{inr(day.kcal)}</Roll></span>
                  <span className="jf-of">kcal</span>
                </span>
              </span>
              <span className="jf-stat">
                <span className="jf-overline">Target</span>
                <span className="jf-stat__line">
                  <span className="jf-stat__value">{inr(TARGET.kcal)}</span>
                  <span className="jf-of">kcal</span>
                </span>
              </span>
            </div>
          </div>
          <div className="jf-macros">
            {MACROS.map((m, i) => (
              <span key={m.key} className="jf-macro">
                <span className="jf-macro__head">
                  <span className="jf-macro__label">{m.label}</span>
                  <span className="jf-macro__value">
                    <Roll align="end">{`${day[m.key]}/${TARGET[m.key]}g`}</Roll>
                  </span>
                </span>
                <span className="jf-track">
                  <span className="jf-track__fill" style={{ width: `${(day[m.key] / TARGET[m.key]) * 100}%`, background: m.color, transitionDelay: `${120 + i * 60}ms` }} />
                </span>
              </span>
            ))}
          </div>
        </section>

        <Collapse open={s.coach} reveal="drop" className="jf-coach-slot">
          <section className="jf-card jf-coach">
            <span className="jf-coach__who">
              <img className="jf-coach__face" src={priya} alt="" width={32} height={32} />
              <span className="jf-coach__name">Priya</span>
              <span className="jf-coach__role">AI Coach</span>
            </span>
            <Stream className="jf-coach__tip" text={TIP} count={s.words} />
          </section>
        </Collapse>

        <div className="jf-plan" data-ready={s.plan || undefined}>
          <div className="jf-section">
            <span className="jf-section__title">Today’s plan</span>
            <span className="jf-meta">View all</span>
          </div>

          <div className="jf-swap">
            {/* The cards as they load: the same geometry, in bars */}
            <div className="jf-skeleton" aria-hidden>
              <div className="jf-card jf-meal">
                <span className="jf-meal__row">
                  <Bar w={72} h={20} r={10} tone={2} />
                  <Bar w={58} h={10} r={5} tone={2} />
                </span>
                <span className="jf-meal__body">
                  <span className="jf-skel-photo" />
                  <span className="jf-meal__text">
                    <Bar w={150} h={12} r={6} tone={3} />
                    <Bar w={190} h={20} r={10} tone={2} />
                  </span>
                </span>
              </div>
            </div>

            <div className="jf-card jf-meal jf-real" data-target="lunch">
              <span className="jf-meal__row">
                <span className="jf-meal__when">
                  <span className="jf-pill">Lunch</span>
                  <span className="jf-time">
                    <Icon name="clock" filled size={12} />
                    1:30 PM · {LUNCH.kcal} kcal
                  </span>
                </span>
                {/* The plan's Log button, in the card's top row as the coach's Meal Plan sets it */}
                <span className="jf-log" data-target="log" data-done={s.logged || undefined}>
                  <States
                    value={s.logged ? 'done' : 'log'}
                    states={{
                      log: <span className="jf-log__label">Log meal</span>,
                      done: (
                        <span className="jf-log__label">
                          <Icon name="check" filled size={14} />
                          Logged
                        </span>
                      ),
                    }}
                  />
                </span>
              </span>
              <span className="jf-meal__body">
                <img className="jf-meal__photo" src={paneer} alt="" width={72} height={72} />
                <span className="jf-meal__text">
                  <span className="jf-meal__name">Paneer tikka bowl</span>
                  <span className="jf-chips">
                    <span className="jf-chip">P {LUNCH.p} g</span>
                    <span className="jf-chip">C {LUNCH.c} g</span>
                    <span className="jf-chip">F {LUNCH.f} g</span>
                  </span>
                </span>
              </span>
            </div>
          </div>

          {/* The next meal, filler running off the crop */}
          <div className="jf-card jf-meal jf-next">
            <span className="jf-meal__row">
              <span className="jf-meal__when">
                <span className="jf-pill">Snack</span>
                <Bar w={52} h={8} r={4} tone={2} />
              </span>
              <Bar w={56} h={9} r={4} tone={3} />
            </span>
            <span className="jf-meal__body">
              <span className="jf-skel-photo" />
              <span className="jf-meal__text">
                <Bar w={140} h={11} r={5} tone={3} />
                <Bar w={96} h={9} r={4} tone={2} />
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Reminder(props: Record<`data-${string}`, unknown> & { className?: string }) {
  return (
    <Notification
      {...props}
      icon={<img className="jf-notif__icon" src={logo} alt="" />}
      title="Lunch at 1:30 PM"
      body="Paneer tikka bowl · 540 kcal. Tap to log it when you eat."
    />
  )
}

export default function JustFitHero() {
  return (
    <Stage<S>
      width={460}
      height={720}
      compact={{ below: 460, width: 358, height: 640 }}
      initial={START}
      poster={POSTER}
      script={script}
      cursor={{ at: REST, style: 'touch' }}
      className="jf"
    >
      {(s, rect, layout) => (
        <Phone
          width={layout === 'compact' ? 326 : 360}
          frame="pro"
          time="1:30"
          dark={!s.lit}
          wallpaper={WALL}
          className="jf-phone"
        >
          <LockScreen date="Monday, 2 November" time="1:30" stack="top" controls={false}>
            <div className="jf-notif" data-show={s.notif || undefined}>
              <Reminder data-target="notif" />
            </div>
          </LockScreen>

          {/* The app, launched out of the reminder. Hidden until the launch, so
              Expand's closed face never shows over the lock screen */}
          <div className="jf-app" data-app={s.app}>
            <Expand open={s.open} from={rect('notif')} radius={24} face={<Reminder />} className="jf-launch">
              <TheApp s={s} />
            </Expand>
          </div>

          {/* The cover sheet: the same lock screen, brought down over the app */}
          <div className="jf-cover" data-on={s.cover || undefined} aria-hidden>
            <LockScreen date="Monday, 2 November" time="1:30" stack="top" controls={false} />
          </div>
        </Phone>
      )}
    </Stage>
  )
}
