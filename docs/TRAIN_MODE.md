# Attune Train Mode

**Status:** Implemented  
**Last updated:** May 2026  
**Owner:** Product + Engineering

Train mode is Attune's **adaptive attention training** section — part of the **Screen → Train → Attune** product flow. It is inspired by published NeuroRacer / EndeavorRx research but is **not** an FDA-authorized digital therapeutic.

---

## What EndeavorRx is (reference)

**EndeavorRx** (Akili Interactive) is a prescription video game for children 8–17 with ADHD. It uses Akili's patented **Selective Stimulus Management Engine (SSME)** — a closed-loop system that:

- Presents **simultaneous motor challenges** (steer + tap) targeting attentional control
- Adapts difficulty in **real time and between sessions** to keep each child at optimal challenge
- Has **no "win" state** — sustained effort at the right difficulty is the treatment
- Prescribes ~**25 mission minutes/day**, 5 days/week, for 4 weeks

Attune **does not implement SSME**. We implement the **published NeuroRacer adaptive staircase** (Anguera et al., *Nature* 2013): independent difficulty tracks for navigation and target discrimination, targeting ~80% accuracy on each component.

---

## Attune Train positioning

| Claim | Allowed | Not allowed |
|-------|---------|-------------|
| Attention training exercises | Yes | |
| Training aid alongside homework | Yes | |
| Improves ADHD symptoms | | No |
| FDA / prescription / EndeavorRx equivalent | | No |
| Replaces clinical evaluation or medication | | No |

All Train UI includes: *"Training aid — not a diagnosis or replacement for clinical care."*

---

## Mechanics (macOS)

| EndeavorRx | Attune Train |
|------------|--------------|
| Tilt to steer | **A / D** or **← / →** |
| Tap right half of screen | **Space** or click targets |
| Multitask both | Steer + tap phases, then combined |
| SSME adaptive engine | NeuroRacer-style 80% staircase (`training/staircase.rs`) |
| Motor performance only | Motor performance + **webcam gaze engagement** |

### Mission structure

1. **Intro** — rule display (e.g., "Tap only blue circles")
2. **Steer-only** warm-up (~30 s)
3. **Tap-only** warm-up (~30 s)
4. **Multitask** — both tracks until mission time ends
5. **Summary** — accuracy, multitask cost, gaze engagement (no win screen)

Difficulty adjusts every ~75 s micro-run based on steer accuracy, tap accuracy, and multitask cost.

---

## Screen → Train handoff

If a prior screening exists, initial difficulty is seeded from:

- **Antisaccade error rate** — higher errors → easier starting difficulty
- **Naturalistic vigilance decay** — steeper decay → easier starting difficulty

See `training/mod.rs` → `get_training_difficulty_seed`.

---

## Data & privacy

- All Train data stored locally in SQLite (`training_sessions`, `training_runs`, `training_events`, `training_daily_compliance`)
- Webcam samples during Train logged to `training_gaze_samples` — never uploaded by default
- Daily mission-minute budget and lockout configurable in Parent Settings (default 25 min)

---

## References

- Anguera, J.A. et al. (2013). Video game training enhances cognitive control in older adults. *Nature*.
- [EndeavorRx IFU (2024)](https://www.endeavorrx.com/wp-content/uploads/2024/01/EndeavorRx-IFU5011-Commercial-RevU.pdf)
- [Neuroscape — NeuroRacer lineage](https://neuroscape.ucsf.edu/technology/interventions-and-diagnostics/)
