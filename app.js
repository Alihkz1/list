(() => {
  'use strict';

  const STORAGE_KEY = 'my-rtl-list:v2';
  const LEGACY_KEY = 'my-rtl-list:v1';
  const $ = (id) => document.getElementById(id);
  const views = new Map();
  const number = (value) => new Intl.NumberFormat('fa-IR').format(value);
  const newId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function emptyState() { return { version: 2, savedAt: 0, lists: [
    { id: 'list-1', title: '\u0641\u0647\u0631\u0633\u062a \u0627\u0648\u0644', items: [] },
    { id: 'list-2', title: '\u0641\u0647\u0631\u0633\u062a \u062f\u0648\u0645', items: [] },
    { id: 'list-3', title: 'فهرست سوم', items: [] },
    { id: 'list-4', title: 'فهرست چهارم', items: [] },
  ] }; }
  let state = emptyState();
  let fileGeneration = 0;
  let browserSaved = true;
  let fileHandle = null;
  let filePermission = false;
  let fileSaved = false;
  let writeQueue = Promise.resolve();
  let toastTimer;
  let undoAction;
  let drag = null;
  let scrollFrame;

  function readDocument(text) {
    const value = JSON.parse(text);
    if (!value || ![1, 2].includes(value.version)) throw new Error('Invalid list file');
    const defaults = emptyState().lists;
    const groups = value.version === 1 && Array.isArray(value.items)
      ? [{ title: defaults[0].title, items: value.items }]
      : value.lists;
    if (!Array.isArray(groups) || !(groups.length === 2 || groups.length === 4 || (value.version === 1 && groups.length === 1))) throw new Error('Invalid lists');
    const seen = new Set();
    const lists = defaults.map((fallback, index) => {
      const group = groups[index] || fallback;
      if (!group || !Array.isArray(group.items)) throw new Error('Invalid list');
      return {
        id: 'list-' + (index + 1),
        title: typeof group.title === 'string' ? group.title.slice(0, 80) : fallback.title,
        items: group.items.map((item) => {
          if (!item || typeof item.text !== 'string' || !item.text.trim()) throw new Error('Invalid item');
          const id = typeof item.id === 'string' && item.id && !seen.has(item.id) ? item.id : newId();
          seen.add(id);
          return { id, text: item.text.trim().slice(0, 500), createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString() };
        }),
      };
    });
    return { version: 2, savedAt: Number.isFinite(value.savedAt) ? value.savedAt : 0, lists };
  }

  function toast(message, action) {
    clearTimeout(toastTimer);
    $('toast-message').textContent = message;
    undoAction = action;
    $('undo').hidden = !action;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; undoAction = null; }, action ? 10000 : 6500);
  }

  function updateStatus() {
    const warning = !browserSaved || (fileHandle && !fileSaved);
    $('save-dot').classList.toggle('is-warning', !!warning);
    $('save-status').textContent = fileHandle && fileSaved
      ? browserSaved ? `ذخیره‌شده در مرورگر و ${fileHandle.name}` : `ذخیره‌شده در فایل ${fileHandle.name}`
      : fileHandle && !filePermission
        ? 'ذخیره در مرورگر؛ برای فعال‌سازی فایل، دوباره اجازه دسترسی بدهید'
        : browserSaved ? 'تغییرات خودکار در این مرورگر ذخیره می‌شوند' : 'ذخیره در مرورگر ممکن نیست؛ از فهرست خروجی بگیرید';
    $('connect-file').textContent = fileHandle && !filePermission ? 'فعال‌سازی فایل TXT' : fileHandle ? 'تغییر فایل TXT' : 'اتصال فایل TXT';
  }

  function saveBrowser() {
    const previouslySaved = browserSaved;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); browserSaved = true; }
    catch {
      browserSaved = false;
      if (previouslySaved) toast('تغییرات در حافظه مرورگر ذخیره نشدند. پیش از بستن صفحه، از داده‌ها نسخه پشتیبان تهیه کنید.');
    }
    updateStatus();
  }

  function saveFile() {
    if (!fileHandle || !filePermission) return;
    const handle = fileHandle;
    const snapshot = JSON.stringify(state, null, 2);
    fileSaved = false;
    updateStatus();
    writeQueue = writeQueue.then(async () => {
      const writer = await handle.createWritable();
      try { await writer.write(snapshot); await writer.close(); }
      catch (error) { await writer.abort().catch(() => {}); throw error; }
      if (handle === fileHandle) fileSaved = true;
      updateStatus();
    }).catch(() => {
      if (handle === fileHandle) {
        fileSaved = false; filePermission = false; fileHandle = null;
        void rememberHandle(null);
      }
      updateStatus();
      toast(browserSaved ? 'فایل ذخیره نشد؛ موارد در مرورگر باقی مانده‌اند. فایل را دوباره متصل کنید.' : 'ذخیره انجام نشد؛ پیش از بستن صفحه، خروجی TXT بگیرید.');
    });
  }

  function commit(focusId) {
    state.savedAt = Date.now();
    saveBrowser();
    saveFile();
    render(focusId);
  }

  function createView(group) {
    const card = $('list-template').content.firstElementChild.cloneNode(true);
    card.dataset.listId = group.id;
    const title = card.querySelector('.list-title');
    const input = card.querySelector('.item-input');
    const list = card.querySelector('.items');
    const scrollBox = card.querySelector('.list-scroll');
    title.addEventListener('input', () => {
      const model = state.lists.find((entry) => entry.id === group.id);
      model.title = title.value.slice(0, 80);
      state.savedAt = Date.now();
      saveBrowser();
    });
    title.addEventListener('change', saveFile);
    card.querySelector('.add-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      const model = state.lists.find((entry) => entry.id === group.id);
      model.items.push({ id: newId(), text: text.slice(0, 500), createdAt: new Date().toISOString() });
      commit(); input.value = ''; input.focus(); scrollBox.scrollTop = scrollBox.scrollHeight;
    });
    $('lists').append(card);
    const view = { card, title, input, list, scrollBox };
    views.set(group.id, view);
    return view;
  }

  function render(focusId) {
    for (const group of state.lists) {
      const { title, input, list } = views.get(group.id) || createView(group);
      if (document.activeElement !== title) title.value = group.title;
      const fragment = document.createDocumentFragment();
      group.items.forEach((item) => {
        const row = $('item-template').content.firstElementChild.cloneNode(true);
        row.dataset.id = item.id;
        row.querySelector('.item-text').textContent = item.text;
        const handle = row.querySelector('.drag-handle');
        handle.setAttribute('aria-label', `جابه‌جایی «${item.text}»؛ با کلیدهای بالا و پایین`);
        handle.addEventListener('pointerdown', (event) => beginDrag(event, row, group.id));
        handle.addEventListener('keydown', (event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const oldIndex = group.items.findIndex((entry) => entry.id === item.id);
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? group.items.length - 1 : oldIndex + (event.key === 'ArrowUp' ? -1 : 1);
          if (nextIndex < 0 || nextIndex >= group.items.length || nextIndex === oldIndex) return;
          group.items.splice(oldIndex, 1);
          group.items.splice(nextIndex, 0, item);
          commit(item.id);
          $('announcement').textContent = `مورد به جایگاه ${number(nextIndex + 1)} منتقل شد.`;
        });
        const remove = row.querySelector('.delete-button');
        remove.setAttribute('aria-label', `حذف «${item.text}»`);
        remove.addEventListener('click', () => {
          const position = group.items.findIndex((entry) => entry.id === item.id);
          group.items.splice(position, 1);
          commit();
          input.focus();
          toast('مورد از فهرست حذف شد.', () => {
            group.items.splice(Math.min(position, group.items.length), 0, item);
            commit(item.id);
            toast('مورد به فهرست برگشت.');
          });
        });
        fragment.append(row);
      });

      list.replaceChildren(fragment);
      if (focusId) [...list.children].find((row) => row.dataset.id === focusId)?.querySelector('.drag-handle').focus({ preventScroll: true });
    }
  }

  function beginDrag(event, row, listId) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const rect = row.getBoundingClientRect();
    drag = { row, listId, list: views.get(listId).list, scrollBox: views.get(listId).scrollBox, handle: event.currentTarget, pointer: event.pointerId, startY: event.clientY, y: event.clientY, offsetY: event.clientY - rect.top, rect, ghost: null };
    drag.handle.setPointerCapture(event.pointerId);
  }

  function movePlaceholder() {
    if (!drag?.ghost) return;
    const list = drag.list;
    const before = [...list.children].find((row) => row !== drag.row && drag.y < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    list.insertBefore(drag.row, before || null);
  }

  function autoScroll() {
    if (!drag?.ghost) return;
    const scrollBox = drag.scrollBox;
    const rect = scrollBox.getBoundingClientRect();
    const speed = drag.y < rect.top + 45 ? -10 : drag.y > rect.bottom - 45 ? 10 : 0;
    if (speed) { scrollBox.scrollTop += speed; movePlaceholder(); }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  document.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.y = event.clientY;
    if (!drag.ghost && Math.abs(drag.y - drag.startY) < 5) return;
    event.preventDefault();
    if (!drag.ghost) {
      drag.ghost = drag.row.cloneNode(true);
      drag.ghost.classList.add('drag-ghost');
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.querySelectorAll('button').forEach((button) => button.tabIndex = -1);
      Object.assign(drag.ghost.style, { width: `${drag.rect.width}px`, left: `${drag.rect.left}px` });
      document.body.append(drag.ghost);
      drag.row.classList.add('is-dragging');
      document.body.classList.add('dragging');
      autoScroll();
    }
    drag.ghost.style.top = `${drag.y - drag.offsetY}px`;
    movePlaceholder();
  }, { passive: false });

  function endDrag(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointer) return;
    const active = drag;
    drag = null;
    cancelAnimationFrame(scrollFrame);
    if (active.handle.hasPointerCapture(active.pointer)) active.handle.releasePointerCapture(active.pointer);
    active.ghost?.remove();
    active.row.classList.remove('is-dragging');
    document.body.classList.remove('dragging');
    if (!active.ghost) return;
    if (!cancelled) {
      const group = state.lists.find((entry) => entry.id === active.listId);
      const byId = new Map(group.items.map((item) => [item.id, item]));
      group.items = [...active.list.children].map((row) => byId.get(row.dataset.id));
      commit(active.row.dataset.id);
      $('announcement').textContent = 'ترتیب فهرست ذخیره شد.';
    } else render(active.row.dataset.id);
  }
  document.addEventListener('pointerup', (event) => endDrag(event));
  document.addEventListener('pointercancel', (event) => endDrag(event, true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) endDrag({ pointerId: drag.pointer }, true);
  });

  $('toast-close').addEventListener('click', () => { clearTimeout(toastTimer); $('toast').hidden = true; undoAction = null; });
  $('undo').addEventListener('click', () => { const action = undoAction; undoAction = null; action?.(); });

  $('delete-all').addEventListener('click', async () => {
    if (!confirm('همه موارد و عنوان هر چهار فهرست از حافظه این برنامه حذف شوند؟ این کار قابل بازگشت نیست.')) return;
    const app = document.querySelector('.app');
    app.inert = true;
    try {
      // Invalidate any file restore still in progress so it cannot bring deleted data back.
      fileGeneration++;
      fileHandle = null;
      filePermission = false;
      fileSaved = false;
      await writeQueue;
      await rememberHandle(null);
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('my-rtl-list:')) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
      if (drag) endDrag({ pointerId: drag.pointer }, true);
      clearTimeout(toastTimer);
      undoAction = null;
      state = emptyState();
      browserSaved = true;
      for (const view of views.values()) view.input.value = '';
      render();
      updateStatus();
      toast('همه موارد، عنوان‌ها و اطلاعات ذخیره‌شده این برنامه پاک شدند.');
    } catch {
      toast('پاک کردن حافظه مرورگر انجام نشد. تنظیمات دسترسی مرورگر را بررسی کنید.');
    } finally { app.inert = false; }
  });

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'list-data.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('نسخه پشتیبان TXT آماده دانلود است.');
  }
  $('export-file').addEventListener('click', download);
  $('import-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const restored = readDocument(await file.text());
      if (state.lists.some((group) => group.items.length) && !confirm('موارد فعلی با محتوای فایل جایگزین شوند؟')) return;
      state = restored;
      commit();
      toast(`${number(state.lists.reduce((total, group) => total + group.items.length, 0))} مورد بازیابی شد.`);
    } catch { toast('فایل معتبر نیست. فایل TXT خروجی همین برنامه را انتخاب کنید.'); }
    finally { event.target.value = ''; }
  });

  async function handleDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('my-rtl-list-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function rememberHandle(handle) {
    try {
      const db = await handleDatabase();
      try {
        await new Promise((resolve, reject) => {
          const transaction = db.transaction('settings', 'readwrite');
          transaction.objectStore('settings').put(handle, 'file');
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
      } finally { db.close(); }
    } catch { /* Browser storage and manual backups still work without handle storage. */ }
  }

  $('connect-file').addEventListener('click', async () => {
    const button = $('connect-file');
    try {
      if (fileHandle && !filePermission) {
        filePermission = await fileHandle.requestPermission({ mode: 'readwrite' }) === 'granted';
        if (!filePermission) { updateStatus(); return; }
      } else if (window.showSaveFilePicker) {
        fileHandle = await window.showSaveFilePicker({ suggestedName: 'list-data.txt', types: [{ description: 'List backup', accept: { 'text/plain': ['.txt'] } }] });
        filePermission = true;
        await rememberHandle(fileHandle);
      } else {
        toast('این مرورگر اتصال خودکار فایل را پشتیبانی نمی‌کند. خروجی TXT بگیرید.');
        return;
      }
      button.disabled = true;
      saveFile();
      await writeQueue;
      if (fileSaved) toast('فایل متصل شد؛ تغییرات بعدی خودکار در فایل هم ذخیره می‌شوند.');
    } catch (error) {
      if (error.name !== 'AbortError') toast('اتصال فایل انجام نشد. از خروجی TXT استفاده کنید.');
    } finally { button.disabled = false; updateStatus(); }
  });

  async function restoreFileConnection() {
    const generation = fileGeneration;
    try {
      const db = await handleDatabase();
      try {
        const storedHandle = await new Promise((resolve, reject) => {
          const request = db.transaction('settings').objectStore('settings').get('file');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
        });
        if (generation !== fileGeneration) return;
        fileHandle = storedHandle;
      } finally { db.close(); }
      if (!fileHandle) return;
      const allowed = await fileHandle.queryPermission({ mode: 'readwrite' }) === 'granted';
      if (generation !== fileGeneration) return;
      filePermission = allowed;
      if (!filePermission) return;
      const file = await fileHandle.getFile();
      if (generation !== fileGeneration) return;
      if (file.size) {
        const saved = readDocument(await file.text());
        if (generation !== fileGeneration) return;
        if (saved.savedAt > state.savedAt) { state = saved; saveBrowser(); render(); }
      }
      saveFile();
    } catch { filePermission = false; }
    finally { updateStatus(); }
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
    if (saved) { state = readDocument(saved); saveBrowser(); }
  } catch { browserSaved = false; toast('ذخیره مرورگر در دسترس نیست یا داده معتبر نیست. برای نگهداری مطمئن، خروجی TXT بگیرید.'); }
  render();
  updateStatus();
  void restoreFileConnection();
})();
