# Reflect - PSE AI Smart Mirror

A responsive smart-mirror dashboard for the PSE project. The schedule, reminders, clock, privacy mode, and demo briefing run locally. Gmail can optionally be connected through Google OAuth. No Vite, Node.js, or third-party Python packages are required.

## Quick start

### Requirements

- Windows 10/11 with PowerShell
- Python 3.10 or newer
- Chrome or Microsoft Edge recommended for voice input and speech output

### Launch

Open PowerShell and run:

~~~powershell
cd "C:\Users\Dell\Desktop\IPPRO"
python app_server.py
~~~

If the python command is not found, use:

~~~powershell
py app_server.py
~~~

Open http://localhost:8000 in Chrome or Edge. Leave the PowerShell window open while presenting; press **Ctrl+C** in that window to stop the server. Use the app's **Full screen** control or press **F11** in the browser.

If an earlier copy is already running, stop it with **Ctrl+C** before starting another one. The local server uses port 8000 by default.

Without Gmail credentials, the app still launches and shows clearly marked **DEMO DATA** in the briefing.

## What works

- **Clock and date:** update from the computer's local time and time zone.
- **Weather:** requests current conditions for Kolkata from Open-Meteo when internet is available. If offline or unavailable, the card displays an offline message.
- **Schedule and reminders:** add, edit, complete, and delete items. They are saved in this browser's local storage and remain on this browser after refresh. They do not sync to another device.
- **Time questions:** type or say questions such as "What's at 9 pm?" The mirror reads the matching event or says that the time slot is empty. The starter schedule includes a sample item at 9:00 PM.
- **Voice commands:** browser speech recognition and speech synthesis are used where supported. Microphone permission is required for voice input. If voice input is unavailable, use the text command field.
- **Privacy mode:** hides personal schedule and briefing details and stops queued speech.
- **Quick links:** WhatsApp, Instagram, Gmail, Outlook, Telegram, and LinkedIn open their websites in a new tab. The links do not connect those services to the mirror.
- **Responsive display:** the dashboard adapts to laptop and monitor widths.

## Demo data and connected services

The unread count and sample messages shown before Gmail is connected are fictional and labelled **DEMO DATA**. The social-app message examples are always simulated; the quick links only open the service websites.

### Optional: connect a Gmail inbox read-only

Gmail connection requires internet access and a Google Cloud OAuth client. If you skip this section, the rest of the demo continues to work.

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create a project and enable the **Gmail API**.
2. In **Google Auth Platform**, configure the consent screen. For a personal demo, set the audience to **External** and the publishing status to **Testing**, then add the Gmail account you will use as a test user.
3. In **Data Access**, add this scope:

   https://www.googleapis.com/auth/gmail.readonly

4. In **Clients**, create a **Web application** OAuth client and add this exact authorized redirect URI:

   http://localhost:8000/oauth/google/callback

5. In PowerShell, set the Client ID and Client Secret in the same window that will run the server:

~~~powershell
cd "C:\Users\Dell\Desktop\IPPRO"
$env:GOOGLE_CLIENT_ID = Read-Host "Google OAuth Client ID"
$env:GOOGLE_CLIENT_SECRET = Read-Host "Google OAuth Client Secret"
python app_server.py
~~~

   Use py app_server.py if python is not available. Keep the credentials private. Do not paste them into chat, screenshots, source files, or Git. If a client secret has been exposed, reset it in Google Cloud before continuing.

6. Open http://localhost:8000, click **Connect Gmail**, select the test account, and approve the read-only request.

Google may show an unverified-app warning while the app is in Testing. Continue only if the consent screen names your own Smart Mirror app and you are connecting your own test account.

### What Gmail reads

The OAuth scope grants read-only access across the Gmail mailbox. The prototype itself requests the signed-in account's email address, Inbox unread count, and metadata/snippet for the latest unread Inbox message. It does not send or mark messages as read, and it does not save email content or OAuth tokens to disk. Refresh runs about once a minute while the page is open. This is polling, not instant Gmail push.

OAuth tokens are kept in the local Python server's memory and are cleared when it stops, so reconnect after restarting the server. The server binds to the local computer only.

## Troubleshooting

- **python is not recognized:** use py app_server.py.
- **Port 8000 is already in use:** stop the earlier server with **Ctrl+C** in its PowerShell window, then start this one.
- **The page says Gmail setup is needed:** set both OAuth environment variables in the same PowerShell window before launching app_server.py.
- **Google reports a redirect URI mismatch:** confirm the client contains exactly http://localhost:8000/oauth/google/callback and the app is running on port 8000.
- **Google blocks the test account:** confirm the account is listed under **Audience > Test users**, the app is still in Testing, and Gmail API is enabled.
- **Gmail access is denied:** confirm the gmail.readonly scope was added and approved.
- **Voice input does not start:** allow microphone access for localhost and try Chrome or Edge. Use the text command field if browser speech recognition is unavailable.
- **Weather is unavailable:** check the internet connection. The clock and schedule work without the weather service.

## Before pushing to Git

The .gitignore excludes .env files, OAuth client-secret JSON files, and token files. Still review the staged files before pushing:

~~~powershell
git status --short
~~~

Do not add OAuth credentials, refresh/access tokens, personal email data, or secret-containing screenshots to the repository. If any secret was committed or shared, rotate it in Google Cloud before using Gmail again.

## Project files

- index.html - dashboard structure
- styles.css - responsive mirror styling
- app.js - clock, weather, schedule, privacy, voice commands, and Gmail display
- app_server.py - local Python server and optional Gmail OAuth/API routes
- README.md - setup, run, demo, and troubleshooting guide

