# Plan and commands (engine 1.0.0)

Run commands with the available Python interpreter. Resolve media.py relative to media-toolkit/SKILL.md. Source files are never overwritten; each edit/verify/captions output directory must be new or empty. `--ffmpeg` / `--ffprobe` are global options before the subcommand. Set `--timeout` in seconds when a user-authorized full export needs more than the 300-second preview limit.

## Edit plan

```json
{
  "source": "/absolute/path/source.mp4",
  "segments": [[10, 12], [20, 23]],
  "width": 1920,
  "height": 1080,
  "fit": "contain",
  "audio": {"normalize": false}
}
```

`segments` are RETAINED source intervals in seconds, ordered and nonoverlapping, maximum 50. The helper aligns boundaries to source frame cadence and records actual source/output times in edit-map.json. Omitting segments retains the full source; over 30 seconds requires `--full`. Omitted dimensions preserve source dimensions. Dimensions must be even, 64..3840. `contain` preserves the entire image with padding; `cover` fills the frame by cropping and requires inspection of subject and screen content. No automatic face tracking is implemented.

Optional root fields:

- `crop`: `{ "x": 100, "y": 0, "width": 1200, "height": 1080 }` in SOURCE pixels, applied before scaling. Inspect source frames before choosing it.
- `audio_source`: absolute path of the operator-selected microphone WAV. It shares source time zero and receives the same cuts; camera audio is never mixed in. Establish synchronization first; this version does not estimate or apply camera/audio offsets.
- `webcam`: `{ "source": "/path/camera.mp4", "size": 240, "x": 1656, "y": 816, "shape": "circle" }`. Coordinates are OUTPUT pixels; shape is circle or square. Defaults place a 300px circle at bottom right. Source time zero must be synchronized and the camera must cover all retained intervals. Constant position only; moving/hiding the camera by interval is not implemented in this version.
- `overlays`: `[{ "source": "/path/diagram.png", "start": 1, "end": 4, "width": 1280, "height": 720, "x": 320, "y": 180 }]`. Times are OUTPUT seconds. Maximum 20 stills; images are fitted without distortion. Default is a full-frame, aspect-preserving insert. Speech continues. No generated image or photo is fetched automatically.
- `captions`: absolute path of an SRT whose times already match the OUTPUT timeline. Requires FFmpeg's subtitles/libass filter. The helper copies the SRT to a safe local filename to avoid Windows drive-letter/filter escaping. Inspect Cyrillic, line breaks and safe zones. It does not silently repair missing subtitle filters or convert source-timed captions to edited time.
- `audio.normalize`: boolean, default false. Two-pass loudness normalization to -16 LUFS / -1.5 dBTP; silent/invalid measurements are rejected. No denoising, voice generation or background music is added. Check actual audio after processing.

```text
<python> "<toolkit>/scripts/media.py" edit --plan "<absolute-plan.json>" --output "<new-output>"
```

The output is preview.mp4, even for a requested full export. A full export uses `--full --timeout 7200` if appropriate. inspect report.json, edit-map.json and review-sheet.jpg. Review cuts at their output times, not source times. The three overview samples alone do not prove all cuts, captions or lip synchronization are correct. Use the existing image/shell tools to inspect additional specific frames/audio when needed, without dumping full logs or repeatedly polling.

## Verify an existing export

```text
<python> "<toolkit>/scripts/media.py" verify --source "<video>" --output "<new-review-directory>" --expected-duration 5
```

Checks nonzero video, duration tolerance when requested, square pixels, full decode, and creates three nonempty JPEGs and a review sheet. It reports audio presence but cannot know whether audio is required unless checked against the task. Compare dimensions/audio/segments against the user's request; technical pass is always visual_review_required. Full decode can take time on long recordings; set timeout according to the requested verification.

## Caption export

Prepare UTF-8 JSON: `[{"start":0.5,"end":2.5,"text":"First caption"}]`. Times must be ordered, nonoverlapping and match the output video. Substantial script/audio disagreements require listening and a decision; fixing spelling is different from changing what was said.

```text
<python> "<toolkit>/scripts/media.py" captions --cues "<cues.json>" --output "<new-caption-directory>"
```

Produces captions.srt and captions.vtt. There is no automatic word-level alignment; do not claim karaoke timing from segment times.

## Local transcription and cache

```text
<python> "<toolkit>/scripts/media.py" transcribe --source "<video>" --whisper "<whisper-cli>" --model "<local-ggml-model.bin>" --language ru --cache "<project>/.arni-media-cache" --timeout 1800
```

Extracts a separate 16 kHz mono analysis WAV; rendering uses original audio. Stores Whisper TXT/SRT/JSON plus their hashes. Reuses the transcript when source path/size/mtime, model path/size/mtime, language and engine version match, and cached transcript hashes validate. This is a local file cache, not an LLM prompt cache; a metadata fingerprint is not a cryptographic hash of the complete source video. Model files remain on the user's machine. Do not rerun transcription to change a title or insert.

Whisper output is a draft. Check unclear names/numbers and cut boundaries against the recording; retain uncertainty. If whisper.cpp or its model is absent, stop this operation and offer setup or an existing transcript. Never claim the model was downloaded or ASR was tested when only the command was prepared.
