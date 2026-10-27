(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const clockElement = $('#clock');
  const secondsElement = $('#seconds');
  const dateLine = $('#dateLine');
  const scheduleList = $('#scheduleList');
  const scheduleCount = $('#scheduleCount');
  const scheduleEmpty = $('#scheduleEmpty');
  const eventDialog = $('#eventDialog');
  const eventForm = $('#eventForm');
  const toast = $('#toast');
  const fullscreenToggle = $('#fullscreenToggle');
  const fullscreenLabel = $('#fullscreenLabel');
  const STORAGE_KEY = 'reflect.smartMirror.schedule.v1';
  let toastTimer;
  let editingId = null;

  const timeOptions = { hour: '2-digit', minute: '2-digit' };
  const formatTime = (value) => {
    const [hour, minute] = value.split(':').map(Number);
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return new Intl.DateTimeFormat(undefined, timeOptions).format(date);
  };

  function renderClock() {
    const now = new Date();
    clockElement.textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    secondsElement.textContent = String(now.getSeconds()).padStart(2, '0');
    dateLine.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now);
    const hour = now.getHours();
    $('#greeting').textContent = hour < 12 ? 'A NEW DAY, AT YOUR PACE' : hour < 17 ? 'A LITTLE SPACE TO RESET' : 'WIND DOWN, AT YOUR PACE';
    $('#scheduleDate').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(now).toUpperCase();
  }

  function defaultSchedule() {
    return [
      { id: crypto.randomUUID(), title: 'Review the Smart Mirror demo', time: '21:00', kind: 'event', done: false, sample: true },
      { id: crypto.randomUUID(), title: 'Take a short screen break', time: '22:00', kind: 'reminder', done: false, sample: true },
      { id: crypto.randomUUID(), title: 'PSE project check-in', time: '23:30', kind: 'event', done: false, sample: true },
    ];
  }

  function loadSchedule() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((item) => item && typeof item.title === 'string' && /^\d{2}:\d{2}$/.test(item.time));
          const seedTitles = ['Review the Smart Mirror demo', 'Take a short screen break', 'PSE project check-in'];
          const untouchedSeed = valid.length === seedTitles.length && valid.every((item, index) => item.sample && !item.done && item.title === seedTitles[index]);
          const seedTimes = ['21:00', '22:00', '23:30'];
          if (untouchedSeed && valid.some((item, index) => item.time !== seedTimes[index])) {
            const refreshed = defaultSchedule().map((item, index) => ({ ...item, id: valid[index].id }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
            return refreshed;
          }
          return valid;
        }
      }
      const initial = defaultSchedule();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    } catch (error) {
      return defaultSchedule();
    }
  }

  let schedule = loadSchedule();

  function persistSchedule() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
      return true;
    } catch (error) {
      showToast('Browser storage is unavailable. Changes may not persist after closing this tab.');
      return false;
    }
  }

  function renderSchedule() {
    const sorted = [...schedule].sort((a, b) => a.time.localeCompare(b.time));
    scheduleList.replaceChildren();
    sorted.forEach((item) => {
      const row = document.createElement('article');
      row.className = `schedule-item${item.done ? ' is-done' : ''}`;
      row.dataset.kind = item.kind;
      const time = document.createElement('time');
      time.className = 'event-time';
      time.dateTime = item.time;
      time.textContent = formatTime(item.time);
      const marker = document.createElement('span');
      marker.className = 'event-marker';
      marker.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div');
      content.className = 'event-main';
      const title = document.createElement('div');
      title.className = 'event-title';
      title.textContent = item.title;
      const kind = document.createElement('div');
      kind.className = 'event-type';
      kind.textContent = item.sample ? `SAMPLE ${item.kind}` : item.kind;
      content.append(title, kind);
      const actions = document.createElement('div');
      actions.className = 'event-actions';
      const done = document.createElement('button');
      done.className = 'event-action';
      done.type = 'button';
      done.title = item.done ? 'Mark as not done' : 'Mark as done';
      done.setAttribute('aria-label', `${done.title}: ${item.title}`);
      done.textContent = item.done ? '↶' : '✓';
      done.addEventListener('click', () => {
        schedule = schedule.map((entry) => entry.id === item.id ? { ...entry, done: !entry.done } : entry);
        persistSchedule(); renderSchedule();
      });
      const edit = document.createElement('button');
      edit.className = 'event-action'; edit.type = 'button'; edit.title = 'Edit'; edit.setAttribute('aria-label', `Edit ${item.title}`); edit.textContent = '✎';
      edit.addEventListener('click', () => openDialog(item));
      const remove = document.createElement('button');
      remove.className = 'event-action delete'; remove.type = 'button'; remove.title = 'Delete'; remove.setAttribute('aria-label', `Delete ${item.title}`); remove.textContent = '×';
      remove.addEventListener('click', () => {
        schedule = schedule.filter((entry) => entry.id !== item.id);
        persistSchedule(); renderSchedule(); showToast('Removed from your schedule.');
      });
      actions.append(done, edit, remove);
      row.append(time, marker, content, actions);
      scheduleList.append(row);
    });
    scheduleCount.textContent = String(schedule.filter((item) => !item.done).length).padStart(2, '0');
    scheduleEmpty.hidden = sorted.length > 0;
    scheduleList.hidden = sorted.length === 0;
  }

  function openDialog(item = null) {
    editingId = item?.id ?? null;
    $('#dialogTitle').textContent = item ? 'Edit your plan' : 'Add to your day';
    $('#eventTitle').value = item?.title ?? '';
    $('#eventTime').value = item?.time ?? `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    $('#eventKind').value = item?.kind ?? 'event';
    eventDialog.showModal();
    $('#eventTitle').focus();
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  $('#addEventButton').addEventListener('click', () => openDialog());
  $('#closeDialogButton').addEventListener('click', () => eventDialog.close());
  $('#cancelDialogButton').addEventListener('click', () => eventDialog.close());
  eventForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('#eventTitle').value.trim();
    if (!title) return;
    const data = { title, time: $('#eventTime').value, kind: $('#eventKind').value };
    if (editingId) schedule = schedule.map((item) => item.id === editingId ? { ...item, ...data, sample: false } : item);
    else schedule.push({ id: crypto.randomUUID(), ...data, done: false });
    persistSchedule(); renderSchedule(); eventDialog.close();
    showToast(editingId ? 'Your schedule was updated.' : 'Added to your schedule.');
    editingId = null;
  });
  eventDialog.addEventListener('click', (event) => { if (event.target === eventDialog) eventDialog.close(); });
  $('#clearDoneButton').addEventListener('click', () => {
    const oldLength = schedule.length;
    schedule = schedule.filter((item) => !item.done);
    if (oldLength === schedule.length) return showToast('No completed items to clear.');
    persistSchedule(); renderSchedule(); showToast('Completed items cleared.');
  });

  const privacyButton = $('#privacyToggle');
  privacyButton.addEventListener('click', () => {
    const enabled = privacyButton.getAttribute('aria-pressed') !== 'true';
    privacyButton.setAttribute('aria-pressed', String(enabled));
    document.body.classList.toggle('privacy-mode', enabled);
    try { localStorage.setItem('reflect.smartMirror.privacy', String(enabled)); } catch (_) {}
    if (enabled) {
      $('#commandResponse').textContent = 'Privacy mode is on. Command details are hidden.';
      $('#commandInput').value = '';
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    }
    showToast(enabled ? 'Privacy mode on. Briefing and schedule details are hidden.' : 'Privacy mode off.');
  });
  try {
    if (localStorage.getItem('reflect.smartMirror.privacy') === 'true') {
      privacyButton.setAttribute('aria-pressed', 'true');
      document.body.classList.add('privacy-mode');
    }
  } catch (_) {}

  function describeWeather(code) {
    if (code === 0) return ['Clear sky', '☀'];
    if ([1, 2].includes(code)) return ['Partly cloudy', '◐'];
    if (code === 3) return ['Overcast', '☁'];
    if ([45, 48].includes(code)) return ['Foggy', '≋'];
    if ([51, 53, 55, 56, 57].includes(code)) return ['Drizzle', '☂'];
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ['Rain nearby', '☂'];
    if ([71, 73, 75, 77, 85, 86].includes(code)) return ['Snow', '❄'];
    if ([95, 96, 99].includes(code)) return ['Thunderstorms', 'ϟ'];
    return ['Current conditions', '◌'];
  }

  async function loadWeather() {
    const status = $('#weatherStatus');
    const endpoint = 'https://api.open-meteo.com/v1/forecast?latitude=22.5726&longitude=88.3639&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=Asia%2FKolkata';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);
      const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeout);
      if (!response.ok) throw new Error('Forecast unavailable');
      const result = await response.json();
      const current = result.current;
      const [description, icon] = describeWeather(current.weather_code);
      $('#temperature').textContent = `${Math.round(current.temperature_2m)}°`;
      $('#weatherIcon').textContent = icon;
      $('#weatherDescription').textContent = description;
      $('#feelsLike').textContent = `Feels like ${Math.round(current.apparent_temperature)}°`;
      $('#windSpeed').textContent = `Wind ${Math.round(current.wind_speed_10m)} km/h`;
      status.textContent = 'LIVE';
      status.title = 'Current weather from Open-Meteo';
    } catch (error) {
      $('#temperature').textContent = '--°';
      $('#weatherIcon').textContent = '◌';
      $('#weatherDescription').textContent = 'Forecast unavailable offline';
      $('#feelsLike').textContent = 'Reconnect to refresh';
      $('#windSpeed').textContent = 'No sign-in needed';
      status.textContent = 'OFFLINE';
      status.title = 'Weather will appear when an internet connection is available';
    }
  }

  function updateConnection() {
    const state = $('#connectionState');
    const connected = navigator.onLine;
    state.classList.toggle('offline', !connected);
    $('#connectionText').textContent = connected ? 'Online' : 'Offline mode';
  }
  window.addEventListener('online', () => { updateConnection(); loadWeather(); });
  window.addEventListener('offline', updateConnection);

  const gmailConnectButton = $('#gmailConnectButton');
  const gmailCard = $('#gmailMessageCard');
  let gmailConfigured = false;
  let gmailConnected = false;

  function setBriefingBadge(label, live = false) {
    const badge = $('#briefingBadge');
    badge.dataset.live = String(live);
    const dot = document.createElement('span');
    badge.replaceChildren(dot, document.createTextNode(` ${label}`));
  }

  function renderDemoGmail() {
    gmailCard.querySelector('.message-avatar').textContent = 'M';
    gmailCard.querySelector('.message-meta strong').textContent = 'Meera Shah';
    gmailCard.querySelector('.message-meta span').textContent = 'Gmail · DEMO DATA · 8:46 AM';
    gmailCard.querySelector('.message-body p').textContent = 'Shared the final slides for tomorrow.';
    gmailCard.querySelector('.unread-dot').hidden = false;
    gmailCard.querySelector('.unread-dot').setAttribute('aria-label', 'Unread sample');
    $('#inboxUnreadCount').textContent = '08';
    $('#inboxUnreadCaption').textContent = 'unread';
    $('#inboxSummaryTitle').textContent = 'Across your inboxes';
    $('#inboxSummaryNote').textContent = 'Sample count for display only';
    $('#messageList').setAttribute('aria-label', 'Sample messages');
    $('#briefingFootnote').innerHTML = '<span class="info-icon">i</span> Sample names and messages are fictional.';
    setBriefingBadge('DEMO DATA');
  }

  function renderLiveGmail(inbox) {
    const message = inbox.message;
    const avatar = gmailCard.querySelector('.message-avatar');
    const sender = gmailCard.querySelector('.message-meta strong');
    const source = gmailCard.querySelector('.message-meta span');
    const preview = gmailCard.querySelector('.message-body p');
    const unreadDot = gmailCard.querySelector('.unread-dot');
    avatar.textContent = message ? (message.sender.trim()[0] || 'G').toUpperCase() : 'G';
    sender.textContent = message ? message.sender : 'No unread messages';
    source.textContent = message ? `Gmail · LIVE · ${message.receivedAt}` : 'Gmail · LIVE';
    preview.textContent = message
      ? `${message.subject}${message.snippet ? ` — ${message.snippet}` : ''}`
      : 'Your inbox is up to date.';
    unreadDot.hidden = !message;
    unreadDot.setAttribute('aria-label', 'Unread Gmail message');
    $('#inboxUnreadCount').textContent = String(inbox.unread ?? 0).padStart(2, '0');
    $('#inboxUnreadCaption').textContent = 'unread';
    $('#inboxSummaryTitle').textContent = 'Gmail inbox';
    $('#inboxSummaryNote').textContent = 'Read-only · refreshes every minute';
    $('#messageList').setAttribute('aria-label', 'Live Gmail and demo messages');
    $('#briefingIntro').textContent = 'Gmail is connected read-only. WhatsApp and Telegram previews remain DEMO DATA.';
    $('#briefingFootnote').innerHTML = '<span class="info-icon">i</span> Gmail preview is live; social message examples are DEMO DATA.';
    setBriefingBadge('GMAIL · LIVE', true);
  }

  function updateGmailButton() {
    gmailConnectButton.textContent = gmailConnected ? 'Disconnect' : 'Connect Gmail';
    gmailConnectButton.setAttribute('aria-pressed', String(gmailConnected));
    gmailConnectButton.title = gmailConnected ? 'Disconnect and revoke Gmail read access' : 'Connect a Gmail inbox with read-only access';
  }

  async function refreshGmailBriefing() {
    try {
      const statusResponse = await fetch('/api/gmail/status', { cache: 'no-store' });
      if (!statusResponse.ok) throw new Error('Gmail backend unavailable');
      const status = await statusResponse.json();
      gmailConfigured = Boolean(status.configured);
      gmailConnected = Boolean(status.connected);
      updateGmailButton();
      if (!gmailConfigured) {
        gmailConnected = false;
        updateGmailButton();
        renderDemoGmail();
        $('#briefingIntro').textContent = 'Gmail setup is needed. Follow the Google OAuth steps in README.md; all shown messages remain DEMO DATA.';
        return;
      }
      if (!gmailConnected) {
        renderDemoGmail();
        $('#briefingIntro').textContent = 'Connect Gmail for a read-only inbox preview. WhatsApp and Telegram samples remain DEMO DATA.';
        return;
      }
      const inboxResponse = await fetch('/api/gmail/inbox', { cache: 'no-store' });
      const inbox = await inboxResponse.json();
      if (inboxResponse.status === 401) {
        gmailConnected = false;
        updateGmailButton();
        renderDemoGmail();
        $('#briefingIntro').textContent = `${inbox.error || 'Gmail authorization expired.'} Connect Gmail again; samples remain DEMO DATA.`;
        return;
      }
      if (!inboxResponse.ok) throw new Error(inbox.error || 'Gmail refresh failed');
      renderLiveGmail(inbox);
    } catch (error) {
      if (gmailConnected) {
        $('#briefingIntro').textContent = `${error.message || 'Gmail refresh failed.'} Retrying in one minute.`;
      } else {
        gmailConfigured = false;
        renderDemoGmail();
        $('#briefingIntro').textContent = 'Start app_server.py to enable Gmail sign-in. Demo messages remain labelled DEMO DATA.';
      }
      updateGmailButton();
    }
  }

  gmailConnectButton.addEventListener('click', async () => {
    if (gmailConnected) {
      if (!window.confirm('Disconnect Gmail and revoke this mirror’s read-only access?')) return;
      try {
        await fetch('/api/gmail/disconnect', { method: 'POST' });
        gmailConnected = false;
        updateGmailButton();
        renderDemoGmail();
        $('#briefingIntro').textContent = 'Gmail disconnected. Sample messages are labelled DEMO DATA.';
        showToast('Gmail disconnected.');
      } catch (_) {
        showToast('Gmail could not be disconnected. Try again.');
      }
      return;
    }
    if (!gmailConfigured) {
      showToast('Gmail needs Google OAuth setup. Follow the Gmail section in README.md.');
      return;
    }
    window.location.assign('/auth/gmail/start');
  });

  refreshGmailBriefing();
  setInterval(() => { if (gmailConnected) refreshGmailBriefing(); }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && gmailConnected) refreshGmailBriefing();
  });

  const voiceButton = $('#voiceButton');
  const voiceStatus = $('#voiceStatus');
  const commandFallback = $('#commandFallback');
  const commandForm = $('#commandFallback');
  const commandInput = $('#commandInput');
  const commandResponse = $('#commandResponse');
  const commandFallbackLabel = $('#commandFallbackLabel');
  const showCommandFallbackButton = $('#showCommandFallback');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechOutputAvailable = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  let activeRecognition = null;

  function speak(text) {
    if (!speechOutputAvailable) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || 'en-US';
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function showCommandResponse(text, spokenText = text) {
    const privacyOn = privacyButton.getAttribute('aria-pressed') === 'true';
    const safeText = privacyOn ? 'Privacy mode is on. Command details are hidden.' : text;
    commandResponse.textContent = safeText;
    commandResponse.hidden = false;
    showToast(safeText);
    if (!privacyOn) {
      voiceStatus.textContent = speak(spokenText)
        ? 'Speaking the answer'
        : 'Text reply only here; use Chrome or Edge for audio';
    }
  }

  function parseRequestedTime(words) {
    const normalized = words.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
    const match = normalized.match(/\b(?:at\s+)?(0?[1-9]|1[0-2]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*:\s*(\d{2}))?\s*(am|pm)\b/);
    if (!match) return null;
    const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    const value = numberWords[match[1]] ?? Number(match[1]);
    const hour = (value % 12) + (match[3] === 'pm' ? 12 : 0);
    return { hour, minute: match[2] === undefined ? null : Number(match[2]), label: `${value}${match[3].toUpperCase()}` };
  }

  function isEventCreationCommand(words) {
    return (/\b(?:add|create|set|schedule)\b/.test(words) && /\b(?:reminder|event)\b/.test(words)) || /\bremind me\b/.test(words);
  }

  function extractEventTitle(command) {
    const spokenTime = /\b(?:at|for)\s+(?:0?[1-9]|1[0-2]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*:\s*\d{2})?\s*(?:am|pm)\b/i;
    return command.trim()
      .replace(/[.]/g, '')
      .replace(/[!?]+$/g, '')
      .replace(/^\s*(?:please\s+)?(?:add|create|set|schedule)\s+(?:(?:a|an|new)\s+)*(?:reminder|event)\b/i, '')
      .replace(/^\s*remind\s+me(?:\s+to)?\s*/i, '')
      .replace(spokenTime, ' ')
      .replace(/^\s*(?:to|that)\s+/i, '')
      .replace(/^[\s,:;—-]+|[\s,:;—-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function runVoiceCommand(command) {
    const words = command.toLowerCase().replace(/[’]/g, "'");
    if (isEventCreationCommand(words)) {
      const requestedTime = parseRequestedTime(words);
      const title = extractEventTitle(command);
      if (!requestedTime) {
        commandFallback.hidden = false;
        showCommandResponse('Please include a time, for example “add a reminder at 6 pm to review the demo”.');
        commandInput.focus();
        return;
      }
      if (!title) {
        commandFallback.hidden = false;
        showCommandResponse('Tell me what the event or reminder is for.');
        commandInput.focus();
        return;
      }
      const time = `${String(requestedTime.hour).padStart(2, '0')}:${String(requestedTime.minute ?? 0).padStart(2, '0')}`;
      const kind = /\b(?:reminder|remind me)\b/.test(words) ? 'reminder' : 'event';
      schedule.push({ id: crypto.randomUUID(), title, time, kind, done: false });
      persistSchedule();
      renderSchedule();
      $('#schedulePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      showCommandResponse(`Added ${kind} “${title}” for ${formatTime(time)}.`);
      return;
    }
    if (words.includes('weather')) {
      $('.weather-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
      const temperature = $('#temperature').textContent;
      const description = $('#weatherDescription').textContent;
      const weatherStatus = $('#weatherStatus').textContent;
      const response = weatherStatus === 'LIVE' && temperature !== '--°'
        ? `In Kolkata, it is ${temperature.replace('°', ' degrees')}, ${description.toLowerCase()}. ${$('#feelsLike').textContent.replace('°', ' degrees')}. ${$('#windSpeed').textContent.replace('km/h', 'kilometers per hour')}.`
        : weatherStatus === 'LOADING'
          ? 'The weather report is still loading. Ask again in a moment.'
          : 'Weather is unavailable offline. The clock and schedule are still available.';
      showCommandResponse(response);
      return;
    }
    const requestedTime = parseRequestedTime(words);
    const asksAboutTimeSlot = requestedTime && /\b(?:what|anything|any|have|free|busy|available|happening)\b/.test(words);
    if (words.includes('schedule') || words.includes('agenda') || words.includes('calendar') || asksAboutTimeSlot) {
      $('#schedulePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#schedulePanel').classList.remove('command-highlight');
      requestAnimationFrame(() => $('#schedulePanel').classList.add('command-highlight'));
      if (requestedTime) {
        const matches = schedule
          .filter((item) => {
            const [hour, minute] = item.time.split(':').map(Number);
            return hour === requestedTime.hour && (requestedTime.minute === null || minute === requestedTime.minute);
          })
          .sort((a, b) => a.time.localeCompare(b.time));
        const response = matches.length
          ? `At ${requestedTime.label}, ${matches.map((item) => `${item.sample ? 'SAMPLE ' : ''}${item.kind.toUpperCase()}: ${item.title} at ${formatTime(item.time)}${item.done ? ' (done)' : ''}`).join('; ')}.`
          : `Nothing is scheduled for ${requestedTime.label}.`;
        const speechResponse = matches.length
          ? `You have ${matches.map((item) => `${item.sample ? 'a sample ' : 'a '}${item.kind} at ${formatTime(item.time)}: ${item.title}${item.done ? ', already completed' : ''}`).join('; and ')}.`
          : `You don't have anything scheduled at ${requestedTime.label}.`;
        showCommandResponse(response, speechResponse);
      } else {
        const upcoming = schedule.filter((item) => !item.done).sort((a, b) => a.time.localeCompare(b.time));
        const response = upcoming.length
          ? `You have ${upcoming.length} remaining item${upcoming.length === 1 ? '' : 's'}. Next: ${upcoming[0].title} at ${formatTime(upcoming[0].time)}.`
          : 'You have no remaining items on today’s schedule.';
        showCommandResponse(response);
      }
      return;
    }
    if (words.includes('privacy') || words.includes('hide') || words.includes('private')) {
      if (privacyButton.getAttribute('aria-pressed') !== 'true') privacyButton.click();
      showToast('Privacy mode is on.');
      return;
    }
    showToast('Try “what’s at 9 pm?”, “add a reminder at 6 pm to review the demo”, or “show weather”.');
  }

  function updateFullscreenControl() {
    const active = Boolean(document.fullscreenElement);
    fullscreenToggle.hidden = !document.fullscreenEnabled || typeof document.documentElement.requestFullscreen !== 'function';
    fullscreenToggle.setAttribute('aria-pressed', String(active));
    fullscreenLabel.textContent = active ? 'Exit full screen' : 'Full screen';
    fullscreenToggle.title = active ? 'Exit full screen' : 'Enter full screen';
  }

  fullscreenToggle.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) {
      showToast('Use F11 to enter full screen in this browser.');
    }
  });
  document.addEventListener('fullscreenchange', updateFullscreenControl);
  updateFullscreenControl();

  showCommandFallbackButton.addEventListener('click', () => {
    if (activeRecognition) {
      activeRecognition.abort();
      activeRecognition = null;
      voiceButton.classList.remove('listening');
    }
    commandFallback.hidden = false;
    commandFallbackLabel.textContent = 'Type a schedule question or reminder below.';
    voiceStatus.textContent = speechOutputAvailable ? 'Type a command below' : 'Text reply here; use Chrome/Edge for audio';
    commandInput.focus();
  });

  voiceButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (activeRecognition) {
      activeRecognition.abort();
      activeRecognition = null;
      voiceButton.classList.remove('listening');
      voiceStatus.textContent = 'Voice command stopped';
      showToast('Stopped listening.');
      return;
    }
    if (!SpeechRecognition) {
      voiceStatus.textContent = speechOutputAvailable ? 'Type a command below' : 'Text reply here; use Chrome/Edge for audio';
      commandFallbackLabel.textContent = 'Voice input is unavailable here. Type a command instead.';
      commandFallback.hidden = false;
      commandInput.focus();
      $('#schedulePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#schedulePanel').classList.remove('command-highlight');
      requestAnimationFrame(() => $('#schedulePanel').classList.add('command-highlight'));
      showToast('Voice input is unavailable here. Type your command instead.');
      return;
    }
    const recognition = new SpeechRecognition();
    activeRecognition = recognition;
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      voiceButton.classList.add('listening');
      voiceStatus.textContent = 'Listening… say “what’s at 9 pm?”';
      commandFallback.hidden = true;
    };
    recognition.onresult = (event) => runVoiceCommand(event.results[0][0].transcript);
    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access unavailable — type instead'
        : event.error === 'network'
          ? 'Voice service unavailable — type instead'
          : 'Could not hear that. Try again or type below.';
      voiceStatus.textContent = message;
      commandFallbackLabel.textContent = message;
      commandFallback.hidden = false;
      commandInput.focus();
      showToast(`${message}. Your command is available below.`);
    };
    recognition.onend = () => {
      if (activeRecognition === recognition) activeRecognition = null;
      voiceButton.classList.remove('listening');
      setTimeout(() => { if (!activeRecognition && commandFallback.hidden) voiceStatus.textContent = 'Say “remind me at 6 pm to review the demo”'; }, 3500);
    };
    try { recognition.start(); } catch (_) {
      voiceStatus.textContent = 'Voice input is already active';
      commandFallbackLabel.textContent = 'Voice input is active. Type a command below if needed.';
      commandFallback.hidden = false;
      showToast('Voice input is already active.');
    }
  });

  commandForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = commandInput.value.trim();
    if (!command) return;
    runVoiceCommand(command);
  });

  renderClock();
  renderSchedule();
  updateConnection();
  loadWeather();
  setInterval(renderClock, 1000);
})();
