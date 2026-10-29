# Mobile Vey touch reactions and app-state moods

Status: Proposed (frozen work order; renumber at ship)

Vey reacts to taps, holds and horizontal eye drags on welcome (first and last cards), vibe, rate, empty states, first-load loaders and job waiting/failure screens. Existing decorative uses remain decorative, including the celebration overlay, VeyRunner and MascotWordmark.

A tap gives a hop and head tilt. A hold of at least 400 ms gives a one-shot right-arm wave. Five taps within three seconds earn one body/head spin. Only one extra reaction can wait behind an active reaction; a pending spin takes priority. Reactions return to the supplied mood. Changing that mood cancels the reaction and queue and resets all animation values. The working mood alternates small arm movements and pulses the core faster, with no hops. The wave mood runs once and then idles.

Waiting jobs (including a polling timeout that says still working) and first-load loaders use working. A failed job uses worried; a refunded user cancellation uses idle. A result replaces Vey. Empty states wave on appearance. The low-balance note has a small, decorative worried Vey beside its text, with text and Buy credits first in reading order. Existing status text, live regions, cancellation controls and completion celebrations remain unchanged.

As required by [ADR-0265](0265-mobile-vey-not-a-chat-bot.md), Vey is not a chat bot. No touch opens chat or navigation, asks a question, displays speech, or adds a floating mascot to tabs. Touch haptics use only the existing tolerant `playSelection` helper in `lib/haptics.ts`.

The outer View owns the eye-drag PanResponder; the inner Pressable owns taps and holds. A drag is claimed only when abs(dx) > 8 and abs(dx) > abs(dy), never on touch start. Taking the responder cancels the inner press. Vertical gestures remain available to the parent scroll view, and termination requests are always granted. Eyes stay within a radius of 6 times the art scale and spring back on release or termination. For small art, Pressable hitSlop expands the touch target to 44 by 44 points; the outer View reserves that minimum layout size so the hit area remains inside its parent bounds.

The button has the translated Vey label, hello hint and Wave custom action. Art stays hidden from assistive technology. Welcome, vibe and rate do not hide the button's ancestors. The loader exposes its unchanged loading label as a progressbar before a separate Vey button. Touch does not announce additional text or create live regions.

Reduce Motion defaults to on until the system preference is known. It prevents all mood and reaction animation, including eye dragging and spring returns; haptics and accessible actions remain available. Working rests its arms with a full core; wave uses the existing raised-arm cheer pose. Motion uses React Native Animated with native-driver transforms and opacity, without JS animation loops or new dependencies.

Personalised Vey, tilt sensors, pull-to-refresh Vey and sound are deferred: they expand state, device permissions or gesture ownership beyond these local reactions. There are no server, migration, flag or package changes.
