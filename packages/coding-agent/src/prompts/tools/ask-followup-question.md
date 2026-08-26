Present the user with pre-filled follow-up prompt options they can select from, with an optional mode switch per suggestion.

# When to call

Use this tool at the end of your response when you want to guide the user toward the next step. Each suggestion is a pre-filled prompt the user can send with one click. Optionally attach a mode switch to a suggestion so the user transitions to the right mode for that task.

Common scenarios:

- After answering a question, suggest next steps (e.g. "Implement this", "Write tests", "Review the diff")
- After completing a task, suggest related follow-ups
- When the conversation would benefit from a mode change, include `mode` on the relevant suggestion

# Parameters

- `question` — short label shown above the suggestions (e.g. "What would you like to do next?")
- `follow_up` — array of suggestions, each with:
  - `text` — the pre-filled prompt text the user will send
  - `mode` (optional) — mode to switch to before sending the prompt. One of `"agent"`, `"ask"`, `"plan"`, `"debug"`, `"goal"`. If omitted, stays in the current mode.

# Examples

```
ask_followup_question({
  question: "What would you like to do next?",
  follow_up: [
    { text: "Implement the authentication module", mode: "agent" },
    { text: "Create a plan for the auth module first", mode: "plan" },
    { text: "Show me the current auth code" }
  ]
})
```

# Behavior

- The user sees a selection dialog with each suggestion as an option, plus "Other" for free-form input.
- If the user selects a suggestion with a `mode`, the mode switches first, then the prompt is sent.
- If cancelled, the conversation continues normally.
