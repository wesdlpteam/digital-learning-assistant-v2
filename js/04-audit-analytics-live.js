/* =============================================================
   04-audit-analytics-live.js — INTENTIONALLY EMPTY

   This file used to be a near-verbatim duplicate of
   01-inventory-helpers.js, which crashed the page on load with
   "SyntaxError: Identifier 'TOOL_INVENTORY_CLEANUP_PENDING' has
   already been declared".

   The one meaningful difference (clampYearLevelValue allowing -2
   for kinder year levels) has been merged back into
   01-inventory-helpers.js.

   The audit / live analytics functions implied by the filename
   are restored in 09-legacy-restored.js. The only reason this
   file still exists is to keep the script tag in DLA_Studio.html
   stable. It can be safely deleted (along with its <script> tag)
   at the next refactor.
   ============================================================= */
