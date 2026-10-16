---
name: video-story-edit
description: "Plan conservative edits of spoken video from a timecoded transcript: remove setup, failed takes or approved repetitions while preserving meaning, then use checked media tools."
metadata:
  version: 1.0.1
---

# Transcript-based edit

If no audio-understanding tool/model is available, mark ambiguous words and cut boundaries for the user's playback review. Do not claim that text-only transcript analysis is listening or proves lip synchronization.

Use `media-toolkit` cached local transcription, or an existing timecoded transcript. Do not send full video or repeatedly retranscribe unchanged audio to plan a cut. Read relevant transcript chunks, then listen to ambiguous boundaries and inspect the associated frames. Silence, breaths and repeated words are not automatically defects.

Propose a numbered cut list: source start/end, reason, wording retained and expected saved time. Preserve qualifiers, negations, disclosures, completed final phrases and the user's latest keep/remove decisions. Existing approval of specific cuts is sufficient; otherwise resolve substantive meaning changes before applying them. Progress independently with unambiguous trim/setup removal permitted by the request. Suggested short-form clips must be self-contained; do not manufacture claims by joining unrelated sentences.

Convert accepted choices into retained intervals for video-trim, retaining edit-map.json. Short preview first; inspect every join's audio and the new ending. Do not rely solely on ASR timestamps or skip visual checks because the model is text-only. Full export only when requested. This is an agent-guided plan using the deterministic helper, not an autonomous semantic-cut detector.
