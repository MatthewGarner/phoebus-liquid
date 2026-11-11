# Liquid — design brief

## Pitch

"Cats are a liquid." Phoebus is a soft, wobbly jelly cat. You pour, stretch,
squish and tuck him into absurd containers. The score is how snugly he fills
each one.

## The fantasy

Every cat owner has watched their cat fold into a box far too small for it.
This game makes that a physical toy. Poking a wobbling cat should be fun before
there is any goal at all.

## Core loop

1. A container appears: teacup, salad bowl, delivery box, guitar case, a hood
   someone is wearing (it moves), a sink.
2. You drag Phoebus to stretch him like dough, pinch to squish, and let go:
   he flows and settles under soft-body physics.
3. A fit score (percentage of cat inside, with no spill) updates live. Helpers
   such as "tuck tail" and a limited number of squishes help finish the fit.
4. Settle to score. 100% is a perfect fit, with a smug, sleepy payoff.

## Around the loop

- **Container atlas:** 60+ containers to discover, grouped into bowls, boxes,
  bags, moving and ridiculous. Locked ones have hints. Your overall result is
  a stat: "Phoebus is 91% liquid".
- **Daily container:** the same container for everyone each day, showing how
  many cats have tried it.
- **Share card:** a polaroid-style picture of the fit with a stamp ("IF I FITS
  I SITS · 100%"), ranked against friends' cats in the same container. This is
  how the game spreads.

## What "fun" means here (the bar)

A first pass (Tetris-like cat pieces placed into 3D grids) was rejected as not
fun: it was static and fiddly. Here the soft-body feel is the whole game. It
must hold 60 fps on a phone, respond instantly to touch, and wobble, jiggle and
settle in a way that makes people laugh. Get one container feeling great
before building more. Haptics (where available) and squish sounds are part of
the feel.

## Session and structure

- Portrait phone, one hand, 30–90 seconds per container. No timers by default.
- Containers come in themed sets. Some add a twist: the container moves,
  clutter is already inside, or two cats share one container.

## Phoebus

The owner's real cat. His real colouring isn't known yet: the mocks show a
ginger tabby as a placeholder. Keep coat and markings in one place so they can
be swapped in when photos arrive. His face must stay readable however
stretched his body gets: the expressions are the jokes.

## Look

Bright, soft and tactile: pale sea-glass backgrounds, chunky toy-like
containers, a glossy jelly cat with simple bold features. The mocks in
`docs/mocks/` show the intended look and screen flow.

## Open questions

- How to do soft-body physics in three.js on mobile: a mass-spring lattice, a
  pressure model, metaballs, or position-based dynamics? Choose by feel and
  frame rate, and prototype more than one approach if needed.
- How the fit is measured (volume sampling? particles inside the container's
  bounds?) so that it feels fair.
- How friends' scores work without a heavy backend at first.
