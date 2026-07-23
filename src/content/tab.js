// Injects the "Docs" tab into GitHub's repository UnderlineNav.

const BOOK_ICON =
  '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" class="octicon UnderlineNav-octicon d-none d-sm-inline">' +
  '<path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z"></path></svg>';

export function findRepoNav() {
  return document.querySelector('nav[aria-label="Repository"] ul');
}

export function ensureTab({ owner, repo, count, showBadge }) {
  const ul = findRepoNav();
  if (!ul) return null;
  let li = ul.querySelector('li[data-gdt-tab]');
  if (!li) {
    li = document.createElement('li');
    li.setAttribute('data-gdt-tab', '');
    li.className = 'd-inline-flex';
    const a = document.createElement('a');
    a.className = 'UnderlineNav-item no-wrap gdt-tab';
    a.setAttribute('data-gdt-tab-link', '');
    a.innerHTML = `${BOOK_ICON}<span data-content="Docs">Docs</span> <span class="Counter" data-gdt-count hidden></span>`;
    li.appendChild(a);
    ul.appendChild(li);
  }
  const a = li.querySelector('a[data-gdt-tab-link]');
  a.setAttribute('href', `/${owner}/${repo}#docs`);
  const counter = li.querySelector('[data-gdt-count]');
  if (counter) {
    if (showBadge && count > 0) {
      counter.textContent = String(count);
      counter.hidden = false;
    } else {
      counter.hidden = true;
    }
  }
  return li;
}

export function tabConnected() {
  const li = document.querySelector('li[data-gdt-tab]');
  return !!(li && li.isConnected);
}

export function removeTab() {
  document.querySelector('li[data-gdt-tab]')?.remove();
}

let demoted = null;

export function setTabActive(active) {
  const ul = findRepoNav();
  const ours = ul && ul.querySelector('a[data-gdt-tab-link]');
  if (!ours) return;
  if (active) {
    const cur = ul.querySelector('a[aria-current]:not([data-gdt-tab-link])');
    if (cur) {
      demoted = cur;
      cur.removeAttribute('aria-current');
    }
    ours.setAttribute('aria-current', 'page');
  } else {
    ours.removeAttribute('aria-current');
    if (demoted && demoted.isConnected && !ul.querySelector('a[aria-current]')) {
      demoted.setAttribute('aria-current', 'page');
    }
    demoted = null;
  }
}
