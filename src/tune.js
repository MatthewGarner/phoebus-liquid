// Every tunable lives here. One mutable object; also exposed as window.TUNE so it can be changed
// live from the console (the cat reads values every step; `iterations` and the like apply at once).
export const TUNE = {
  // ---- integration ----
  gravity: -30,
  airDamp: 0.998,        // velocity kept per 1/60 s step in a leap (nearly a parabola; the aim preview uses it)
  damp: 0.985,           // velocity kept per 1/60 s step (tone adds more, on his velocity relative to his own centre of mass)
  iterations: 8,         // solver iterations per step
  maxStep: 0.68,         // max travel of any node per step (world units): stops tunnelling at 60 Hz
  maxFrameSteps: 3,      // game: at most this many steps per rendered frame (a 30 Hz frame needs 2; more than this = slow motion rather than a spiral)

  // ---- spine (compliant: he stretches and squashes) ----
  spineStretchK: 0.035,   // per-iteration pull of each spine segment toward its rest length
  spineMin: 0.7,        // hard limits as a multiple of the rest spacing
  spineMax: 2.3,
  bendK: 0.015,          // i <-> i+2 straightening (floppy, not a noodle)
  archK: 0.004,          // i <-> i+3: very gentle natural arch
  archRest: 0.94,        // rest length of that pair as a fraction of 3 spacings
  areaMin: 0.62,         // area conservation: radius multiplier limits
  areaMax: 1.32,
  areaRate: 14,          // 1/s: how fast the radius follows the target
  selfRadius: 0.88,      // spine nodes >= 4 apart keep this x (ri + rj) between them
  selfRadius3: 0.7,      // ... and nodes exactly 3 apart this (a straight spine is 3 x 0.4 = 1.2 between them, so it must be < 1.2 / (ri + rj))
  tailBendK: 0.05,
  legOffset: 0.85,        // leg roots sit this fraction of the node radius toward the belly
  legK: 1,               // leg and tail segments: stiff

  // ---- contacts ----
  wallFriction: 0.25,    // fraction of sliding removed per step while touching (floor, walls, container)
  wallSlop: 0.002,
  impactMin: 2,          // normal speed (u/s) below which a contact does not count as an impact

  // ---- grabbing ----
  grabRadius: 1.3,
  handleBonus: 0.35,     // handles (head, hips, paws, tail tip, mid) win ties by this much
  grabK: 0.55,           // fraction of the way to the finger, per iteration
  heldInvMass: 0.2,      // a held node is this light to the constraints: the rest of him follows it
  grabMaxStep: 0.6,      // max travel of a held node per step
  fingerSmooth: 40,      // finger smoothing (1/s)
  grabOffsetDecay: 9,    // 1/s: the offset between finger and node fades so he does not pop
  tapMs: 180,
  tapMove: 0.4,
  pokeRadius: 1.5,
  pokeImpulse: 14,       // u/s at the finger, falling off linearly

  // ---- cat behaviour ----
  breath: 0.02,          // belly radius swing
  breathHz: 0.4,
  tailSwish: 10,         // lateral accel on the tail tip (u/s^2)
  tailSwishHz: 0.9,
  wriggle: 50,           // lateral accel along the spine during a wriggle (u/s^2)
  wriggleEvery: [3, 6],  // seconds between wriggles
  wriggleTime: 0.9,
  wriggleHz: 1.6,
  annoyStretch: 1.6,     // stretch beyond this annoys him
  annoySquash: 0.7,      // squash below this annoys him
  annoyShake: 500,       // held-node acceleration (u/s^2) that counts as shaking
  annoyUp: 1.5,
  annoyDecay: 0.5,       // per second (about 2 s to calm down)
  curlPull: 0.03,        // relaxed: tail curls in

  // ---- muscle tone and poses (cat.js, poses.js) ----
  // tone 0..1 is how hard he pulls himself toward his current pose (a shape match around his own centre of mass)
  poseK: 0.17,           // per-iteration fraction of the way to the pose at tone 1 (applied on 4 of the 8 iterations)
  toneHeld: 0.05,        // held: limp, he hangs long
  toneAir: 0.5,
  toneGround: 0.85,      // on the table or on a rim, mostly outside the container
  toneContained: 0.12,   // in a container: he holds himself together but conforms
  poseCapContained: 0.2, // while contained no part is pulled harder than for this distance from its goal
  containedFit: 0.6,     // fit (0..1) at which he counts as contained (and 0.1 less to stop counting)
  toneRampHeld: 0.25,    // seconds for the tone to fall when he is picked up
  toneRampGround: 0.3,   // seconds for the tone to rise when he lands
  toneDamp: 0.7,         // at tone 1 this fraction of his velocity relative to his own centre of mass is removed each 1/60 s
  poseBlend: 0.35,       // seconds to blend between poses
  poseBlendIdle: 0.7,    // ... when he changes pose on his own while sitting on the table
  rightingRate: 10,      // rad/s the target angle is steered to upright while he is in the air (cats land on their feet)
  rightingGround: 3,     // ... and on the ground
  rightingLead: 1.3,     // rad: how far ahead of his body the target angle may run
  airDelay: 0.07,        // seconds without support before he counts as in the air
  airDelayGround: 0.2,   // ... and when he was on the ground a moment ago (perched on a rim, support flickers: he stays 'on the ground')
  groundLiftDamp: 0.7,   // on the ground, this fraction of any upward motion of his whole body is removed each step (poses never launch him)
  crouchSpeed: 7,        // landing speed (u/s) that makes him crouch
  crouchTime: 0.1,       // seconds he holds the landing crouch
  crouchIn: 0.07,        // seconds to go into it
  crouchOut: 0.25,       // seconds to come back out of it
  crouchDepth: 0.28,     // the pose is squashed this much vertically at the bottom of the crouch
  crouchWiden: 0.1,      // ... and widened this much
  containedScale: [0.55, 1.1], // while contained the pose template may shrink/grow (similarity fit) so it never pushes at the walls
  heldScale: [0.5, 2.2],  // ... and while held, so a stretched cat is not pulled shorter
  innessFrom: 0.15,      // fit at which he starts to count as 'in' a container (tone falls toward toneContained, righting fades, loaf)
  innessTo: 0.5,
  // idle life on the ground
  idleEvery: [4, 9],     // seconds between little things
  stretchTime: 2.2,
  yawnTime: 1.6,
  lookTime: 1.8,
  flickTime: 0.7,
  tailFlick: 70,         // lateral accel on the tail tip during a flick
  introLook: 0.9,        // seconds he looks at the container, then at the player, after landing at the start of an attempt
  introPlayer: 0.9,
  rimSitOffset: 0.6,     // no room beside the container: he drops onto its rim, hips this far outside the rim's inner edge
  rimSitHeight: 1.0,     // ... and the lowest part of him starts this far above the rim
  dropHeight: 1.5,       // start of an attempt: the lowest part of him starts this far above the table

  // ---- pounce (aim and release) ----
  allowDrag: false,      // hand-dragging the cat (the old verb) stays available behind this flag and the debug hooks
  pullMax: 3.6,          // the pull is measured in SCREEN pixels (main.js); the sim sees it normalised: this many 'pull units' = full power
  pullMaxFrac: 0.24,     // full power at this fraction of min(screen height, 900) px of pull (TUNE.pullMaxPx, set by main.js from the screen)
  pullMaxPx: 170,
  pullDeadPx: 14,        // a shorter pull (px) is a tap: it cancels the aim
  leapSpeedMax: 31.5,      // u/s at full pull (gravity 30: a vertical shot rises ~15 from sitting; a 45 degree shot carries across the room and bounces off the far wall)
  pullMin: 0.35,         // (sim tests) a shorter pull in pull units is a tap
  leapFront: 1.04,       // front nodes launch this much faster ... (so he stretches out)
  leapHind: 0.96,        // ... and hind nodes this much slower
  leapAirTime: 0.22,     // seconds after launch in which he is 'air' whatever his contacts say
  leapBounce: 0.35,      // side walls: restitution (normal speeds above wallBounceMin)
  wallBounceMin: 4,
  aimPreview: 0.75,      // seconds of the dotted arc
  aimDots: 14,
  aimStretch: 0.12,      // wind-up: the crouch is this much longer at full pull (about its middle)
  aimTilt: 0.35,         // head lifts this fraction of the launch elevation angle (rad)
  aimWiggle: 700,        // bum wiggle: lateral accel (u/s^2) at full pull
  aimWiggleHz: 9,
  aimBlend: 0.2,         // seconds to go into the crouch
  turnTime: 0.12,         // seconds for the 'turn' (a kinematic card-flip about his own centre) when the launch is the other way
  turnHyst: 0.4,         // pull (world units, horizontal) needed to turn him round
  dragFeedback: [0.33, 0.66, 1.0],
  leapTone: 0.5,
  leapSteer: 5,          // rad/s: how fast the goal angle turns to his heading in flight
  leapLead: 0.4,         // rad: how far ahead of his body it may run (small = a gentle swing, not a spin)
  leapAlignDown: [2, 12], // descent speed range (u/s) over which the nose-first heading gives way to feet-first (unless he is on course for the opening)
  diveAim: 1.05,         // he stays nose-first while the arc passes within this x rim half-width of the opening
  diveAssist: 40,        // lateral accel (u/s^2 per unit of offset) steering his head onto the opening during a nose-first dive
  diveReach: 1.4,        // ... when the head is within this far (beyond the rim half-width) of the opening's axis
  pourTime: 0.6,         // seconds of near-zero tone as he goes in through the opening
  pourTone: 0.02,
  pourFunnel: 90,        // lateral accel (u/s^2) of parts above the rim toward the opening axis during the pour
  pourReach: 1.6,        // ... but only those within this far (beyond the rim half-width) of the opening
  pourSuck: 25,          // extra downward accel of parts above the rim during the pour
  pourMax: 3,            // pours per leap (he cannot keep re-entering)
  pourCool: 0.5,         // seconds after a pour before another can start
  pourSpeed: 1.5,        // downward head/chest speed (u/s) needed
  tuckFit: 0.6,          // contained with at least this fit: auto-tuck
  tuckK: 0.16,           // per odd iteration pull of a loose part toward the inside
  tuckRamp: 0.25,
  tuckCentre: 0.02,      // per odd iteration pull of his body toward the middle of the container while a part is still out
  completeHold: 1.0,     // (old) seconds contained, settled, not aiming
  completeFit: 0.6,      // head and chest in the container (pour or contained) with at least this fit: the level is won
  completeKE: 0.6,       // mean spine kinetic energy below which he counts as settled for completion
  stuckAfter: 0.6,       // half in a container and still for this long: he wriggles
  stuckWriggle: [1.2, 2.4],
  squirm: 1.4,           // tap: wriggle strength
  starFit: 0.95,
  poseCapAll: 0.35,      // no pose pull moves a node more than this per iteration (in any mode)
  poseCapLaunch: 0.12,   // ... and in the first 0.2 s of a leap
  propGravity: -30,
  propSleepSpeed: 0.25,
  propFade: 1.0,         // seconds a knocked prop wobbles and fades
  glance: 0.9,           // seconds of smug after he knocks something off

  // ---- fit rule ----
  fitHeadroom: 0.5,      // a node above the rim is still IN within the opening and this far above the rim

  // ---- level ----
  roomHalfW: 9,          // the room is x in [-roomHalfW, roomHalfW]; the camera shows exactly that across the screen
  roomTop: 32,           // the soft ceiling of every room
  ceilingMargin: 0.4,    // (old) soft ceiling sits this far below the top of the visible view
  dropAbove: 1.6,        // start of an attempt: spine this far above the rim top
  dropOffset: 0.35,

  // ---- game ----
  perfectHold: 1.0,      // seconds of "all in, not held" for a perfect
  settleKE: 0.05,        // mean spine kinetic energy below which he counts as settled
  settleTime: 0.5,
  yowlStretch: 1.9,
  yowlAnnoy: 0.8,
  grumpyAnnoy: 0.4,
  dangleStretch: 1.25,
  squishedSquash: 0.65,
  squishedImpact: 60,    // per-frame impact sum that triggers the squished face
  impactSound: 14,       // per-frame impact sum that plays a squish
  impactHaptic: 40,
  sleepyAfter: 6,        // seconds settled before the sleepy face

  // ---- render ----
  tiltDeg: 10,
  tableScreenPx: 62,     // floor line height above the bottom of the screen (phone), plus the safe area
  frameAspect: 0.56,     // widest portrait frame (width / height): wider screens are letterboxed to it
  cupFrontOpacity: 0.16,

  // ---- audio ----
  volume: 0.9,
  yowlCooldown: 2.5,
};

// ---- anchored ground life, planted aiming ----
Object.assign(TUNE, {
  anchorSpeed: 3.5,      // he is posed on his spot (kinematic) once his centre moves slower than this after landing
  kickTime: 0.6, kickHz: 7, kickWindow: 1.6,   // back-leg kickies: how long he kicks, how fast, and how long you have to aim again
  kickSlow: 0.35,
  lickTime: 1.4, lickQuiet: 5,   // Lickies: how long, and how many quiet seconds before he does it unprompted
  // ---- the FEEL layer (presentation only: springs, squash, hit-stop, camera and world reactions; never feeds back into the sim) ----
  impact: {
    springHz: 4.0, springZeta: 0.26,     // the landing squash spring: about 1.5-2 visible oscillations, settled in ~0.45 s
    maxSquash: 0.36, hindDelay: 0.05,    // height lost at s = 1; the hips arrive this long after the front paws
    rippleAmp: 0.12, rippleSpeed: 25, rippleHz: 4, rippleTau: 0.4,
    bonkSquash: 0.6, splatSquash: 0.75, splatHold: 0.16,
    skidMax: 0.9, launchStretch: 0.25, flightStretch: 0.14,
    stopMed: 2, stopHeavy: 4, stopMax: 6, stopCool: 0.25,     // hit-stop in frames (s >= 0.35 / 0.6 / wall bonk at full speed), at most once per stopCool seconds
    camMaxPx: 10, camZoom: 0.03, camHz: 7, camZeta: 0.35,
    shelfDip: 0.35, containerRock: 0.06,
  },
  rescueAfter: 1.6,      // half in a container and at rest this long: he hops out on the side his head is on
  // ---- the anatomical skeleton (presentation only; src/skeleton.js holds the proportion table) ----
  anim: {
    reachTime: 0.20,        // the descent reach before touch-down (front paws out toward the landing, hind feet swinging forward)
    takeoffTime: 0.15,      // toe-off: chest rises to the launch line, front feet leave first, then the hind legs extend hip, knee, hock
    sitTime: 0.5,           // stand <-> sit: hindquarters lower first, front legs straighten; reversed to stand up
    turnTime: 0.3,          // the step-round turn (the spine bends head first, the feet step over)
    stepCycle: 1.25, stepDuty: 0.65,   // the walk: lateral sequence (LH, LF, RH, RF), one cycle in this many seconds, each foot on the ground this fraction of it
    stepTime: 0.22,         // one foot's swing when he re-places it (stand/sit changes, the settle after a landing)
    landMin: 0.25, landMax: 0.45,      // the landing clip (touch-down to settled, by impact strength)
  },

  impactEventMin: 3.5,   // slowest contact (along the normal) that raises an impact event
  impactGap: 0.14,       // one landing = one primary event: later contacts within this are suppressed unless stronger / a different part (secondary)
  freezeAfter: 0.25,     // a perch (rim, box, cushion end...) freezes him this long after the contact energy has dropped
  anchorBlend: 0.2,      // seconds to blend from the landed body to the pose
  anchorGround: 0.08,    // seconds on the ground before that
  scootMax: 0.6,         // a landing with his support beyond the edge: a one-off scoot at most this far, else he falls
  edgeMargin: 0.3,       // the centre of his support must be this far inside the edge of a shelf
  plantBlend: 0.12,      // seconds for planted paws to lock
  aimWiggleAmp: 0.16,    // bum wiggle (world units, pure animation about the anchor) at full pull
  aimLeanMax: 0.6,       // ... up to this many radians: any more and the planted front paws could not reach (they never leave the floor while he aims)
  aimLean: 0.9,          // the body leans toward the launch: this fraction of the elevation (rad), about the hips
  tailSwishAmp: 0.16,    // kinematic tail swish while posed
  launchHop: 0.3,        // at release the whole of him lifts this much (clear of the floor)
  previewSmooth: 30,     // 1/s smoothing of the arc origin
  // ---- drop (the skill move) ----
  dropKick: 14,          // extra downward speed
  dropDamp: 0.1,         // horizontal speed kept
  dropDampTime: 0.08,
  dropStretch: 1.25,
  dropSteer: 24,         // rad/s: he snaps vertical
  splatDepth: 0.45,      // landing a drop on something hard: squash this much
  splatHold: 0.15,
  splatRecover: 0.12,
  // ---- cushion, cucumber, robo-vac ----
  cushionH: 0.9,
  cushionRest: 0.64,     // restitution along the surface normal
  cushionMin: 13,
  cushionBounces: 3,     // at most this many boings in a row (a leap or a startle resets it), then he just sits on it        // slower than this he just sits on it
  cushionCap: 34,        // incoming normal speed cap
  cucumberRange: 1.0,    // head within this far of a cucumber: startled
  startleHeight: 1.15,   // x the max leap height
  startleDrift: 2.0,     // u/s sideways, away from the cucumber (a startled cat does not go perfectly straight up)
  roboSpeed: 2.2,
  // ---- treats ----
  treatR: 0.55,
  // ---- win and presentation ----
  winSlow: 0.35,         // time scale during the beat
  winSlowTime: 0.35,     // real seconds of slow motion
  winZoom: 1.3,
  menacePerTreat: 0.09,  // the menace meter: a NEW treat (a better star count on a level)
  menacePerProp: 0.06,   // ... and a prop knocked (a better count); full about every 3-4 levels, and always after the last
  bannerDelay: 0.45,     // real seconds from the win to the banner
  fitRamp: 140,          // displayed fit (percent per second) after the win
});
if (typeof window !== 'undefined') { window.TUNE = TUNE; }
