# Dependency setup

This skill ships instructions and a standard-library Python helper, not Python or FFmpeg binaries. Installation can download packages and change the computer. Identify missing dependencies first; explain the proposed change and obtain consent unless the user already authorized it. Never enter administrator passwords for the user. When installation needs an interactive system prompt, let the user complete it and resume afterwards.

## macOS

Check `python3 --version`, `command -v brew`, and doctor. Apps opened from Finder may have a different PATH: check `/opt/homebrew/bin` (Apple Silicon), `/usr/local/bin` (Intel), and installed Python framework paths before declaring a tool missing. Do not interpret the `/usr/bin/python3` developer-tools stub as a usable interpreter without running it. Stop if it prompts for developer tools; explain that separately.

If Homebrew is already installed, propose installing only missing formulae with its resolved executable: `brew install python3` and/or `brew install ffmpeg`. Do not upgrade unrelated packages. For an existing FFmpeg build missing the required filters or encoders, explain why a complete build is needed before installing it. See official [Python installation guidance](https://docs.brew.sh/Homebrew-and-Python) and [FFmpeg formula](https://formulae.brew.sh/formula/ffmpeg).

If Homebrew is absent, offer its [official installation](https://brew.sh/) as a separate first-time setup; it may require Apple's Command Line Tools, administrator confirmation and additional download time. Read the current official steps before running an installer; do not improvise a download or silently pipe a remote script into a shell. A signed [Python.org macOS installer](https://www.python.org/downloads/macos/) is an alternative for Python, but does not install FFmpeg. Never replace Apple's system Python or disable Gatekeeper.

After installation, find and use the actual interpreter and FFmpeg paths in the current session rather than rewriting shell startup files. Rerun `<python> "<skill-directory>/scripts/greenscreen.py" doctor --ffmpeg "<ffmpeg>" --ffprobe "<ffprobe>"`. Pass the same FFmpeg paths to `prepare`. A ready report means dependencies work, not that a video has been processed.

## Windows

Check `python --version` or `py -3 --version`, and resolve FFmpeg using `Get-Command`. A Store alias that opens an installer is not a working interpreter. If tools exist outside PATH, use their full paths. If absent, offer installation via the available package manager or official installers; inspect current package identifiers before proposing an install. Do not install a second Python or FFmpeg when an existing compatible copy is available. Refresh executable resolution in the current session after installation and rerun doctor before accessing the media.

## If installation is declined or fails

Report the missing tool and the actual installation error, and stop before preparing/rendering. Explain that ordinary chat/coding still works. Do not repeatedly retry the same failed install, switch to a paid model to fix missing local software, or claim a preview was created.
