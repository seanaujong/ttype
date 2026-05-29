# ttype demo — a VHS tape (https://github.com/charmbracelet/vhs)
#
# Renders the README demo. The output GIF/MP4 is NOT committed (see .gitignore);
# only this script is. Re-render anytime the UI changes:
#
#     brew install vhs        # pulls ttyd + ffmpeg
#     vhs demo/ttype.tape     # run from the repo root
#
# Then drag the generated demo/ttype.mp4 into a GitHub issue/comment to get a
# CDN URL, and paste that URL into the README (the binary never enters git).

Output demo/ttype.gif
Output demo/ttype.mp4

Set Shell "bash"
Set FontSize 22
Set Width 1200
Set Height 700
Set Padding 20
Set TypingSpeed 75ms

# Point `ttype` at the source so this tape renders from a fresh clone with no
# build or `npm link`. Hidden so the recording shows the real command.
Hide
Type "alias ttype='npx tsx source/cli.tsx'"
Enter
Type "clear"
Enter
Show

# Launch the racer over a short pangram.
Type "ttype demo/demo.txt"
Enter
Sleep 1500ms

# Race it — correct characters turn green as you go.
Type "The quick brown fox jumps over the lazy do"
Sleep 300ms

# A deliberate fumble: 'h' is wrong (should be 'g'), so it renders red...
Type "h"
Sleep 600ms

# ...backspace and correct it, then finish.
Backspace
Type "g."
Sleep 500ms

# Linger on the end-of-run results screen (WPM + accuracy).
Sleep 4s
