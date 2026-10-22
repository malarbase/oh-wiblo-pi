<!-- forklift v1 -->
# Forklift: maintain this fork

The user describes what they want in their own words — the rest of this invocation is their request. Match it to a situation below, read that procedure, and follow it. Never ask the user which command to run, which registry field to fill, or which files a feature owns.

## Situations

- **"set this fork up", "make this repo fork-aware", "we are forking this project"** → draft the registry, install the harness, and hand back the worklist of what still needs claiming — procedure: the `forklift-init` skill
- **"I just added a feature", "make sure my new code survives the next sync"** → register the feature so the next rebase cannot drop it — procedure: the `forklift-maintain` skill, § *Register a feature*
- **"sync with upstream", "pull in upstream's changes", "rebase onto upstream"** → size the conflict surface, rebase, resolve, gate, and push — procedure: the `sync-upstream` skill
- **"is the fork healthy", "what drifted", "does the registration still match the code"** → audit the registration against the tree and report the findings — procedure: the `forklift-doctor` skill
- **"the rebase went wrong", "features got dropped", "the history is too tangled to rebase"** → triage the history and rebuild it topically — procedure: the `forklift-maintain` skill, § *Rebuilding the history*

## If it is none of these

Answer the question directly. The harness covers the five situations above; a question about the fork's code, its history, or its upstream is ordinary work.
