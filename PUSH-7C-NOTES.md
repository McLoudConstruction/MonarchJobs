# Push 7c: delete leads, drag to schedule, job tabs

No database change. Nothing to delete.
- Lead page: owner-only "Delete lead" button (asks first). Removes the lead, its estimate and its history. Not shown once the lead is a work order. Uses the existing owner-only delete rule, so office staff do not see it.
- Scheduling a lead (new-lead step 3 and "Create work order" on the lead page): drag the dashed appointment box to a new time or day on the week grid. Works with a finger too. Clicking an open spot still works.
- Job page: three tabs, Customer info (customer, site, also notify), Job Details (visits, job details form, history), Estimate Details (estimate, invoice). The open tab is kept in the link, so a refresh stays on it.
