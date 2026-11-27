<p align="center"><img src="logo.svg" width="96" alt="PlayList logo"></p>

# PlayList

A one-page web player. Paste a YouTube or YouTube Music playlist link and listen in the browser. There is no backend, no account and no build step.

## Run it locally

The quickest way:

- **Windows:** double-click `start.bat`.
- **macOS / Linux:** run `./start.sh`. The first time, run `chmod +x start.sh`.

Either one starts a local server on port 5500 and opens http://localhost:5500 in your browser. You need Python or Node.js installed.

YouTube's embedded player needs the page to be served over `http://`. If you double-click `index.html`, the page opens as `file://` and YouTube may refuse to play. To start a server by hand from this folder instead:

```bash
# Python (already installed on most machines)
python -m http.server 5500

# or Node
npx serve .
```

Then open http://localhost:5500.

## Deploy

All files are static (`index.html`, `style.css`, `app.js`), so any static host works: GitHub Pages, Netlify, Vercel or Cloudflare Pages. Upload the folder and you're live.

## Features

- Accepts these links: `music.youtube.com/playlist?list=…`, `youtube.com/playlist?list=…`, `youtube.com/watch?v=…&list=…`, single videos, `youtu.be/…`, or a bare playlist ID.
- Saves several playlists in the browser (localStorage). You can rename and remove them.
- Large play, previous and next buttons, a seek bar, volume, shuffle and repeat.
- A track list with thumbnails. Click a track to jump to it.
- Share links (`…/#list=PLxxxx`). Anyone who opens one gets that playlist loaded.
- Lock-screen and media-key controls through the Media Session API.
- Keyboard shortcuts: `Space` play/pause, `←`/`→` seek 10 seconds, `Shift+←`/`Shift+→` previous/next.

## Limits (set by YouTube, not this site)

- The playlist must be **Public** or **Unlisted**. Private playlists won't load.
- Some tracks block embedding. They show an error and the player skips them.
- The embedded player loads at most about 200 tracks of a playlist.
- Auto-generated YouTube Music "Mix" or "Radio" lists (IDs starting with `RD`) often don't work in embeds.
- On phones, playback usually stops when the screen locks or the browser goes to the background.
- Spotify, Apple Music and JioSaavn links can't be played this way.
- Track titles come from the free `noembed.com` service and are cached in the browser. If it's unreachable, the list shows "Track N" until each song plays.
