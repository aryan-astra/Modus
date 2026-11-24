<div align="center">

<h1><img src="assets/modus-readme-banner.webp" width="900" alt="Modus"></h1>

<p><strong>See which model replied. Keep your chats organized. Take your work with you.</strong></p>

<p>
  <a href="https://github.com/aryan-astra/Modus/releases/latest"><img alt="Latest Modus release" src="https://img.shields.io/github/v/release/aryan-astra/Modus?style=flat-square&amp;label=release&amp;color=5163a8"></a>
  <a href="https://github.com/aryan-astra/Modus/releases"><img alt="Total GitHub release downloads" src="https://img.shields.io/github/downloads/aryan-astra/Modus/total?style=flat-square&amp;label=release%20downloads&amp;color=416b61"></a>
  <a href="https://github.com/aryan-astra/Modus/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/aryan-astra/Modus?style=flat-square&amp;label=stars&amp;color=96703c"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-606670?style=flat-square"></a>
</p>

<p><a href="https://github.com/aryan-astra/Modus/releases/latest"><strong>Download latest release</strong></a> · <a href="#install">Install</a> · <a href="#updates">Updates</a> · <a href="#features">Features</a> · <a href="https://github.com/aryan-astra/Modus/issues">Report a bug</a></p>

</div>

Modus is a browser extension for ChatGPT. It adds a response inspector, controls for managing chats, and local export.

## Install

1. Open the [latest GitHub release](https://github.com/aryan-astra/Modus/releases/latest) and download the `modus-v*.zip` file under **Assets**.
2. Unzip it. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge and turn on **Developer mode**.
3. Click **Load unpacked** and choose the extracted folder containing `manifest.json`.
4. Open or refresh [ChatGPT](https://chatgpt.com). Open Modus from the browser toolbar to change its settings.

## Updates

Modus checks GitHub Releases automatically. When a newer stable build is available, the toolbar icon shows a **NEW** badge and the Modus popup shows **Update available** with the new version. Select **View release** to read the release notes and download the ZIP.

To install it, extract the new ZIP into the same extension folder, choose **Reload** on the Modus extension card, then refresh your ChatGPT tabs.

## Features

| Feature | What you can do |
| --- | --- |
| **Response model** | See which model ChatGPT reports for the current reply. Activity finds room beside native controls as the toolbar changes. |
| **Context usage and limits** | See reported input and output tokens, context window size, and available quotas and reset times. Enable **Context warning** to get an alert at 90% of the reported context window. |
| **Inline rename** | Use the pencil beside a chat title, then press Enter or click away to save through ChatGPT’s rename control. |
| **Sidebar shortcuts** | Keep available tools such as Images, Tasks, Library, Apps, and Explore in a compact icon strip. |
| **Chat selection** | Hover a chat or focus its checkbox with the keyboard. Select chats from Pinned, Projects, and Recents to export, archive, or delete in bulk. |
| **Group by date** | Give chats collapsible date headings when ChatGPT supplies timestamps. |
| **Long-chat rendering** | Let the browser defer rendering older turns in supported chat layouts. |
| **Save transcripts** | Opt in to keep local copies of opened chats for later export. |

Activity displays values ChatGPT reports. Available metadata can vary by account, feature, and conversation.

## Export your chats

Open **Activity → Export chat** to export the current chat. To export several chats, enable **Save transcripts**, open the chats you want to keep, then select their checkboxes and choose **Export**.

| Format | Best for |
| --- | --- |
| **Markdown** `.md` | Notes that retain headings, lists, and code blocks |
| **Plain text** `.txt` | Reading in any text editor |
| **JSON** `.json` | Structured messages with their roles |
| **PDF** via print | A print-ready copy you can save as a PDF |
| **Context package** `.txt` | Carrying one conversation into another AI tool |

Exports include messages available in the current page or a saved local transcript. The context package is available for one chat at a time.

## Privacy

Modus reads metadata from responses already loaded by ChatGPT and processes it in your browser. Settings are stored locally, and saving transcripts is optional and off by default. Rename, archive, and delete use ChatGPT’s own controls.

The update checker reads the public release listing on GitHub without sending chat data or signing in. Modus has no backend or analytics.

## Develop locally

Use Node.js 24, the version used by release CI.

```sh
npm ci
npm run build
npm test
```

Edit `src/`, then run the build to regenerate `content.js` and `net-sniffer.js`. Load the repository folder as an unpacked extension to try the changes.

The badges refresh automatically. The download count covers assets attached to GitHub Releases and includes repeat downloads.

[Releases](https://github.com/aryan-astra/Modus/releases) · [Issues](https://github.com/aryan-astra/Modus/issues) · [MIT License](LICENSE)
