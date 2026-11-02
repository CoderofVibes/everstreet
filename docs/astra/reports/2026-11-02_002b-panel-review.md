# Studio panel continuity review after 002b1

Independent browser review of `18494d9`: the ten-second delayed-send case now preserves the
next thought; founder messages are readable at 1280px. Unsaved brief edits disable proposal
application, and saving revision 3 makes the revision-2 proposal visibly stale. These pass.
Internal screenshot: `m2b1-preserved-composer-1280.jpg` in the existing review directory.

One further reproduced loss: with the preserved text still in the composer, switch the
left panel from Assistant to Brief, make/save a brief edit, then return to Assistant. The
composer is empty. `ConversationPanel` is conditionally unmounted when changing side panels,
so local composer and uncertain-send outbox state disappear. Even a simple Assistant → Brief
→ Assistant switch must preserve the next thought and unresolved request identity for this
person/project/owner epoch. Reopening an unresolved send must not mint a new key and duplicate
it; known server work may be reconciled by the existing identity.

Keep the component/state alive at the owning studio scope or lift state deliberately. Reset
on actor/project/owner-epoch change; do not preserve drafts across unrelated people. Refresh
persistence for this unsent conversation draft is a separate explicit behavior, and must be
scoped if added. Do not silently persist secret prompts broadly or store them in shared keys.

This report is an additional acceptance finding, not a change to the active code writer's
files. It can be handled before completing guided-studio acceptance. No live model calls.
