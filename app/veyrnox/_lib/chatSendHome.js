// Where the ending of a send lands (ADR-0067). A reply can take a while, and nothing stops the person opening another
// chat, or pressing New chat, before it ends. A message, its notice and its bubbles belong to the chat it was sent in:
// an ending changes the screen only while that chat is the one on it. Otherwise the text waits in that chat's stored
// draft and the notice is held here until the chat is opened. A chat that no longer exists can hold neither, so they
// wait under New chat.
// The view is one object the screen keeps for its whole life and changes in place: an ending runs long after the
// render that started its send, and has to read where the person is now.
// One import, with its extension: the tests load this file directly.
import { NEW_CHAT } from './chatLocal.js';

/**
 * @typedef {object} ChatView
 * @property {string} asked the chat the person last pressed (a chat id, or NEW_CHAT), noted at the press
 * @property {string} shown the chat on screen, noted when its messages arrive; differs from `asked` while one is read
 * @property {Map<string, string>} held one notice per chat that was not on screen when it was raised
 * @property {Set<string>} gone chats deleted from this screen
 */

/** @returns {ChatView} a screen that has just loaded: a chat that has not started */
export function newChatView() {
  return { asked: NEW_CHAT, shown: NEW_CHAT, held: new Map(), gone: new Set() };
}

/** The person pressed a chat, or New chat. */
export function ask(view, chat) {
  view.asked = chat;
}

/** A pressed chat could not be read, so the screen still shows the one before it. A press since then stands. */
export function giveUp(view, chat) {
  if (view.asked === chat) view.asked = view.shown;
}

/**
 * The chat is on screen now.
 * @returns {string|null} the notice that was held for it, once
 */
export function land(view, chat) {
  view.shown = chat;
  const notice = view.held.get(chat) ?? null;
  view.held.delete(chat);
  return notice;
}

/** A notice for a chat that is not on screen waits for it. A later one replaces it. */
export function hold(view, chat, notice) {
  view.held.set(chat, notice);
}

/** True while this chat is the one on screen and the person has not asked for another. */
export function onScreen(view, chat) {
  return view.asked === chat && view.shown === chat;
}

/**
 * A chat was deleted. Nothing waits for it any more, and an ending for it lands under New chat.
 * @returns {boolean} true when it was the chat shown: the screen falls back to a chat that has not started. A chat the
 *   person pressed meanwhile is still on its way, so `asked` moves only if it was this chat.
 */
export function forget(view, chat) {
  view.gone.add(chat);
  view.held.delete(chat);
  if (view.shown !== chat) return false;
  view.shown = NEW_CHAT;
  if (view.asked === chat) view.asked = NEW_CHAT;
  return true;
}

/**
 * Where an ending of a send lands.
 * @param {ChatView} view
 * @param {string|null} sentId the chat the message was sent in; null when none had been made for it yet
 * @returns {{home: string, here: boolean, showing: boolean}} `home`: the chat its text and notice belong to, NEW_CHAT
 *   when there is no chat to hold them. `here`: that chat is on screen and staying, so the ending may change the screen.
 *   `showing`: it is the chat shown, though the person may have pressed another, so the box on screen is still its box.
 */
export function sendHome(view, sentId) {
  const home = sentId && !view.gone.has(sentId) ? sentId : NEW_CHAT;
  return { home, here: onScreen(view, home), showing: view.shown === home };
}
