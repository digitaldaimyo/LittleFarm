# Sound and music plan

**Goal:** add sound where it makes Pen Deck more charming *or* easier to read, without breaking what the game promises: fully offline, no outside requests, cozy, and readable with the sound off.

Status: **phases A, B and C shipped.** Decisions (section 8) all went with the recommendations: synthesis for everything; background sounds in phase B and an opt-in generative music box in phase C; sound on by default for new and existing games; pet voices in phase C; training ticks opt-in.

### Phase C: what shipped, and what changed from the plan
- **Music box (opt-in, off by default):**
  - Seeded pentatonic bars (`musicBar`): fuller by day, sparser and lower at night, lighter in the teaching screens.
  - Two soft voices per note (triangle plus a quiet octave), scheduled ahead on the audio clock, with their own volume.
  - It dips under result jingles (certified, loophole, unlock, lesson done, request done).
  - It does not pause during replays as first planned: ducking under the replay's own sounds wasn't needed at these levels.
- **Pet voices:** each pet chirps at its own pitch (from its name and colours) when it picks something up or finishes a job, at most every few seconds. Adopting a pet chirps in the new pet's voice. Replays and demos stay voiceless.
- **Nap sigh:** the nap effect fires once when a nap starts, not every tick as phase B assumed, so it now gets a single soft sigh. Dusk keeps its own chime.
- **Probe plucks:** tapping a tile in "What does Pip do?" plays soft plucks rising along the path it would take (up to 12).
- **Training ticks (opt-in):** one soft tick at 25%, 50% and 75% of practice, at Watch and Normal speed only.
- **Measured:** 42 cues now; the browser test checks the chirp, and that the music box starts and stops. Unit tests cover voices, ticks and the music generator.

### Phase B: what shipped, and what changed from the plan
- **22 more cues (38 in all):**
  - farm: put down, deliver (replays), "hm?", well, watering, chicken shoo, crow scare, peck, egg laid, gate creak and latch, firefly, job done, crow arriving;
  - world: dawn and dusk chimes;
  - teaching: card removed or Undo, repair card;
  - progress: request done, Field Guide step, new lesson, lesson done.
- **Sound-only farm effects.** Chicken shoos, firefly catches, crow arrivals, dawn and dusk had no visual effect to hang a sound on. The farm now emits `type: 'sound'` effects for them, which the farm view ignores.
- **Replays** play the same cues as the farm, frame by frame, at replay speed. The replay samples shown *while training runs* stay silent, keeping "no sound per training try". Only replays you watch (the auto-replay after a lesson, the ▶ buttons, "▶ a miss", demos) make sound.
- **Ambience:** three seeded, synthesized 12 s loops: birdsong over a faint breeze, crickets at three paces, and rain with drops.
  - They crossfade (about 2 s) as night falls, dawn breaks or rain starts. Birds drop to 30% in the rain, and crickets to 50%.
  - Full volume on the Farm screen, 40% elsewhere. Settings gains a **Background** slider.
  - The first rain mix was about 5× louder than birdsong (RMS 0.049 vs 0.009), so the rain bed was halved (0.026).
- **Changes from the plan:**
  - Ambience plays on every screen, softer away from the farm, rather than only on the Farm screen. It's the farm's soundtrack, and an empty Teach screen felt oddly silent.
  - Naps stay silent (the nap effect repeats every tick); a single sigh is still in phase C.
  - Rain has no start cue: the rain bed fading in is the cue.
- **Measured:**
  - Rendering takes about 0.3–0.5 s for the cues and 0.3 s for the loops, asynchronously, against a plan target of 150 ms. It happens once, after the first click.
  - In about 1 of 4 runs the first click shows one ~70 ms long task, which never appears with audio disabled (creating an AudioContext costs up to ~30 ms in Chromium). Rendering was moved to its own task, and all noise voices now share one buffer.
  - Frame rate with sound on vs muted overlaps across runs (TESTING.md).

### Phase A: what shipped, and what changed from the plan
- **16 cues**, all synthesized: card flick / snap / reject, pen place, train start, certified, not certified, loophole, save, farm pickup / coin / splash / bump, adopt, unlock, shop. Rendered once (16 short buffers) on the first gesture with sound on.
- **Changes from the plan:**
  - No separate "training finished" chime: every finished lesson already ends in certified, not certified or loophole, so a fourth sound would only overlap them.
  - Locked cards are disabled buttons, so "doesn't fit" can't play on them. The reject tick plays when training is refused and when the shop can't sell something.
  - The flick plays when a slot opens; the snap when a card lands in it.
  - The farm's egg-laying "pickup" and the rain "splash" effects stay silent until phase B. They're listed in `SILENT_FX`, and a test fails if a new effect type is neither mapped nor listed.
- **Settings:** a Sound section with on/off, Master, "Farm and pen", "Cards and jingles", and "Farm sounds on other screens". There's a 🔈 button in the top bar and the M key. Ambience and music volumes are stored with defaults but not shown until those phases ship.
- **Saves:** `settings.audio` was added without a version bump. Older saves start with sound on.
- **Measured:** sound on vs muted made no measurable difference to frame rate or main-thread time (TESTING.md). The browser test checks that audio starts only after the first click, that all cues render, that the key cues play, and that M mutes.


---

## 1. Where we start from

- The game is silent. `Settings.sound: boolean` exists in the save (default `false`), but nothing reads it, and the Settings screen says "this version is silent".
- Almost everything worth hearing already flows through two streams:
  - **Sim events** (`sim/world.ts`): `move, bump, reach, enter, pickup, drop, deliver, fumble, stay, fill, water, shoo, scare, peck, enterArea, leaveArea, gate`. They drive rewards, replays and the journal.
  - **Farm effects** (`FarmFx` from `farmTick`): `coin, splash, pickup, drop, celebrate, confused, nap, bump`, with a `text` detail ("rain", "egg", "watered", "shoo!", "pecked", "gate open", "filled", "night"). The store already queues them for the farm view (`store.ui.fx`).
- UI moments without a stream yet: card placed or rejected in a slot, training start and end, certified or not, loophole found, unlocks, purchases, requests completed, Field Guide steps, adopting a pet.
- Constraints:
  - **Offline-only.** No streaming and no CDN. Anything we play must ship in the bundle or be synthesized.
  - **The art is procedural SVG.** Sound should match that hand-made, light style.
  - **The farm runs fast.** It ticks about 3.5 times a second at 1×, up to 4×, and *Fast* training runs thousands of episodes a second.
  - **Browsers start audio only after a user gesture.**

## 2. Principles

1. **Sound is redundant, never required.** Every cue doubles something already visible (accessibility, and play on mute). No information exists only as sound.
2. **Clarity first, charm second.** A cue earns its place by making something easier to notice: a splash, a bump, a loophole, a certification. Pure decoration (ambience, music) is quieter and easy to turn off on its own.
3. **Sparse, not busy.** No sound per step or per training episode. Rate limits keep 4× speed from turning into a buzz (section 5).
4. **Cozy.** Soft attacks and warm timbres. No harsh failure sounds: a miss sounds curious, not punished, which matches "pets are never punished".
5. **One sound, one meaning.** The same moment sounds the same in the pen, in replays and on the farm, so players learn the vocabulary. A splash in a replay *is* a splash.
6. **Honest.** Replays of your pet use the same sounds as the farm. A scripted demo gets no pet voice, just as it is labelled "not your pet".

## 3. Where sounds fit

Priority: **A** = phase A (clarity or core feedback), **B** = phase B (fuller world), **C** = later or optional. Purpose: **clarity**, **charm** or **both**.

### Teaching (cards, pen, training, reports)
| Moment | Cue | Purpose | Pri |
|---|---|---|---|
| Pick a card from the hand | soft paper flick | charm | A |
| Card snaps into a slot | paper "snap" | both: confirms the fit | A |
| Card doesn't fit / locked | dull wooden tick (no buzzer) | clarity | A |
| Remove a card, Undo | soft reverse flick | charm | B |
| Place or remove a thing in the pen | small pop / reverse pop | charm | A |
| Train pressed | short rising whistle | both | A |
| Training progress | very soft tick at each 25% (*Watch* and *Normal* only) | clarity (optional) | C |
| Training finished | warm two-note chime | clarity | A |
| **Certified** | small three-note fanfare | both | A |
| Not certified | gentle falling two notes (not sad) | clarity | A |
| **Loophole found!** | curious "boing-wobble" | clarity: the game's signature surprise | A |
| Repair card applied | wrench "clink" + snap | charm | B |
| Save skill | page stamp | charm | A |
| Replays (▶, "▶ a miss") | the same sim-event sounds as the farm, at replay speed: bump, splash, pickup, deliver | **clarity**: you *hear* where it bumped | B |
| Probe: tap a tile | soft plucks rising along the traced path | charm | C |

### The farm (pets, crops, creatures)
| Moment (event / fx) | Cue | Purpose | Pri |
|---|---|---|---|
| `pickup` (berry, carrot, egg) | light pop, pitch by item | both | A |
| `drop` | soft thud | clarity | B |
| `deliver` + `coin` | coin chime, a little brighter for 2–3 coins; deliveries close together merge into one | both | A |
| `enter` pond / splash fx | **splash** | **clarity**: the reason to learn Avoid | A |
| `bump` | soft "bonk" | clarity (Steer, replays) | A |
| `fumble` / confused fx | tiny "hm?" | clarity | B |
| `fill` at the well | bucket glug | charm | B |
| `water` a plot | sprinkle | both | B |
| `shoo` a chicken | whoosh + cluck | both | B |
| `scare` a crow | flutter + caw | both | B |
| `peck` | a single caw (calm, not an alarm) | **clarity**: crops are being taken | B |
| Egg laid in the coop | soft cluck-pop | charm | B |
| `gate` open / shut | wooden creak / latch | clarity | B |
| Firefly caught | twinkle | charm | B |
| Celebrate fx (job done) | tiny jingle (rate-limited) | charm | B |
| Nap starts | soft sigh (no snoring loop) | charm | C |

### The world (time, weather)
| Moment | Cue | Purpose | Pri |
|---|---|---|---|
| Dawn | gentle rooster-ish chirp or a morning chime | clarity: a new day, new requests | B |
| Dusk | low evening chime | clarity: night rules start | B |
| Day ambience | sparse birdsong bed | charm | B |
| Night ambience | crickets bed | both: night is audible | B |
| Rain | soft rain bed fading in and out with `rainUntil` | both | B |
| Crow arrives | distant caw | clarity | B |

### Progression, pets, interface
| Moment | Cue | Purpose | Pri |
|---|---|---|---|
| Adopt a pet | happy chirp in the pet's own voice | charm | A |
| Coins spent in the shop | cash-box "cha-ching" | both | A |
| Unlock | sparkly jingle | both | A |
| Request done | small bell | clarity | B |
| New Field Guide lesson / lesson done | page turn / soft chime | clarity | B |
| Field Guide step advanced | very soft tick | clarity | B |
| Warning toast | none (the text does the work) | — | — |
| Pet "voice" | a short chirp on pickup, celebrate and adopt, pitched per pet (from palette + name) so two pets sound different | charm | C |

### Deliberately silent
Per-step movement and footsteps (too frequent at 4×), every training episode, hover and focus, journal entries, ordinary toasts, the probe arrows themselves, and anything while *Fast* training runs except start and finish.

## 4. How we make the sounds

| Option | Pros | Cons |
|---|---|---|
| **Procedural synthesis** (Web Audio: oscillators, filtered noise, envelopes) | Nothing to download or license; tiny (a few KB of code); matches the procedural art; pitch and variation are free; easy to keep cohesive | Natural sounds (rain, birds, chickens) need care to sound good rather than "beepy" |
| Bundled CC0 samples | Realistic animals and weather | Bundle grows (~0.5–2 MB); license tracking; harder to keep one style; more files for the service worker |
| Commissioned or recorded samples | Most character | Cost and time; same bundle and size issues |

**Recommendation: procedural synthesis for everything.** Pre-render each cue once into an `AudioBuffer` (via `OfflineAudioContext`) when sound is first enabled, so playing one costs a buffer-source node. Cues are addressed by **id** (`'card.snap'`, `'farm.splash'`…). That leaves a clean seam: if a synthesized animal sound ever disappoints, one bundled sample can replace that id without touching game code.

The sound kit is about 30 short cues (most 50–400 ms) plus 3 ambience loops (day, night, rain). Each cue is a small recipe: waveform(s), pitch envelope, amplitude envelope, optional noise and filter, and ±3% random pitch so repeats don't sound mechanical.

## 5. Architecture

```
game/sound.ts     pure: (FarmFx | SimEvent | UiCue) → CueRequest {id, pitch?, pan?, priority}
                  + a deterministic limiter (per-cue cooldown, max voices, merge rules)
audio/kit.ts      cue recipes (synthesis parameters), no browser globals
audio/engine.ts   AudioContext, buses, pre-rendering, ambience, music, unlock-on-gesture
ui/…              calls engine.play('card.snap') at UI moments; the store forwards fx
```

- **The game stays sound-free.** Game rules still never import React or audio. Mapping events to cues is a pure function, so it can be unit-tested like the rest (`tests/sound.test.ts`).
- **Buses:** `master → { effects, interface, ambience, music }`, each with its own gain. A gentle compressor on master evens out piled-up cues.
- **Where cues come from:**
  - farm `fx` (already queued each tick in `store.ts`);
  - replay frames (`ui/replay.ts` steps the sim, so we reuse its events);
  - explicit UI calls (card snap, train, certify, unlock, shop, adopt);
  - clock and weather transitions (dawn, dusk, rain), noticed by comparing `dayInfo` and `rainUntil` between ticks.
- **Limits:**
  - each cue has a cooldown (e.g. pickup 120 ms, coin 150 ms with merging, bump 250 ms);
  - at most 8 voices, and the lowest priority drops first;
  - at 2× and 4× farm speed, priority C cues are skipped and B cues get longer cooldowns;
  - while *Fast* training runs, only the start and finish cues play.
- **Placement:** farm cues are panned slightly by the tile's x (±0.4), which helps on big farms. Farm sounds play only on the Farm screen, unless the "Farm sounds on other screens" setting is on, in which case they play quieter.
- **Lifecycle:**
  - The `AudioContext` is created on the first user gesture (Adopt, or any click), so the browser never blocks it.
  - It suspends when the tab is hidden (`visibilitychange`), which saves battery.
  - Nothing is fetched, so offline play and the "no outside requests" e2e check are unaffected.
- **Performance budget:** under 1% main-thread time at 4× farm speed (we re-run the Milestone 5 perf script with sound on). Pre-rendering every cue at first enable must take under 150 ms.

## 6. Music

| Option | Feel | Cost | Fits offline / procedural? |
|---|---|---|---|
| None, ambience only (birds, crickets, rain) | Calm, natural; the farm *is* the soundtrack | Small | Yes |
| **Generative "music box"**: slow pentatonic phrases from a few soft instruments, seeded and varied by time of day (warmer by day, sparser by night, a lighter "focus" mood in the pen) | Cozy, never repeats, never too long | Medium (one module) | Yes, a natural match for procedural art |
| Composed tracks (files) | Most memorable | Composer, 3–10 MB, loops get repetitive | Bundle size and licensing |

**Recommendation:** ship **ambience in phase B**. Ship a **generative music box in phase C**, **off by default** with its own volume slider. Ambience already gives a sense of place, and it changes with day, night and rain, so it reinforces the clock. Generative music suits the game's style and costs no downloads. It stays opt-in because players differ a lot on in-game music, and some will be listening to their own. Music dips (ducks) under the certified and unlock jingles and pauses while a replay is playing.

## 7. Settings

The Settings screen gets a **Sound** section:

| Setting | Control | Default |
|---|---|---|
| Sound | on / off (the existing `settings.sound`) | **on** for new games (see decision 3) |
| Master volume | slider | 70% |
| Effects (farm and pen) | slider | 80% |
| Interface (cards, buttons, jingles) | slider | 70% |
| Ambience (birds, crickets, rain) | slider | 50% |
| Music | slider + on/off | off, 40% |
| Farm sounds on other screens | checkbox | off |
| Training ticks while practising | checkbox | off |

Also:
- A **mute button** (🔈/🔇) in the header next to the coins, and the **M** key, so muting is one tap from anywhere.
- With sound on, a one-time toast at the first sound: "Sound is on. Mute with 🔈 or M; more in Settings."
- *Reduce motion* doesn't change sound, but the ambience loops have their own slider for anyone who finds them distracting.
- **Saves:** add `settings.audio = { master, effects, ui, ambience, music, musicOn, offScreen, trainTicks }`. It's additive, so there's no save version bump. `parseGame` fills missing nested fields from defaults and clamps volumes to 0–1. Note that it fills only *top-level* sections today, so this needs a small addition. Sound settings travel with exported saves like the other settings.

## 8. Decisions needed

1. **Sound source:** procedural synthesis for everything (recommended), or bundled CC0 samples for animals and weather?
2. **Music:** ambience only; ambience now plus a generative music box later, off by default (recommended); generative on by default; or composed tracks?
3. **Default on or off:** existing saves store `sound: false` only because it was never exposed. Should sound default to **on** for new *and* existing games, with the visible mute button and the one-time toast (recommended), or stay off until the player turns it on?
4. **Pet voices:** give each pet a short pitched chirp (recommended, phase C), or keep pets wordless?
5. **Training progress ticks:** offer them as an opt-in (recommended), or leave them out entirely?

## 9. Phasing

| Phase | Scope | Size |
|---|---|---|
| **A: engine and core cues** | `game/sound.ts` mapping and limiter, `audio/` engine and kit, the Settings section, header mute and M, unlock on first gesture and suspend when hidden. The cues marked **A**: card snap/flick/reject, pen place, train start and finish, certified / not certified, loophole, save, pickup, coin/deliver, splash, bump, adopt, unlock, shop | M |
| **B: a farm you can hear** | The remaining **B** cues: creatures, well, water, gate, firefly, egg, celebrate, requests, Field Guide. Sound in replays. Ambience beds for day, night and rain; dawn and dusk cues | M |
| **C: music and personality** | The generative music box (opt-in), pet voices, probe plucks, training ticks (opt-in), nap sigh. Mixing polish | M |

Each phase ships on its own. With sound off, the game behaves exactly as it does today.

## 10. Testing

- **Unit (vitest):**
  - the event → cue mapping covers every sim event and fx type, or lists it as silent on purpose;
  - the limiter is deterministic with a fake clock: cooldowns, merging coins, the voice cap, dropping priority C cues at 4×;
  - settings defaults, clamping and the save round-trip.
- **Browser (e2e):** run the existing Field Guide test with sound **on**. It checks no page errors, no outside requests, and that the AudioContext is created only after the first click. A small check counts cues triggered by key moments (splash, certify, loophole) through a debug hook rather than listening to audio.
- **Performance:** re-run the Milestone 5 phone-emulation measurement at 4× with sound and ambience on (target: still 60 fps, under 1% added main-thread time).
- **Listening pass (manual):** 10 minutes on the farm at 1× and at 4×, one full lesson, and a replay. Note anything grating, too loud or too frequent, and adjust cooldowns and levels. A listening pass is the only real test of "cozy".
- **Docs:** README (remove "No sound" from the limitations, add the settings and the M key), GAME_DESIGN (sound principles), ARCHITECTURE (the `audio/` layer), TESTING (the new checks).
