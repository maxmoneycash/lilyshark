#pragma once

/// Audible alerts through the T-Deck's speaker.
///
/// The banner across the status bar only works if someone is looking at the
/// screen. In the field the deck spends most of its time in a pocket or face
/// down on a tailgate, so the events worth interrupting for get a sound too.
namespace lilyshark {

/// A rising two-tone: a message has arrived.
void playMessageChime() noexcept;

/// Two short low blips: a node that was not on the mesh before now is.
void playNodeChime() noexcept;

}  // namespace lilyshark
