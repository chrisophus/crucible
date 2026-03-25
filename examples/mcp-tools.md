# MCP tools

purify exposes its functionality as MCP tools so that AI assistants can call it during a conversation. There are four tools.

**purify_start**: Takes the raw input text and the desired mode. Creates a new session, kicks off the purify process (generating the AISP and running clarifying questions if needed). Returns a session ID and either the first clarifying question or, if no questions are needed, the final output. Status is either `question` (meaning the model has a question) or `complete` (meaning output is ready).

**purify_answer**: Takes a session ID and the user's answer to a clarifying question. Appends the answer to the session conversation, continues the process. Returns the next question or the final output if no more questions remain. Same status values as purify_start. Errors if the session doesn't exist or is already complete.

**purify_output**: Takes a session ID. Returns the final output for a completed session. Errors if the session isn't complete yet. This exists so you can re-fetch the output without storing it yourself.

**purify_status**: Takes a session ID. Returns information about the session: whether it's active or complete, what mode was requested, when it was created. Doesn't return the full output. Useful for checking if a session is still alive.

Sequencing: the normal flow is purify_start → zero or more purify_answer calls → purify_output. The AI assistant drives this — it calls purify_start, and if status is `question`, it presents the question to the user, collects an answer, and calls purify_answer. It repeats until status is `complete`.

Error handling for tool calls: errors should come back as structured error responses, not exceptions. The tool should always return something the caller can inspect.
