import { Stage, Phone, LockScreen, Thread, Bubble, Collapse, States, Stream, Bar, Icon, type Act } from '../../kit'
import { ChevronLeft, Sparkles } from 'lucide-react'
import priya from './assets/coach-priya-face.jpg'
import './coach.css'

// justFit's AI Coach, phone only. Story in five beats: a question is typed
// into the ask box (ask); it is sent and rises out of the field as the
// member's red bubble, and Priya starts typing (send); her answer streams in
// with the numbers in bold, worked out from today's plan and log (answer); a
// plan-change card drops in under it (change); Apply puts it in the meal plan
// (payoff). It loops the way the hero does: the phone locks, the chat is reset
// under the lock screen, and unlocking brings it back.
//
// The chat opens part-way through today's conversation, so the pane is full
// from the first frame: the earlier turns are placeholder lines, and the eye
// lands on the new exchange.
//
// The screen is the app's coach chat (app/(user)/coach/chat.tsx and
// components/coach/ChatProposals.tsx) rebuilt for the web: the same header,
// welcome line, bubbles, ask box and Apply card, in the app's tokens.
//
// Real strings: the header, the welcome, the question, the answer, the card.
// The numbers agree with the hero (52 of 120 g after lunch).

type S = { draft: string; sent: boolean; typing: boolean; reply: boolean; words: number; card: boolean; applied: boolean; locked: boolean }

const Q = 'How can I reach my protein goal today?'
const A =
  'You’ve had 52 of 120 g so far. Your evening chana adds 14 g, so you need 54 g more. Swap dinner to tandoori chicken (+36 g) and add a bowl of Greek curd at 5 PM (+18 g).'
const WORDS = A.split(' ')
// The figures the answer turns on, set in semibold as the app's boldPoints does
const BOLD = ['52 of 120 g', '54 g more.', 'tandoori chicken (+36 g)', 'bowl of Greek curd at 5 PM (+18 g).']
const BOLD_AT = new Set<number>()
for (const phrase of BOLD) {
  const p = phrase.split(' ')
  const at = WORDS.findIndex((_, i) => p.every((w, j) => WORDS[i + j] === w))
  p.forEach((_, j) => BOLD_AT.add(at + j))
}

const START: S = { draft: '', sent: false, typing: false, reply: false, words: 0, card: false, applied: false, locked: false }
const POSTER: S = { draft: '', sent: true, typing: false, reply: true, words: WORDS.length, card: true, applied: true, locked: false }

const script = async (a: Act<S>) => {
  await a.wait(900)
  a.mark('ask')
  await a.click('compose')
  await a.type('draft', Q, { interval: 45 })
  await a.wait(350)
  a.mark('send')
  await a.click('send')
  // Clear the field in the same update that adds the bubble: the words lift out of it
  a.put({ sent: true, draft: '' })
  await a.wait(700)
  a.put({ typing: true })
  await a.wait(1300)
  a.mark('answer')
  a.put({ typing: false, reply: true, words: 2 })
  await a.wait(300)
  for (let i = 3; i <= WORDS.length; i++) {
    a.put({ words: i })
    await a.wait(40)
  }
  await a.wait(500)
  a.mark('change')
  a.put({ card: true })
  await a.wait(1700)
  a.mark('apply')
  await a.click({ at: 'apply', x: 0.5, y: 0.5 })
  a.put({ applied: true })
  await a.wait(2800)
  a.mark('lock')
  // The phone locks: the lock screen comes down over the chat, the new turn is
  // cleared under it, and unlocking lifts the lock screen away again
  a.put({ locked: true })
  await a.wait(700)
  await a.snap({ sent: false, typing: false, reply: false, words: 0, card: false, applied: false })
  await a.wait(500)
  a.put({ locked: false })
  await a.wait(700)
}

// Earlier turns today, as placeholder lines: line widths per bubble
const HISTORY: { from: 'me' | 'them'; lines: number[] }[] = [
  { from: 'me', lines: [116] },
  { from: 'them', lines: [238, 250, 180] },
  { from: 'me', lines: [132] },
  { from: 'them', lines: [250, 236, 262, 140] },
  { from: 'me', lines: [104] },
  { from: 'them', lines: [244, 258, 120] },
]

export default function JustFitCoach() {
  return (
    <Stage<S>
      width={460}
      height={769}
      compact={{ below: 460, width: 358, height: 677 }}
      initial={START}
      poster={POSTER}
      script={script}
      cursor={{ at: { wide: { x: 320, y: 600 }, compact: { x: 250, y: 540 } }, style: 'touch' }}
      className="jc"
    >
      {(s, _rect, layout) => (
        <Phone width={layout === "compact" ? 326 : 360} frame="pro" time="1:42" dark={s.locked} className="jc-phone">
          <div className="jc-screen">
            <header className="jc-head">
              <span className="jc-back" aria-hidden>
                <ChevronLeft size={18} strokeWidth={2} absoluteStrokeWidth aria-hidden />
              </span>
              <img className="jc-face" src={priya} alt="" width={40} height={40} />
              <span className="jc-head__text">
                <span className="jc-name">Priya</span>
                <span className="jc-hint">AI Coach · fitness guidance, not medical advice</span>
              </span>
            </header>

            <Thread className="jc-thread">
              <Bubble from="them">Hi! I’m Priya. Ask me anything about your workouts, your food or your progress. I know your plan and what you’ve logged today.</Bubble>
              {HISTORY.map((b, i) => (
                <Bubble key={i} from={b.from}>
                  <span className="jc-lines" data-from={b.from}>
                    {b.lines.map((w, j) => (
                      <Bar key={j} w={w} h={8} r={4} tone={2} style={b.from === 'me' ? { background: 'rgba(255, 255, 255, 0.55)' } : undefined} />
                    ))}
                  </span>
                </Bubble>
              ))}
              {s.sent && (
                <Bubble from="me" source="draft">
                  {Q}
                </Bubble>
              )}
              {(s.typing || s.reply) && (
                <Bubble from="them" typing={s.typing}>
                  <Stream className="jc-answer" text={A} count={s.words} mark={(_, i) => BOLD_AT.has(i)} />
                </Bubble>
              )}
              <div className="jc-card-row">
                <Collapse open={s.card} reveal="drop">
                  <div className="jc-card-slot">
                    <section className="jc-card">
                      <span className="jc-slot">Dinner · 8:30 PM</span>
                      <span className="jc-was">Dal rice</span>
                      <span className="jc-dish">Tandoori chicken &amp; salad</span>
                      <span className="jc-hint">540 kcal · P 48 g (now 510 kcal · P 12 g)</span>
                      <span className="jc-action">
                        <States
                          value={s.applied ? 'done' : 'apply'}
                          align="start"
                          states={{
                            apply: (
                              <span className="jc-apply" data-target="apply">
                                Apply to my meal plan
                              </span>
                            ),
                            done: (
                              <span className="jc-done">
                                <span className="jc-done__label">
                                  <Icon name="check" filled size={16} />
                                  Updated in your meal plan
                                </span>
                                <span className="jc-undo">Undo</span>
                              </span>
                            ),
                          }}
                        />
                      </span>
                    </section>
                  </div>
                </Collapse>
              </div>
            </Thread>

            <div className="jc-compose">
              <span className="jc-ask" data-target="compose">
                {/* The app's own ask-box glyph (SF Symbols sparkles), not decoration */}
                <Sparkles size={18} strokeWidth={2} absoluteStrokeWidth className="jc-ask__icon" aria-hidden />
                <span className="jc-ask__field">
                  <span className="jc-ask__text" data-target="draft">
                    {s.draft}
                    {s.draft && <i className="jc-caret" data-snap />}
                  </span>
                  <span className="jc-ask__ph" data-hide={s.draft ? '' : undefined}>
                    Ask your coach...
                  </span>
                </span>
                <span className="jc-send" data-target="send" data-on={s.draft ? '' : undefined}>
                  <Icon name="send" filled size={18} />
                </span>
              </span>
            </div>
          </div>

          {/* The lock screen, brought down over the chat and lifted away again */}
          <div className="jc-cover" data-on={s.locked || undefined} aria-hidden>
            <LockScreen date="Monday, 2 November" time="1:42" stack="top" controls={false} />
          </div>
        </Phone>
      )}
    </Stage>
  )
}
