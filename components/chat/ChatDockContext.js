'use client';

import { createContext, useContext } from 'react';

// What the rest of the app can ask the chat popup (desktop) or sheet (phone) to do. Outside the shell these do nothing.
//   openList()                        show the conversation list
//   openThread({ threadId, title, href })
//   openJob(jobId, title)             the chat of a job, made on first use
//   openPerson(userId, { private })   a conversation with someone (the Office line for a tech when the reader is office/owner)
//   registerPageThread(threadId|null) a full-size chat is showing this conversation, so no window repeats it
const noop = () => {};
export const ChatDockContext = createContext({ openList: noop, openThread: noop, openJob: async () => {}, openPerson: async () => {}, registerPageThread: noop, pageThread: null });
export const useChatDock = () => useContext(ChatDockContext);
