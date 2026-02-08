// Main application entry point
import type { Issue, PhotoRef, Room } from './types.ts';
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
} from './db.ts';
import { generateId, processPhoto } from './photos.ts';
import { exportPDF } from './pdf.ts';
import { exportZip } from './zip.ts';

// --- State ---
let rooms: Room[] = [];
let issues: Issue[] = [];
let currentView: 'add' | 'list' = 'add';
let statusFilter: 'all' | 'open' | 'done' = 'all';

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

// --- Initialization ---
async function init(): Promise<void> {
  rooms = getRooms();
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

  // Photo input (add form)
  document.getElementById('photo-input')!.addEventListener('change', handlePhotoInput);
  document.getElementById('photo-input-camera')!.addEventListener('change', handlePhotoInput);
  // Photo input (edit form)
  document.getElementById('edit-photo-input')!.addEventListener('change', handleEditPhotoInput);
  document.getElementById('edit-photo-input-camera')!.addEventListener('change', handleEditPhotoInput);

  // Paste functionality for images
  document.addEventListener('paste', handlePaste);

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
    roomSlug,
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

// --- List View ---
function renderListView(): void {
  const filtered = statusFilter === 'all'
    ? issues
    : issues.filter((i) => i.status === statusFilter);

  const openCount = issues.filter((i) => i.status === 'open').length;
  const doneCount = issues.filter((i) => i.status === 'done').length;

  let html = `
    <div class="filter-bar">
      <button class="filter-chip ${statusFilter === 'all' ? 'active' : ''}" data-filter="all">Tout (${issues.length})</button>
      <button class="filter-chip ${statusFilter === 'open' ? 'active' : ''}" data-filter="open">Ouvert (${openCount})</button>
      <button class="filter-chip ${statusFilter === 'done' ? 'active' : ''}" data-filter="done">Terminé (${doneCount})</button>
    </div>
  `;

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
    const sortedSlugs = [...grouped.keys()].sort((a, b) =>
      (roomMap.get(a) || a).localeCompare(roomMap.get(b) || b, 'fr')
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
        const photoIcon = issue.photos.length > 0 ? `📷 ${issue.photos.length}` : '';
        html += `
          <div class="issue-item" data-issue-id="${escapeHtml(issue.id)}">
            <div class="issue-info">
              <div class="flex-between">
                <div class="issue-title">${escapeHtml(issue.title)}</div>
                ${badge}
              </div>
              ${issue.description ? `<div class="issue-desc">${escapeHtml(issue.description)}</div>` : ''}
              <div class="issue-meta">
                ${new Date(issue.createdAt).toLocaleDateString('fr-FR')}
                ${photoIcon ? ` · ${photoIcon}` : ''}
              </div>
            </div>
          </div>
        `;
      }
      html += '</div>';
    }
  }

  app.innerHTML = html;

  // Filter chips
  app.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      statusFilter = (chip as HTMLElement).dataset.filter as typeof statusFilter;
      renderListView();
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

  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">
        <span>${escapeHtml(issue.title)}</span>
        <button class="btn btn-sm btn-secondary" id="detail-close">✕</button>
      </div>
      <div style="margin-bottom: 0.75rem;">
        <span class="badge ${issue.status === 'done' ? 'badge-done' : 'badge-open'}">${issue.status === 'done' ? 'Terminé' : 'Ouvert'}</span>
        <span style="margin-left: 0.5rem; font-size: 0.8125rem; color: var(--gray-500);">${escapeHtml(roomName)}</span>
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

  editIssueRef.roomSlug = roomSlug;
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

// --- Export ---
async function handleExportPDF(): Promise<void> {
  if (issues.length === 0) {
    showToast('Aucune réserve à exporter');
    return;
  }
  showToast('⏳ Génération du PDF...');
  try {
    await exportPDF(issues, rooms);
    showToast('📄 PDF exporté !');
  } catch (err) {
    console.error('PDF export error:', err);
    showToast('❌ Erreur lors de l\'export');
  }
}

async function handleExportZip(): Promise<void> {
  if (issues.length === 0) {
    showToast('Aucune réserve à exporter');
    return;
  }
  showToast('⏳ Génération du ZIP...');
  try {
    await exportZip(issues, rooms);
    showToast('📦 ZIP exporté !');
  } catch (err) {
    console.error('ZIP export error:', err);
    showToast('❌ Erreur lors de l\'export');
  }
}

// --- Start ---
init().catch(console.error);
