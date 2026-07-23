import { ext } from '../common/browser.js';
import { loadSettings } from '../common/settings.js';
import { clearTreeCaches } from '../content/github-api.js';

async function init() {
  const dot = document.getElementById('token-dot');
  const text = document.getElementById('token-text');
  try {
    const s = await loadSettings();
    if (s.token) {
      dot.classList.add('ok');
      text.textContent = 'Token configured — 5,000 requests/hour, private repos supported.';
    } else {
      dot.classList.add('warn');
      text.textContent = 'No token — anonymous access (60 requests/hour, public repos only).';
    }
  } catch {
    text.textContent = 'Could not read settings.';
  }

  document.getElementById('open-options').addEventListener('click', () => {
    ext.runtime.openOptionsPage();
  });

  document.getElementById('clear-cache').addEventListener('click', async () => {
    const n = await clearTreeCaches();
    const status = document.getElementById('status');
    status.textContent = `Cleared ${n} cached repo listing${n === 1 ? '' : 's'}.`;
    status.hidden = false;
  });
}

init();
