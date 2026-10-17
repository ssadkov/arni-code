---
name: fill-form
description: "Read a web form, map its fields to user-approved information, fill and verify it with browser tools, then stop at the agreed review/submission boundary."
metadata:
  version: 1.0.0
---

# Fill a form

Use the integrated browser tools to open the supplied URL and read questions, required markers, validation and consent text. If an existing page must be shared with the agent, explain the normal sharing control. If browser tools are absent/disabled, explain the setting rather than claiming success or installing an unrelated automation stack.

List the required fields and unresolved choices. Use user-profile for the account-bound personal card. Obtain permission naming the actual destination and values before typing private data: typing may transmit them even without submission. The profile tool's review discloses values to the model; it does not itself grant website agreements or submit the form. Preserve existing page entries; clarify conflicts. Never fabricate missing tax IDs, company names or eligibility answers.

Fill only the approved entries, then read them back and check each against the source. Do not print the full personal card into an output file. Avoid sending unrelated data in screenshots; show the user a useful review in the application. Report what is filled and missing, whether any consent is selected and whether anything was submitted. Do not interpret a screenshot or HTTP 200 alone as successful registration.

For the first AIFC test, use the user's supplied form URL. It asks Company Name → companyName, BIN → companyBin, Name/Surname → confirmed firstNameLatin/lastNameLatin, Contact number → phone, Email → email. Verify the current questions instead of relying on this mapping if the form changes. The consent observed on 18 October 2026 included direct marketing, so summarize its current scope. Stop with the fields filled, consent unselected and form unsubmitted for the user's final review. A successful completion here means verified draft fields, not a registration receipt.

If login, CAPTCHA, closed registration, conflicting data or an unexpected commitment blocks progress, ask for the specific missing user action. Do not loop retries or change methods to bypass the restriction. Apply ordinary user authorization to later tasks; the AIFC draft boundary is a test-specific instruction.
