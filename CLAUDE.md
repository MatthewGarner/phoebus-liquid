# Liquid: guidance for agents

Read `docs/brief.md` before working here. It holds the design, why the first
version was rejected, and the bar for "fun". `docs/mocks/` has the static UI
mocks (see its README); they show the intended look and screen flow, but they
are not specs.

## Constraints

- A three.js game that runs in a mobile browser. The main target is a phone in
  portrait, played one-handed with touch; desktop with a mouse should also work.
  It should hold 60 fps on a mid-range phone.
- Assets are made in code (procedural geometry, stylised materials, canvas
  textures) unless we decide otherwise. One consistent look matters more than
  detail.
- Phoebus's real colouring is not known yet. Keep his appearance in one place
  so it can be swapped.

## How to work

- Feel comes first. Get the core interaction feeling good in the smallest
  playable build before adding content, menus or progression.
- Check your work by running the game in a browser at phone size and actually
  playing it, then report what you saw (screenshots help). Say what could only
  be confirmed on a real phone.
- The owner reviews builds on their phone, so keep a way to serve the game to
  a phone on the local network.
