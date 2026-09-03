/* Keeps the accountant's copy current without anyone emailing a RAR around.

   The app checks GitHub Releases on startup, downloads a newer setup silently
   and installs it when the app is next closed. Everything reports back to the
   renderer over the 'update:status' channel so the UI can show progress.

   Nothing here is fatal: a laptop with no internet, a blocked corporate proxy
   or a rate-limited GitHub all end in a logged warning, never a crash or a
   dialog the accountant has to dismiss before invoicing. */
const { autoUpdater } = require('electron-updater');

let target = null;      /* the window we report to */
let manual = false;     /* true when the user pressed "Check for updates" */

function send(status) {
  if (target && !target.isDestroyed()) target.webContents.send('update:status', status);
}

function initUpdates(win) {
  target = win;

  autoUpdater.autoDownload = true;
  /* Install on quit rather than interrupting a half-typed invoice. */
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));

  autoUpdater.on('update-available', (info) => {
    send({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    /* Only worth a message when someone actually asked. */
    send({ state: 'none', silent: !manual });
    manual = false;
  });

  autoUpdater.on('download-progress', (p) => {
    send({ state: 'downloading', percent: Math.round(p.percent || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send({ state: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    /* An unsigned build, no network, or no release published yet all land
       here. Say so quietly and carry on — the app itself is unaffected. */
    send({ state: 'error', message: String((err && err.message) || err), silent: !manual });
    manual = false;
  });
}

function checkForUpdates(fromUser) {
  manual = !!fromUser;
  try {
    /* checkForUpdates rejects rather than emitting 'error' in some failure
       modes, so both paths have to be swallowed. */
    const p = autoUpdater.checkForUpdates();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        send({ state: 'error', message: String((err && err.message) || err), silent: !manual });
        manual = false;
      });
    }
  } catch (err) {
    send({ state: 'error', message: String(err.message || err), silent: !manual });
    manual = false;
  }
  return { ok: true };
}

/* Called when the user clicks "Restart and install" on a downloaded update. */
function quitAndInstall() {
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    send({ state: 'error', message: String(err.message || err) });
  }
}

module.exports = { initUpdates, checkForUpdates, quitAndInstall };
