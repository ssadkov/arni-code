---
name: fill-form
description: "Read a web form, map its fields to user-approved information, fill and verify it with browser tools, then stop at the agreed review/submission boundary."
metadata:
  version: 1.0.2
---

# Fill a form

Use the integrated browser tools to open the supplied URL and read questions, required markers, validation and consent text. If an existing page must be shared with the agent, explain the normal sharing control. If browser tools are absent/disabled, explain the setting rather than claiming success or installing an unrelated automation stack.

List the required fields and unresolved choices. Use user-profile for the account-bound personal card. Obtain permission naming the actual destination and values before typing private data: typing may transmit them even without submission. The profile tool's review discloses values to the model; it does not itself grant website agreements or submit the form. Preserve existing page entries; clarify conflicts. Never fabricate missing tax IDs, company names or eligibility answers.

Inspect the current questions before calling the card tool; do not run first page inspection and card reading in parallel. Map every required question, including organization/registration identifiers. Request the complete needed subset once, using custom field IDs or visible labels if applicable. For a Latin name, request firstNameLatin/lastNameLatin rather than also requesting duplicate generic name fields. If data needs correcting, use the card's reviewed AI edit tool or normal form before continuing.

A supplied source URL is not evidence of its contents. Open and read that exact page before extracting company/contact details. Do not derive an organization from the project title, invent a BIN/phone, or construct an email from a person's name and domain. Before the first input, show a compact table of form field → proposed value → actual source (read page URL, user message, or approved card field). Leave missing/conflicting values unresolved and ask the user; when a value's source has not been read, do not type it. If the user has already authorized the exact values and destination, the table does not require another generic confirmation; clarify new disclosures or ambiguity before acting.

For typeInPage, use ref from the latest snapshot (e.g. ref:"e46") or an exact Playwright selector for the editable field. element is a human-readable label, not a locator. Never turn [ref=e46] into a CSS selector. The tool verifies the resulting value; a mismatch may mean the site formatted/rejected the input. Inspect and resolve it instead of claiming success. An unchanged result is not progress. On a blocked repeat, card approval_timeout/retry_blocked/awaiting_user, or refusal, stop and explain the required user action. Do not switch to generic keyboard/Playwright code to evade the stop. Consent controls are not text fields: for an unsubmitted draft, leave them alone.

Fill only the approved entries, then read them back and check each against the source. Do not print the full personal card into an output file. Avoid sending unrelated data in screenshots; show the user a useful review in the application. Report what is filled and missing, whether any consent is selected and whether anything was submitted. Do not interpret a screenshot or HTTP 200 alone as successful registration.

For the first AIFC test, use the user's supplied form URL. It asks Company Name → companyName, BIN → companyBin, Name/Surname → confirmed firstNameLatin/lastNameLatin, Contact number → phone, Email → email. Verify the current questions instead of relying on this mapping if the form changes. The consent observed on 18 October 2026 included direct marketing, so summarize its current scope. Stop with the fields filled, consent unselected and form unsubmitted for the user's final review. A successful completion here means verified draft fields, not a registration receipt.

If login, CAPTCHA, closed registration, conflicting data or an unexpected commitment blocks progress, ask for the specific missing user action. Do not loop retries or change methods to bypass the restriction. Apply ordinary user authorization to later tasks; the AIFC draft boundary is a test-specific instruction.
