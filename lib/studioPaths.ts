// Where a session's takes live in the store. Pure, so the booth (which now
// uploads straight to the store) and the server (which lists and reads them)
// agree on the pathnames without the browser importing the server module.

export const takesPrefix = (sessionId: string) => `studio/takes/${sessionId}/`;
export const takePath = (sessionId: string, itemId: string) =>
  `${takesPrefix(sessionId)}${itemId}.wav`;
export const takeMp3Path = (sessionId: string, itemId: string) =>
  `${takesPrefix(sessionId)}${itemId}.mp3`;
