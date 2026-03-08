// Main application entry point
import type { Issue, PhotoRef, Room, Assignee, IssueType } from './types.ts';
import {
  getRooms,
  getLastRoomSlug,
  setLastRoomSlug,
  getAllIssues,
  getIssue,
  saveIssue,
  deleteIssue,
  savePhoto,
  getPhotosByIssue,
  deletePhoto,
  getAssignees,
  saveAssignees,
  saveRooms,
  clearAllData,
} from './db.ts';
import { generateId, processPhoto } from './photos.ts';
import { exportPDF } from './pdf.ts';
import { exportZip, importZip, shareZip } from './zip.ts';
import type { ImportMode } from './zip.ts';

// --- State ---
let rooms: Room[] = [];
let assignees: Assignee[] = [];
let issues: Issue[] = [];
let currentView: 'add' | 'list' = 'add';
let statusFilter: 'all' | 'open' | 'done' = 'all';
let roomFilter: string = 'all'; // 'all' or room slug
let assigneeFilter: string = 'all'; // 'all', '' (unassigned), or assignee slug

// Pending photos for the add form (before saving)
interface PendingPhoto {
  id: string;
  blob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  mimeType: string;
  objectUrl: string;
}
let pendingPhotos: PendingPhoto[] = [];

const app = document.getElementById('app')!;

// --- Auto-numbering ---
function computeIssueCode(roomSlug: string): string {
  const room = rooms.find((r) => r.slug === roomSlug);
  const letter = room?.letter || '?';
  let maxNum = 0;
  for (const issue of issues) {
    if (issue.roomSlug === roomSlug && issue.code) {
      const match = issue.code.match(/^[A-Z?](\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }
  return `${letter}${maxNum + 1}`;
}

// --- Initialization ---
async function init(): Promise<void> {
  rooms = getRooms();
  assignees = getAssignees();
  issues = await getAllIssues();
  updateIssueCount();

  // Navigation
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = (tab as HTMLElement).dataset.view as 'add' | 'list';
      switchView(view);
    });
  });

  // Export buttons
  document.getElementById('btn-export-pdf')!.addEventListener('click', handleExportPDF);
  document.getElementById('btn-export-zip')!.addEventListener('click', handleExportZip);

  // Import button
  document.getElementById('btn-import-zip')!.addEventListener('click', handleImportZipClick);
  document.getElementById('import-zip-input')!.addEventListener('change', handleImportZipFile);

  // Settings button
  document.getElementById('btn-settings')!.addEventListener('click', showSettingsModal);

  // Photo input (add form)
  document.getElementById('photo-input')!.addEventListener('change', handlePhotoInput);
  document.getElementById('photo-input-camera')!.addEventListener('change', handlePhotoInput);
  // Photo input (edit form)
  document.getElementById('edit-photo-input')!.addEventListener('change', handleEditPhotoInput);
  document.getElementById('edit-photo-input-camera')!.addEventListener('change', handleEditPhotoInput);

  // Paste functionality for images
  document.addEventListener('paste', handlePaste);

  // Register service worker for PWA support
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/Pasfini/sw.js', { scope: '/Pasfini/' });
      console.log('Service Worker registered successfully');
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  }

  // Render initial view
  renderCurrentView();
}

function switchView(view: 'add' | 'list'): void {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', (tab as HTMLElement).dataset.view === view);
  });
  renderCurrentView();
}

async function renderCurrentView(): Promise<void> {
  if (currentView === 'add') {
    renderAddView();
  } else {
    issues = await getAllIssues();
    updateIssueCount();
    renderListView();
  }
}

function updateIssueCount(): void {
  const badge = document.getElementById('issue-count');
  if (badge) badge.textContent = String(issues.length);
}

function showToast(message: string): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function typeBadgeHtml(type: IssueType | undefined): string {
  return type === 'todo'
    ? '<span class="badge" style="background: var(--blue-100); color: var(--blue-700);">To-do</span>'
    : '<span class="badge" style="background: var(--yellow-100); color: #92400e;">Réserve</span>';
}

// --- Add View ---
function renderAddView(): void {
  const lastSlug = getLastRoomSlug();
  const validSlug = rooms.find((r) => r.slug === lastSlug) ? lastSlug : rooms[0]?.slug || '';

  app.innerHTML = `
    <form id="add-form">
      <div class="form-group">
        <label class="form-label" for="add-room">Pièce</label>
        <select class="form-select" id="add-room" required>
          ${rooms.map((r) => `<option value="${escapeHtml(r.slug)}" ${r.slug === validSlug ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="add-assignee">Assigné à</label>
        <select class="form-select" id="add-assignee">
          <option value="">— Non assigné —</option>
          ${assignees.map((a) => `<option value="${escapeHtml(a.slug)}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="add-type">Type</label>
        <select class="form-select" id="add-type">
          <option value="reserve" selected>Réserve</option>
          <option value="todo">To-do</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="add-title">Titre</label>
        <input class="form-input" id="add-title" type="text" placeholder="Ex : Plinthe à recoller" required maxlength="200" />
      </div>

      <div class="form-group">
        <label class="form-label" for="add-desc">Description (optionnelle)</label>
        <textarea class="form-textarea" id="add-desc" placeholder="Détails supplémentaires..." maxlength="1000"></textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Photos</label>
        <div class="photo-grid" id="add-photos">
          <div class="photo-add-btn" id="add-photo-btn-camera">
            <span>📷</span>
            <span class="photo-add-label">Caméra</span>
          </div>
          <div class="photo-add-btn" id="add-photo-btn">
            <span>🖼️</span>
            <span class="photo-add-label">Galerie</span>
          </div>
        </div>
      </div>

      <button type="submit" class="btn btn-primary" style="width:100%; padding: 0.75rem;">
        ✅ Enregistrer
      </button>
    </form>
  `;

  document.getElementById('add-form')!.addEventListener('submit', handleAddSubmit);
  document.getElementById('add-photo-btn')!.addEventListener('click', () => {
    document.getElementById('photo-input')!.click();
  });
  document.getElementById('add-photo-btn-camera')!.addEventListener('click', () => {
    document.getElementById('photo-input-camera')!.click();
  });

  renderPendingPhotos();
}

function renderPendingPhotos(): void {
  const container = document.getElementById('add-photos');
  if (!container) return;

  // Remove existing photo items (keep add button)
  container.querySelectorAll('.photo-grid-item').forEach((el) => el.remove());

  const addBtn = document.getElementById('add-photo-btn-camera')!;
  for (const photo of pendingPhotos) {
    const item = document.createElement('div');
    item.className = 'photo-grid-item';
    item.innerHTML = `
      <img src="${photo.objectUrl}" alt="Photo" />
      <button type="button" class="photo-remove" data-id="${escapeHtml(photo.id)}">✕</button>
    `;
    container.insertBefore(item, addBtn);
  }

  // Bind remove buttons
  container.querySelectorAll('.photo-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id!;
      const idx = pendingPhotos.findIndex((p) => p.id === id);
      if (idx !== -1) {
        URL.revokeObjectURL(pendingPhotos[idx].objectUrl);
        pendingPhotos.splice(idx, 1);
        renderPendingPhotos();
      }
    });
  });
}

async function handlePhotoInput(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  for (const file of Array.from(files)) {
    try {
      const processed = await processPhoto(file);
      const photo: PendingPhoto = {
        id: generateId(),
        blob: processed.blob,
        thumbnailBlob: processed.thumbnailBlob,
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
        objectUrl: URL.createObjectURL(processed.thumbnailBlob),
      };
      pendingPhotos.push(photo);
    } catch (err) {
      console.error('Failed to process photo:', err);
    }
  }

  input.value = '';
  renderPendingPhotos();
}

async function handlePaste(e: ClipboardEvent): Promise<void> {
  const items = e.clipboardData?.items;
  if (!items) return;

  // Check if we're in add or edit view
  const isAddView = currentView === 'add';
  const isEditView = document.getElementById('edit-modal') !== null;
  
  if (!isAddView && !isEditView) return;

  // Process pasted images
  let pastedCount = 0;
  let hasError = false;

  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (!file) continue;

      try {
        const processed = await processPhoto(file);
        const photo: PendingPhoto = {
          id: generateId(),
          blob: processed.blob,
          thumbnailBlob: processed.thumbnailBlob,
          width: processed.width,
          height: processed.height,
          mimeType: processed.mimeType,
          objectUrl: URL.createObjectURL(processed.thumbnailBlob),
        };

        if (isEditView) {
          editPendingPhotos.push(photo);
          renderEditPhotos(existingPhotosRef);
        } else {
          pendingPhotos.push(photo);
          renderPendingPhotos();
        }
        
        pastedCount++;
      } catch (err) {
        console.error('Failed to process pasted image:', err);
        hasError = true;
      }
    }
  }

  // Show toast notification once for all pasted images
  if (pastedCount > 0) {
    const message = pastedCount === 1 ? '📋 Image collée !' : `📋 ${pastedCount} images collées !`;
    showToast(message);
  } else if (hasError) {
    showToast('❌ Erreur lors du collage');
  }
}

async function handleAddSubmit(e: Event): Promise<void> {
  e.preventDefault();
  const roomSlug = (document.getElementById('add-room') as HTMLSelectElement).value;
  const assigneeSlug = (document.getElementById('add-assignee') as HTMLSelectElement).value || undefined;
  const issueType = (document.getElementById('add-type') as HTMLSelectElement).value as IssueType;
  const title = (document.getElementById('add-title') as HTMLInputElement).value.trim();
  const description = (document.getElementById('add-desc') as HTMLTextAreaElement).value.trim();

  if (!title) return;

  const now = Date.now();
  const issueId = generateId();

  // Save photos to IndexedDB
  const photoIds: string[] = [];
  for (const pending of pendingPhotos) {
    const photoRef = {
      id: pending.id,
      issueId,
      mimeType: pending.mimeType,
      width: pending.width,
      height: pending.height,
      createdAt: now,
      blob: pending.blob,
      thumbnailBlob: pending.thumbnailBlob,
    };
    await savePhoto(photoRef);
    photoIds.push(pending.id);
    URL.revokeObjectURL(pending.objectUrl);
  }

  const issue: Issue = {
    id: issueId,
    code: computeIssueCode(roomSlug),
    roomSlug,
    assigneeSlug,
    type: issueType,
    title,
    description,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    photos: photoIds,
  };

  await saveIssue(issue);
  issues.push(issue);
  setLastRoomSlug(roomSlug);
  updateIssueCount();

  // Reset form
  pendingPhotos = [];
  showToast('✅ Réserve ajoutée');
  renderAddView();
  // Focus title for next rapid entry
  setTimeout(() => {
    (document.getElementById('add-title') as HTMLInputElement)?.focus();
  }, 100);
}

// --- Filtering ---
function hasActiveFilters(): boolean {
  return statusFilter !== 'all' || roomFilter !== 'all' || assigneeFilter !== 'all';
}

function getFilteredIssues(): Issue[] {
  let filtered = issues;
  if (statusFilter !== 'all') {
    filtered = filtered.filter((i) => i.status === statusFilter);
  }
  if (roomFilter !== 'all') {
    filtered = filtered.filter((i) => i.roomSlug === roomFilter);
  }
  if (assigneeFilter !== 'all') {
    if (assigneeFilter === '') {
      filtered = filtered.filter((i) => !i.assigneeSlug);
    } else {
      filtered = filtered.filter((i) => i.assigneeSlug === assigneeFilter);
    }
  }
  return filtered;
}

// --- List View ---
function renderListView(): void {
  // Apply status, room, and assignee filters
  const filtered = getFilteredIssues();

  // Calculate counts in a single pass
  let openCount = 0;
  let doneCount = 0;
  const roomCounts = new Map<string, number>();
  const assigneeCounts = new Map<string, number>();
  let unassignedCount = 0;
  
  for (const issue of issues) {
    if (issue.status === 'open') openCount++;
    else if (issue.status === 'done') doneCount++;
    
    const count = roomCounts.get(issue.roomSlug) || 0;
    roomCounts.set(issue.roomSlug, count + 1);

    if (issue.assigneeSlug) {
      const ac = assigneeCounts.get(issue.assigneeSlug) || 0;
      assigneeCounts.set(issue.assigneeSlug, ac + 1);
    } else {
      unassignedCount++;
    }
  }

  const assigneeMap = new Map(assignees.map((a) => [a.slug, a.name]));

  let html = `
    <div class="filter-bar">
      <button class="filter-chip ${statusFilter === 'all' ? 'active' : ''}" data-filter="all">Tout (${issues.length})</button>
      <button class="filter-chip ${statusFilter === 'open' ? 'active' : ''}" data-filter="open">Ouvert (${openCount})</button>
      <button class="filter-chip ${statusFilter === 'done' ? 'active' : ''}" data-filter="done">Terminé (${doneCount})</button>
    </div>
    <div class="filter-bar">
      <button class="filter-chip ${roomFilter === 'all' ? 'active' : ''}" data-room-filter="all">Toutes les pièces</button>
  `;
  
  // Add room filter chips
  for (const room of rooms) {
    const roomIssueCount = roomCounts.get(room.slug) || 0;
    if (roomIssueCount > 0) {
      html += `<button class="filter-chip ${roomFilter === room.slug ? 'active' : ''}" data-room-filter="${escapeHtml(room.slug)}">${escapeHtml(room.name)} (${roomIssueCount})</button>`;
    }
  }
  
  html += `</div>`;

  // Add assignee filter chips (only if there are assignees configured)
  if (assignees.length > 0) {
    html += `
      <div class="filter-bar">
        <button class="filter-chip ${assigneeFilter === 'all' ? 'active' : ''}" data-assignee-filter="all">Tous</button>
    `;
    if (unassignedCount > 0) {
      html += `<button class="filter-chip ${assigneeFilter === '' ? 'active' : ''}" data-assignee-filter="">Non assigné (${unassignedCount})</button>`;
    }
    for (const assignee of assignees) {
      const assigneeIssueCount = assigneeCounts.get(assignee.slug) || 0;
      if (assigneeIssueCount > 0) {
        html += `<button class="filter-chip ${assigneeFilter === assignee.slug ? 'active' : ''}" data-assignee-filter="${escapeHtml(assignee.slug)}">${escapeHtml(assignee.name)} (${assigneeIssueCount})</button>`;
      }
    }
    html += `</div>`;
  }

  if (filtered.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-state-icon">${issues.length === 0 ? '📋' : '🔍'}</div>
        <div class="empty-state-text">${issues.length === 0 ? 'Aucune réserve' : 'Aucun résultat'}</div>
        <div class="empty-state-sub">${issues.length === 0 ? 'Ajoutez votre première réserve !' : 'Essayez un autre filtre.'}</div>
      </div>
    `;
  } else {
    // Group by room
    const grouped = new Map<string, Issue[]>();
    for (const issue of filtered) {
      const list = grouped.get(issue.roomSlug) || [];
      list.push(issue);
      grouped.set(issue.roomSlug, list);
    }

    const roomMap = new Map(rooms.map((r) => [r.slug, r.name]));
    const roomLetterMap = new Map(rooms.map((r) => [r.slug, r.letter || '\uffff']));
    const sortedSlugs = [...grouped.keys()].sort((a, b) =>
      (roomLetterMap.get(a) || '\uffff').localeCompare(roomLetterMap.get(b) || '\uffff')
    );

    for (const slug of sortedSlugs) {
      const roomName = roomMap.get(slug) || slug;
      const roomIssues = grouped.get(slug)!;
      roomIssues.sort((a, b) => b.createdAt - a.createdAt);

      html += `<div class="room-header">${escapeHtml(roomName)} (${roomIssues.length})</div>`;
      html += '<div class="card">';
      for (const issue of roomIssues) {
        const badge = issue.status === 'done'
          ? '<span class="badge badge-done">Terminé</span>'
          : '<span class="badge badge-open">Ouvert</span>';
        const typeBadge = typeBadgeHtml(issue.type);
        const photoIcon = issue.photos.length > 0 ? `📷 ${issue.photos.length}` : '';
        const assigneeName = issue.assigneeSlug ? assigneeMap.get(issue.assigneeSlug) || issue.assigneeSlug : '';
        const codeLabel = issue.code ? `<span class="issue-code">${escapeHtml(issue.code)}</span> ` : '';
        html += `
          <div class="issue-item" data-issue-id="${escapeHtml(issue.id)}">
            <div class="issue-info">
              <div style="display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap;">
                ${codeLabel}${typeBadge} ${badge}${assigneeName ? ` <span class="issue-meta" style="margin-top:0;">👤 ${escapeHtml(assigneeName)}</span>` : ''}
              </div>
              <div class="issue-title">${escapeHtml(issue.title)}</div>
              ${issue.description ? `<div class="issue-desc">${escapeHtml(issue.description)}</div>` : ''}
              <div class="issue-meta">
                ${new Date(issue.createdAt).toLocaleDateString('fr-FR')}
                ${photoIcon ? ` · ${photoIcon}` : ''}
              </div>
            </div>
            ${assignees.length > 0 ? `<select class="quick-assign-select" data-issue-id="${escapeHtml(issue.id)}" title="Assigner rapidement">
              <option value="" ${!issue.assigneeSlug ? 'selected' : ''}>👤</option>
              ${assignees.map((a) => `<option value="${escapeHtml(a.slug)}" ${issue.assigneeSlug === a.slug ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
            </select>` : ''}
          </div>
        `;
      }
      html += '</div>';
    }
  }

  app.innerHTML = html;

  // Status filter chips (only those with data-filter attribute)
  app.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      statusFilter = (chip as HTMLElement).dataset.filter as typeof statusFilter;
      renderListView();
    });
  });
  
  // Room filter chips
  app.querySelectorAll('[data-room-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      roomFilter = (chip as HTMLElement).dataset.roomFilter || 'all';
      renderListView();
    });
  });

  // Assignee filter chips
  app.querySelectorAll('[data-assignee-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      assigneeFilter = (chip as HTMLElement).dataset.assigneeFilter ?? 'all';
      renderListView();
    });
  });

  // Quick-assign selects
  app.querySelectorAll('.quick-assign-select').forEach((select) => {
    select.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    select.addEventListener('change', async (e) => {
      e.stopPropagation();
      const sel = e.target as HTMLSelectElement;
      const issueId = sel.dataset.issueId!;
      const newAssignee = sel.value || undefined;
      const issue = await getIssue(issueId);
      if (issue) {
        issue.assigneeSlug = newAssignee;
        issue.updatedAt = Date.now();
        await saveIssue(issue);
        issues = await getAllIssues();
        renderListView();
        const assigneeName = newAssignee ? (assignees.find((a) => a.slug === newAssignee)?.name || newAssignee) : 'personne';
        showToast(`👤 Assigné à ${assigneeName}`);
      }
    });
  });

  // Issue click -> detail
  app.querySelectorAll('.issue-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.issueId!;
      showIssueDetail(id);
    });
  });
}

// --- Issue Detail (modal) ---
async function showIssueDetail(id: string): Promise<void> {
  const issue = await getIssue(id);
  if (!issue) return;

  const roomName = rooms.find((r) => r.slug === issue.roomSlug)?.name || issue.roomSlug;
  const assigneeName = issue.assigneeSlug ? (assignees.find((a) => a.slug === issue.assigneeSlug)?.name || issue.assigneeSlug) : '';
  const photos = await getPhotosByIssue(id);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const statusBtnText = issue.status === 'open' ? '✓ Marquer terminé' : '↩ Rouvrir';
  const statusBtnClass = issue.status === 'open' ? 'btn-success' : 'btn-secondary';

  let photosHtml = '';
  for (const photo of photos) {
    try {
      const url = URL.createObjectURL(photo.blob);
      photosHtml += `<img src="${url}" class="detail-photo" data-photo-id="${escapeHtml(photo.id)}" alt="Photo" />`;
    } catch {
      // Skip
    }
  }

  const codePrefix = issue.code ? `${escapeHtml(issue.code)} — ` : '';

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>${codePrefix}${escapeHtml(issue.title)}</span>
        <button class="btn btn-sm btn-secondary" id="detail-close">✕</button>
      </div>
      <div style="margin-bottom: 0.75rem;">
        <span class="badge ${issue.status === 'done' ? 'badge-done' : 'badge-open'}">${issue.status === 'done' ? 'Terminé' : 'Ouvert'}</span>
        <span style="margin-left: 0.25rem;">${typeBadgeHtml(issue.type)}</span>
        <span style="margin-left: 0.5rem; font-size: 0.8125rem; color: var(--gray-500);">${escapeHtml(roomName)}</span>
        ${assigneeName ? `<span style="margin-left: 0.5rem; font-size: 0.8125rem; color: var(--gray-500);">· 👤 ${escapeHtml(assigneeName)}</span>` : ''}
      </div>
      ${issue.description ? `<p style="font-size: 0.9375rem; color: var(--gray-700); margin-bottom: 0.75rem;">${escapeHtml(issue.description)}</p>` : ''}
      <div style="font-size: 0.75rem; color: var(--gray-400);">
        Créé le ${new Date(issue.createdAt).toLocaleDateString('fr-FR')}
        ${issue.updatedAt !== issue.createdAt ? ` · Modifié le ${new Date(issue.updatedAt).toLocaleDateString('fr-FR')}` : ''}
      </div>
      ${photosHtml ? `<div class="detail-photos">${photosHtml}</div>` : ''}
      <div class="actions-row">
        <button class="btn ${statusBtnClass}" id="detail-toggle-status">${statusBtnText}</button>
        <button class="btn btn-sm btn-secondary" id="detail-edit">✏️ Modifier</button>
        <button class="btn btn-sm btn-danger" id="detail-delete">🗑️</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close
  overlay.querySelector('#detail-close')!.addEventListener('click', () => {
    overlay.remove();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Photo lightbox
  overlay.querySelectorAll('.detail-photo').forEach((img) => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      showLightbox((img as HTMLImageElement).src);
    });
  });

  // Toggle status
  overlay.querySelector('#detail-toggle-status')!.addEventListener('click', async () => {
    issue.status = issue.status === 'open' ? 'done' : 'open';
    issue.updatedAt = Date.now();
    await saveIssue(issue);
    issues = await getAllIssues();
    updateIssueCount();
    overlay.remove();
    renderListView();
    showToast(issue.status === 'done' ? '✅ Marqué terminé' : '↩ Réouvert');
  });

  // Edit
  overlay.querySelector('#detail-edit')!.addEventListener('click', () => {
    overlay.remove();
    showEditModal(issue);
  });

  // Delete
  overlay.querySelector('#detail-delete')!.addEventListener('click', async () => {
    if (confirm('Supprimer cette réserve ?')) {
      await deleteIssue(issue.id);
      issues = await getAllIssues();
      updateIssueCount();
      overlay.remove();
      renderListView();
      showToast('🗑️ Réserve supprimée');
    }
  });
}

function showLightbox(src: string): void {
  const lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.innerHTML = `
    <button class="lightbox-close">✕</button>
    <img src="${src}" alt="Photo agrandie" />
  `;
  document.body.appendChild(lightbox);
  lightbox.addEventListener('click', () => lightbox.remove());
}

// --- Edit Modal ---
let editPendingPhotos: PendingPhoto[] = [];
let editExistingPhotoIds: string[] = [];
let editIssueRef: Issue | null = null;

async function showEditModal(issue: Issue): Promise<void> {
  editIssueRef = issue;
  editPendingPhotos = [];
  editExistingPhotoIds = [...issue.photos];

  const existingPhotos = await getPhotosByIssue(issue.id);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'edit-modal';

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>Modifier la réserve</span>
        <button class="btn btn-sm btn-secondary" id="edit-close">✕</button>
      </div>
      <form id="edit-form">
        <div class="form-group">
          <label class="form-label" for="edit-room">Pièce</label>
          <select class="form-select" id="edit-room" required>
            ${rooms.map((r) => `<option value="${escapeHtml(r.slug)}" ${r.slug === issue.roomSlug ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-assignee">Assigné à</label>
          <select class="form-select" id="edit-assignee">
            <option value="">— Non assigné —</option>
            ${assignees.map((a) => `<option value="${escapeHtml(a.slug)}" ${issue.assigneeSlug === a.slug ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-type">Type</label>
          <select class="form-select" id="edit-type">
            <option value="reserve" ${issue.type !== 'todo' ? 'selected' : ''}>Réserve</option>
            <option value="todo" ${issue.type === 'todo' ? 'selected' : ''}>To-do</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-title">Titre</label>
          <input class="form-input" id="edit-title" type="text" value="${escapeHtml(issue.title)}" required maxlength="200" />
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-desc">Description</label>
          <textarea class="form-textarea" id="edit-desc" maxlength="1000">${escapeHtml(issue.description)}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Photos</label>
          <div class="photo-grid" id="edit-photos">
            <div class="photo-add-btn" id="edit-photo-btn-camera">
              <span>📷</span>
              <span class="photo-add-label">Caméra</span>
            </div>
            <div class="photo-add-btn" id="edit-photo-btn">
              <span>🖼️</span>
              <span class="photo-add-label">Galerie</span>
            </div>
          </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%; padding: 0.75rem;">
          💾 Enregistrer
        </button>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close
  overlay.querySelector('#edit-close')!.addEventListener('click', () => {
    cleanupEditPhotos();
    overlay.remove();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      cleanupEditPhotos();
      overlay.remove();
    }
  });

  // Photo buttons
  overlay.querySelector('#edit-photo-btn')!.addEventListener('click', () => {
    document.getElementById('edit-photo-input')!.click();
  });
  overlay.querySelector('#edit-photo-btn-camera')!.addEventListener('click', () => {
    document.getElementById('edit-photo-input-camera')!.click();
  });

  // Render existing photos
  renderEditPhotos(existingPhotos);

  // Submit
  overlay.querySelector('#edit-form')!.addEventListener('submit', handleEditSubmit);
}

let existingPhotosRef: PhotoRef[] = [];

function renderEditPhotos(existingPhotos: PhotoRef[]): void {
  existingPhotosRef = existingPhotos;
  const container = document.getElementById('edit-photos');
  if (!container) return;

  container.querySelectorAll('.photo-grid-item').forEach((el) => el.remove());
  const addBtn = document.getElementById('edit-photo-btn-camera')!;

  // Existing photos still kept
  for (const photo of existingPhotos) {
    if (!editExistingPhotoIds.includes(photo.id)) continue;
    const item = document.createElement('div');
    item.className = 'photo-grid-item';
    const url = URL.createObjectURL(photo.thumbnailBlob || photo.blob);
    item.innerHTML = `
      <img src="${url}" alt="Photo" />
      <button type="button" class="photo-remove" data-existing-id="${escapeHtml(photo.id)}">✕</button>
    `;
    container.insertBefore(item, addBtn);
  }

  // New pending photos
  for (const photo of editPendingPhotos) {
    const item = document.createElement('div');
    item.className = 'photo-grid-item';
    item.innerHTML = `
      <img src="${photo.objectUrl}" alt="Photo" />
      <button type="button" class="photo-remove" data-pending-id="${escapeHtml(photo.id)}">✕</button>
    `;
    container.insertBefore(item, addBtn);
  }

  // Bind remove buttons
  container.querySelectorAll('.photo-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existingId = (btn as HTMLElement).dataset.existingId;
      const pendingId = (btn as HTMLElement).dataset.pendingId;

      if (existingId) {
        editExistingPhotoIds = editExistingPhotoIds.filter((id) => id !== existingId);
      } else if (pendingId) {
        const idx = editPendingPhotos.findIndex((p) => p.id === pendingId);
        if (idx !== -1) {
          URL.revokeObjectURL(editPendingPhotos[idx].objectUrl);
          editPendingPhotos.splice(idx, 1);
        }
      }
      renderEditPhotos(existingPhotos);
    });
  });
}

async function handleEditPhotoInput(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  for (const file of Array.from(files)) {
    try {
      const processed = await processPhoto(file);
      editPendingPhotos.push({
        id: generateId(),
        blob: processed.blob,
        thumbnailBlob: processed.thumbnailBlob,
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
        objectUrl: URL.createObjectURL(processed.thumbnailBlob),
      });
    } catch (err) {
      console.error('Failed to process photo:', err);
    }
  }

  input.value = '';
  renderEditPhotos(existingPhotosRef);
}

async function handleEditSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (!editIssueRef) return;

  const roomSlug = (document.getElementById('edit-room') as HTMLSelectElement).value;
  const assigneeSlug = (document.getElementById('edit-assignee') as HTMLSelectElement).value || undefined;
  const issueType = (document.getElementById('edit-type') as HTMLSelectElement).value as IssueType;
  const title = (document.getElementById('edit-title') as HTMLInputElement).value.trim();
  const description = (document.getElementById('edit-desc') as HTMLTextAreaElement).value.trim();

  if (!title) return;

  // Delete removed existing photos
  const removedPhotoIds = editIssueRef.photos.filter((id) => !editExistingPhotoIds.includes(id));
  for (const photoId of removedPhotoIds) {
    await deletePhoto(photoId);
  }

  // Save new photos
  const now = Date.now();
  for (const pending of editPendingPhotos) {
    await savePhoto({
      id: pending.id,
      issueId: editIssueRef.id,
      mimeType: pending.mimeType,
      width: pending.width,
      height: pending.height,
      createdAt: now,
      blob: pending.blob,
      thumbnailBlob: pending.thumbnailBlob,
    });
    editExistingPhotoIds.push(pending.id);
    URL.revokeObjectURL(pending.objectUrl);
  }

  const roomChanged = editIssueRef.roomSlug !== roomSlug;
  editIssueRef.roomSlug = roomSlug;
  if (roomChanged || !editIssueRef.code) {
    editIssueRef.code = undefined; // clear old code before computing to avoid counting it
    editIssueRef.code = computeIssueCode(roomSlug);
  }
  editIssueRef.assigneeSlug = assigneeSlug;
  editIssueRef.type = issueType;
  editIssueRef.title = title;
  editIssueRef.description = description;
  editIssueRef.photos = editExistingPhotoIds;
  editIssueRef.updatedAt = now;

  await saveIssue(editIssueRef);
  issues = await getAllIssues();
  updateIssueCount();

  cleanupEditPhotos();
  document.getElementById('edit-modal')?.remove();
  renderListView();
  showToast('💾 Réserve modifiée');
}

function cleanupEditPhotos(): void {
  for (const p of editPendingPhotos) {
    URL.revokeObjectURL(p.objectUrl);
  }
  editPendingPhotos = [];
  editExistingPhotoIds = [];
  editIssueRef = null;
}

// --- Settings Modal ---
function showSettingsModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'settings-modal';

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>⚙️ Paramètres</span>
        <button class="btn btn-sm btn-secondary" id="settings-close">✕</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <button class="btn btn-secondary" id="settings-rooms" style="width: 100%; justify-content: flex-start; padding: 0.75rem 1rem; font-size: 0.9375rem;">🏠 Gérer les pièces</button>
        <button class="btn btn-secondary" id="settings-assignees" style="width: 100%; justify-content: flex-start; padding: 0.75rem 1rem; font-size: 0.9375rem;">👥 Gérer les assignés</button>
        <hr style="border: none; border-top: 1px solid var(--gray-200); margin: 0.25rem 0;" aria-hidden="true">
        <button class="btn btn-secondary" id="settings-export-zip" style="width: 100%; justify-content: flex-start; padding: 0.75rem 1rem; font-size: 0.9375rem;">📦 Exporter ZIP</button>
        <button class="btn btn-secondary" id="settings-import-zip" style="width: 100%; justify-content: flex-start; padding: 0.75rem 1rem; font-size: 0.9375rem;">📥 Importer ZIP</button>
        <button class="btn btn-secondary" id="settings-share" style="width: 100%; justify-content: flex-start; padding: 0.75rem 1rem; font-size: 0.9375rem;">🔗 Partager les données</button>
        <hr style="border: none; border-top: 1px solid var(--gray-200); margin: 0.25rem 0;" aria-hidden="true">
        <button class="btn btn-danger" id="settings-delete-db" style="width: 100%; justify-content: flex-start; padding: 0.75rem 1rem; font-size: 0.9375rem;">🗑️ Supprimer la base</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => {
    overlay.remove();
  };

  overlay.querySelector('#settings-close')!.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.querySelector('#settings-rooms')!.addEventListener('click', () => {
    closeModal();
    showManageRoomsModal();
  });

  overlay.querySelector('#settings-assignees')!.addEventListener('click', () => {
    closeModal();
    showManageAssigneesModal();
  });

  overlay.querySelector('#settings-export-zip')!.addEventListener('click', () => {
    closeModal();
    handleExportZip();
  });

  overlay.querySelector('#settings-import-zip')!.addEventListener('click', () => {
    closeModal();
    handleImportZipClick();
  });

  overlay.querySelector('#settings-share')!.addEventListener('click', () => {
    closeModal();
    handleShareZip();
  });

  overlay.querySelector('#settings-delete-db')!.addEventListener('click', () => {
    closeModal();
    showDeleteDatabaseModal();
  });
}

// --- Delete Database Modal ---
function showDeleteDatabaseModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'delete-db-modal';

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>🗑️ Supprimer la base</span>
        <button class="btn btn-sm btn-secondary" id="delete-db-close">✕</button>
      </div>
      <p style="margin: 0.5rem 0; color: var(--gray-700); font-size: 0.9375rem;">
        Cette action supprimera toutes les données (réserves, photos, pièces, intervenants). Cette action est irréversible.
      </p>
      <label class="form-label" for="delete-db-confirm" style="margin-top: 0.75rem;">Tapez <strong>DELETE</strong> pour confirmer :</label>
      <input type="text" id="delete-db-confirm" class="form-input" autocomplete="off" placeholder="DELETE" style="margin-top: 0.25rem;" />
      <button class="btn btn-danger" id="delete-db-btn" disabled style="width: 100%; margin-top: 0.75rem;">Supprimer</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  const confirmInput = overlay.querySelector('#delete-db-confirm') as HTMLInputElement;
  const deleteBtn = overlay.querySelector('#delete-db-btn') as HTMLButtonElement;

  confirmInput.addEventListener('input', () => {
    deleteBtn.disabled = confirmInput.value.trim() !== 'DELETE';
  });

  overlay.querySelector('#delete-db-close')!.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  deleteBtn.addEventListener('click', async () => {
    try {
      await clearAllData();
      rooms = getRooms();
      assignees = getAssignees();
      issues = await getAllIssues();
      updateIssueCount();
      renderCurrentView();
      closeModal();
      showToast('🗑️ Base de données supprimée');
    } catch (err) {
      console.error('Delete database error:', err);
      showToast('❌ Erreur lors de la suppression');
    }
  });
}

// --- Manage Rooms Modal ---
function showManageRoomsModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'rooms-modal';

  const ALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  function getUsedLetters(excludeSlug?: string): Set<string> {
    const used = new Set<string>();
    for (const r of rooms) {
      if (r.letter && r.slug !== excludeSlug) used.add(r.letter);
    }
    return used;
  }

  function letterOptions(currentLetter?: string, excludeSlug?: string): string {
    const used = getUsedLetters(excludeSlug);
    let html = '<option value="">— Aucune —</option>';
    for (const letter of ALL_LETTERS) {
      if (!used.has(letter) || letter === currentLetter) {
        html += `<option value="${letter}" ${letter === currentLetter ? 'selected' : ''}>${letter}</option>`;
      }
    }
    return html;
  }

  function renderRoomList(): string {
    if (rooms.length === 0) {
      return '<p style="color: var(--gray-500); font-size: 0.875rem; text-align: center; margin: 1rem 0;">Aucune pièce configurée</p>';
    }
    return rooms.map((r) => `
      <div class="room-row" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px solid var(--gray-100);">
        <span style="font-weight: 700; font-size: 0.875rem; color: var(--blue-700); min-width: 1.5rem; text-align: center;">${r.letter ? escapeHtml(r.letter) : '–'}</span>
        <span class="room-name-display" data-slug="${escapeHtml(r.slug)}" style="flex: 1; font-size: 0.9375rem; cursor: pointer;" title="Cliquer pour modifier">${escapeHtml(r.name)}</span>
        <button class="btn btn-sm btn-secondary room-edit" data-slug="${escapeHtml(r.slug)}" title="Modifier">✏️</button>
        <button class="btn btn-sm btn-danger room-delete" data-slug="${escapeHtml(r.slug)}" title="Supprimer">🗑️</button>
      </div>
    `).join('');
  }

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>🏠 Gérer les pièces</span>
        <button class="btn btn-sm btn-secondary" id="rooms-close">✕</button>
      </div>
      <div id="room-list">
        ${renderRoomList()}
      </div>
      <div style="margin-top: 1rem; display: flex; gap: 0.5rem; align-items: flex-end;">
        <input class="form-input" id="new-room-name" type="text" placeholder="Nom de la nouvelle pièce" maxlength="100" style="flex: 1;" />
        <select class="form-select" id="new-room-letter" style="width: 5rem; padding: 0.625rem 0.5rem;">${letterOptions()}</select>
        <button class="btn btn-primary" id="add-room-btn">➕</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function refreshList(): void {
    const listEl = document.getElementById('room-list');
    if (listEl) listEl.innerHTML = renderRoomList();
    // Refresh the letter dropdown for adding new rooms
    const letterSelect = document.getElementById('new-room-letter') as HTMLSelectElement;
    if (letterSelect) letterSelect.innerHTML = letterOptions();
    bindRoomButtons();
  }

  function bindRoomButtons(): void {
    overlay.querySelectorAll('.room-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = (btn as HTMLElement).dataset.slug!;
        const inUse = issues.some((i) => i.roomSlug === slug);
        if (inUse) {
          showToast('⚠️ Cette pièce est utilisée par des réserves');
          return;
        }
        rooms = rooms.filter((r) => r.slug !== slug);
        saveRooms(rooms);
        refreshList();
      });
    });

    overlay.querySelectorAll('.room-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = (btn as HTMLElement).dataset.slug!;
        const room = rooms.find((r) => r.slug === slug);
        if (!room) return;

        const row = btn.closest('.room-row')!;
        const nameSpan = row.querySelector('.room-name-display') as HTMLElement;
        const letterSpan = row.children[0] as HTMLElement;
        const currentName = room.name;
        const currentLetter = room.letter;

        // Replace letter badge with a select
        const letterSelect = document.createElement('select');
        letterSelect.className = 'form-select';
        letterSelect.style.cssText = 'width: 4rem; padding: 0.25rem 0.375rem; font-size: 0.875rem; min-width: 3.5rem;';
        letterSelect.innerHTML = letterOptions(currentLetter, slug);
        letterSpan.replaceWith(letterSelect);

        // Replace name with an inline edit input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input';
        input.value = currentName;
        input.maxLength = 100;
        input.style.cssText = 'flex: 1; padding: 0.25rem 0.5rem; font-size: 0.9375rem;';

        // Replace edit/delete buttons with confirm/cancel buttons
        const editBtn = row.querySelector('.room-edit') as HTMLElement | null;
        const deleteBtn = row.querySelector('.room-delete') as HTMLElement | null;
        if (!editBtn || !deleteBtn) return;

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-sm btn-primary';
        confirmBtn.title = 'Valider';
        confirmBtn.textContent = '✓';
        editBtn.replaceWith(confirmBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-sm btn-secondary';
        cancelBtn.title = 'Annuler';
        cancelBtn.textContent = '✗';
        deleteBtn.replaceWith(cancelBtn);

        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        const confirmEdit = () => {
          const newName = input.value.trim();
          const newLetter = letterSelect.value || undefined;
          if (!newName || (newName === currentName && newLetter === currentLetter)) {
            refreshList();
            return;
          }
          room.name = newName;
          room.letter = newLetter;
          rooms.sort((a, b) => (a.letter || '\uffff').localeCompare(b.letter || '\uffff'));
          saveRooms(rooms);
          refreshList();
          showToast('✅ Pièce modifiée');
        };

        confirmBtn.addEventListener('click', confirmEdit);
        cancelBtn.addEventListener('click', () => refreshList());
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmEdit();
          } else if (e.key === 'Escape') {
            refreshList();
          }
        });
      });
    });
  }

  // Close
  overlay.querySelector('#rooms-close')!.addEventListener('click', () => {
    overlay.remove();
    renderCurrentView();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      renderCurrentView();
    }
  });

  // Add room
  overlay.querySelector('#add-room-btn')!.addEventListener('click', () => {
    const input = document.getElementById('new-room-name') as HTMLInputElement;
    const letterSelect = document.getElementById('new-room-letter') as HTMLSelectElement;
    const name = input.value.trim();
    if (!name) return;
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) return;
    if (rooms.some((r) => r.slug === slug)) {
      showToast('⚠️ Cette pièce existe déjà');
      return;
    }
    const letter = letterSelect.value || undefined;
    rooms.push({ slug, name, letter });
    rooms.sort((a, b) => (a.letter || '\uffff').localeCompare(b.letter || '\uffff'));
    saveRooms(rooms);
    input.value = '';
    refreshList();
    showToast('✅ Pièce ajoutée');
  });

  // Allow Enter key to add
  overlay.querySelector('#new-room-name')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      (document.getElementById('add-room-btn') as HTMLButtonElement).click();
    }
  });

  bindRoomButtons();
}

// --- Manage Assignees Modal ---
function showManageAssigneesModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'assignees-modal';

  function renderAssigneeList(): string {
    if (assignees.length === 0) {
      return '<p style="color: var(--gray-500); font-size: 0.875rem; text-align: center; margin: 1rem 0;">Aucun assigné configuré</p>';
    }
    return assignees.map((a) => `
      <div class="assignee-row" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px solid var(--gray-100);">
        <span style="flex: 1; font-size: 0.9375rem;">${escapeHtml(a.name)}</span>
        <button class="btn btn-sm btn-danger assignee-delete" data-slug="${escapeHtml(a.slug)}" title="Supprimer">🗑️</button>
      </div>
    `).join('');
  }

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>👥 Gérer les assignés</span>
        <button class="btn btn-sm btn-secondary" id="assignees-close">✕</button>
      </div>
      <div id="assignee-list">
        ${renderAssigneeList()}
      </div>
      <div style="margin-top: 1rem; display: flex; gap: 0.5rem;">
        <input class="form-input" id="new-assignee-name" type="text" placeholder="Nom du nouvel assigné" maxlength="100" style="flex: 1;" />
        <button class="btn btn-primary" id="add-assignee-btn">➕</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function refreshList(): void {
    const listEl = document.getElementById('assignee-list');
    if (listEl) listEl.innerHTML = renderAssigneeList();
    bindDeleteButtons();
  }

  function bindDeleteButtons(): void {
    overlay.querySelectorAll('.assignee-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = (btn as HTMLElement).dataset.slug!;
        assignees = assignees.filter((a) => a.slug !== slug);
        saveAssignees(assignees);
        refreshList();
      });
    });
  }

  // Close
  overlay.querySelector('#assignees-close')!.addEventListener('click', () => {
    overlay.remove();
    renderCurrentView();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      renderCurrentView();
    }
  });

  // Add assignee
  overlay.querySelector('#add-assignee-btn')!.addEventListener('click', () => {
    const input = document.getElementById('new-assignee-name') as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) return;
    if (assignees.some((a) => a.slug === slug)) {
      showToast('⚠️ Cet assigné existe déjà');
      return;
    }
    assignees.push({ slug, name });
    assignees.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    saveAssignees(assignees);
    input.value = '';
    refreshList();
    showToast('✅ Assigné ajouté');
  });

  // Allow Enter key to add
  overlay.querySelector('#new-assignee-name')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      (document.getElementById('add-assignee-btn') as HTMLButtonElement).click();
    }
  });

  bindDeleteButtons();
}

// --- Export ---
function buildPDFFilename(): string {
  const parts = ['reserves'];
  if (roomFilter !== 'all') {
    const room = rooms.find((r) => r.slug === roomFilter);
    if (room) parts.push(room.name);
  }
  if (assigneeFilter !== 'all' && assigneeFilter !== '') {
    const assignee = assignees.find((a) => a.slug === assigneeFilter);
    if (assignee) parts.push(assignee.name);
  }
  return parts.join(' - ') + '.pdf';
}

async function performPDFExport(issuesToExport: Issue[], filename: string): Promise<void> {
  showToast('⏳ Génération du PDF...');
  try {
    await exportPDF(issuesToExport, rooms, assignees, filename);
    showToast('📄 PDF exporté !');
  } catch (err) {
    console.error('PDF export error:', err);
    showToast('❌ Erreur lors de l\'export');
  }
}

async function handleExportPDF(): Promise<void> {
  if (issues.length === 0) {
    showToast('Aucune réserve à exporter');
    return;
  }

  if (!hasActiveFilters()) {
    await performPDFExport(issues, 'reserves.pdf');
    return;
  }

  const filtered = getFilteredIssues();
  if (filtered.length === 0) {
    showToast('Aucune réserve correspondant aux filtres');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'pdf-export-modal';

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>📄 Exporter en PDF</span>
        <button class="btn btn-sm btn-secondary" id="pdf-export-close">✕</button>
      </div>
      <p style="font-size: 0.9375rem; color: var(--gray-700); margin-bottom: 0.5rem;">
        Des filtres sont actifs. Que souhaitez-vous exporter ?
      </p>
      <div class="import-modal-actions">
        <button class="btn btn-primary" id="pdf-export-filtered">📋 Exporter la sélection filtrée (${filtered.length} réserve(s))</button>
        <button class="btn btn-secondary" id="pdf-export-all">📄 Exporter tout (${issues.length} réserve(s))</button>
        <button class="btn btn-secondary" id="pdf-export-cancel">Annuler</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();

  overlay.querySelector('#pdf-export-close')!.addEventListener('click', closeModal);
  overlay.querySelector('#pdf-export-cancel')!.addEventListener('click', closeModal);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal();
  });

  overlay.querySelector('#pdf-export-filtered')!.addEventListener('click', async () => {
    closeModal();
    await performPDFExport(filtered, buildPDFFilename());
  });

  overlay.querySelector('#pdf-export-all')!.addEventListener('click', async () => {
    closeModal();
    await performPDFExport(issues, 'reserves.pdf');
  });
}

async function handleExportZip(): Promise<void> {
  if (issues.length === 0) {
    showToast('Aucune réserve à exporter');
    return;
  }
  showToast('⏳ Génération du ZIP...');
  try {
    await exportZip(issues, rooms, assignees);
    showToast('📦 ZIP exporté !');
  } catch (err) {
    console.error('ZIP export error:', err);
    showToast('❌ Erreur lors de l\'export');
  }
}

async function handleShareZip(): Promise<void> {
  if (issues.length === 0) {
    showToast('Aucune réserve à partager');
    return;
  }
  showToast('⏳ Préparation du partage...');
  try {
    await shareZip(issues, rooms, assignees);
    showToast('🔗 Données partagées !');
  } catch (err: any) {
    if (err?.name === 'AbortError') return;
    console.error('Share error:', err);
    showToast('❌ ' + (err?.message || 'Erreur lors du partage'));
  }
}

// --- Import ---
function handleImportZipClick(): void {
  (document.getElementById('import-zip-input') as HTMLInputElement).value = '';
  document.getElementById('import-zip-input')!.click();
}

async function handleImportZipFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  // Check if there is existing data
  if (issues.length > 0) {
    showImportConflictModal(file);
  } else {
    await performImport(file, 'replace');
  }
}

function showImportConflictModal(file: File): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'import-modal';

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>📥 Importer des données</span>
        <button class="btn btn-sm btn-secondary" id="import-close">✕</button>
      </div>
      <p style="font-size: 0.9375rem; color: var(--gray-700); margin-bottom: 0.5rem;">
        Il y a déjà <strong>${issues.length} réserve(s)</strong> enregistrée(s). Que souhaitez-vous faire ?
      </p>
      <div class="import-modal-actions">
        <button class="btn btn-primary" id="import-merge">🔀 Fusionner — Ajouter les données importées aux données existantes</button>
        <button class="btn btn-danger" id="import-replace">🗑️ Remplacer — Supprimer les données existantes et les remplacer</button>
        <button class="btn btn-secondary" id="import-cancel">Annuler</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();

  overlay.querySelector('#import-close')!.addEventListener('click', closeModal);
  overlay.querySelector('#import-cancel')!.addEventListener('click', closeModal);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal();
  });

  overlay.querySelector('#import-merge')!.addEventListener('click', async () => {
    closeModal();
    await performImport(file, 'merge');
  });

  overlay.querySelector('#import-replace')!.addEventListener('click', async () => {
    closeModal();
    await performImport(file, 'replace');
  });
}

async function performImport(file: File, mode: ImportMode): Promise<void> {
  showToast('⏳ Importation en cours...');
  try {
    const result = await importZip(file, mode);
    // Reload data
    rooms = getRooms();
    assignees = getAssignees();
    issues = await getAllIssues();
    updateIssueCount();
    renderCurrentView();
    showToast(`📥 Importé : ${result.issueCount} réserve(s), ${result.photoCount} photo(s), ${result.roomCount} pièce(s), ${result.assigneeCount} intervenant(s)`);
  } catch (err) {
    console.error('Import error:', err);
    showToast('❌ Erreur lors de l\'importation');
  }
}

// --- Start ---
init().catch(console.error);
