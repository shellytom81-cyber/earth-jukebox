# [Your Project Name]
*[Your tagline, e.g. "Hear our planet's data."]*

Built by Team [Team Name] ([member names]) for the 2026 NASA Space Apps
Challenge, "Earth Jukebox" challenge.

## What it does
An accessible web app that turns a NASA Earth visualization into sound.
A playhead scans the image left to right, and each column is played as
musical notes, so blind and low-vision users can explore Earth science
by ear.

## How the image becomes sound
- The image is divided into a 16×8 grid.
- Row (height) → pitch, using the C major pentatonic scale (C4–E5)
- Brightness → volume
- Warm vs. cool color → triangle vs. sine wave
- Playhead position → stereo pan (left to right)
- Scan speed is adjustable (1–12 columns per second)

## Accessibility
Keyboard control (Space = play/pause, arrows = speed), skip link,
screen-reader live description of what is playing, high-contrast mode,
large-text mode, labeled controls, reduced-motion support.

## NASA data used
- [Name of the NASA EIC / SVS visualization(s), with link]

## Run locally
1. Install Node.js
2. `npm install`
3. `npm run dev`  (opens on http://localhost:3000)

No API key is required.

## Live demo
[your deployed link]

## Use of AI
This project was built with AI assistance (Google AI Studio and
Claude). [Describe honestly what AI generated and what our team
decided, chose, tested and edited.]

## Credits
Imagery: NASA Scientific Visualization Studio.
