// ZIP export and import functionality
import JSZip from 'jszip';
import type { Issue, PhotoRef, Room } from './types.ts';
import { getPhotosByIssue, saveIssue, savePhoto, clearAllData } from './db.ts';

export async function exportZip(issues: Issue[], rooms: Room[]): Promise<void> {
  const zip = new JSZip();
  const roomMap = new Map(rooms.map((r) => [r.slug, r.name]));

  // Create img folder
  const imgFolder = zip.folder('img');
  if (!imgFolder) throw new Error('Failed to create img folder');

  // Track photo filenames to avoid duplicates
  const usedFilenames = new Set<string>();

  // Safe image extensions allowlist
  const SAFE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  const DEFAULT_EXTENSION = 'jpg';

  // Collect all data for JSON and markdown
  const exportDate = new Date();
  const exportData = {
    exportDate: exportDate.toISOString(),
    totalIssues: issues.length,
    openIssues: issues.filter((i) => i.status === 'open').length,
    doneIssues: issues.filter((i) => i.status === 'done').length,
    rooms: rooms,
    issues: [] as any[],
  };

  // Prepare markdown content
  let markdownContent = `# Réserves chantier — Pasfini\n\n`;
  markdownContent += `**Exporté le :** ${exportDate.toLocaleDateString('fr-FR')} à ${exportDate.toLocaleTimeString('fr-FR')}\n\n`;
  markdownContent += `**Total :** ${issues.length} réserve(s) — ${exportData.openIssues} ouverte(s), ${exportData.doneIssues} terminée(s)\n\n`;
  markdownContent += `---\n\n`;

  // Group issues by room
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.roomSlug) || [];
    list.push(issue);
    grouped.set(issue.roomSlug, list);
  }

  // Sort rooms by name
  const sortedSlugs = [...grouped.keys()].sort((a, b) =>
    (roomMap.get(a) || a).localeCompare(roomMap.get(b) || b, 'fr')
  );

  // Helper function to create issue export data
  const createIssueExportData = (issue: Issue, roomName: string, photoDetails: { path: string; id: string; mimeType: string; width: number; height: number; thumbnailPath: string; createdAt: string }[]) => ({
    id: issue.id,
    roomSlug: issue.roomSlug,
    roomName: roomName,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    createdAt: new Date(issue.createdAt).toISOString(),
    updatedAt: new Date(issue.updatedAt).toISOString(),
    photoCount: photoDetails.length,
    photos: photoDetails,
  });

  // Process each room
  for (const slug of sortedSlugs) {
    const roomIssues = grouped.get(slug)!;
    const roomName = roomMap.get(slug) || slug;

    markdownContent += `## ${roomName}\n\n`;

    for (const issue of roomIssues) {
      const statusIcon = issue.status === 'done' ? '✅' : '⏳';
      const statusText = issue.status === 'done' ? 'Terminée' : 'Ouverte';

      markdownContent += `### ${statusIcon} ${issue.title}\n\n`;
      markdownContent += `**Statut :** ${statusText}\n\n`;
      markdownContent += `**Pièce :** ${roomName}\n\n`;

      if (issue.description) {
        markdownContent += `**Description :**\n\n${issue.description}\n\n`;
      }

      const createdDate = new Date(issue.createdAt);
      const updatedDate = new Date(issue.updatedAt);
      markdownContent += `**Créée le :** ${createdDate.toLocaleDateString('fr-FR')} à ${createdDate.toLocaleTimeString('fr-FR')}\n\n`;
      markdownContent += `**Modifiée le :** ${updatedDate.toLocaleDateString('fr-FR')} à ${updatedDate.toLocaleTimeString('fr-FR')}\n\n`;

      // Fetch and add photos
      try {
        const photos = await getPhotosByIssue(issue.id);
        const photoDetails: { path: string; id: string; mimeType: string; width: number; height: number; thumbnailPath: string; createdAt: string }[] = [];

        if (photos.length > 0) {
          for (let i = 0; i < photos.length; i++) {
            const photo = photos[i];
            
            // Safely extract and validate file extension
            const mimeType = photo.mimeType || 'image/jpeg';
            let extension = DEFAULT_EXTENSION;
            if (mimeType.includes('/')) {
              const extractedExt = mimeType.split('/')[1].toLowerCase();
              if (SAFE_EXTENSIONS.includes(extractedExt)) {
                extension = extractedExt;
              }
            }
            
            // Generate unique filename
            const baseFilename = `${issue.id}-${i + 1}`;
            let filename = `${baseFilename}.${extension}`;
            let counter = 1;
            
            // Ensure filename is unique
            while (usedFilenames.has(filename)) {
              filename = `${baseFilename}-${counter}.${extension}`;
              counter++;
            }
            usedFilenames.add(filename);

            // Generate unique thumbnail filename
            const thumbBaseFilename = `${issue.id}-${i + 1}-thumb`;
            let thumbFilename = `${thumbBaseFilename}.${extension}`;
            let thumbCounter = 1;
            while (usedFilenames.has(thumbFilename)) {
              thumbFilename = `${thumbBaseFilename}-${thumbCounter}.${extension}`;
              thumbCounter++;
            }
            usedFilenames.add(thumbFilename);

            // Add photo and thumbnail to zip
            imgFolder.file(filename, photo.blob);
            imgFolder.file(thumbFilename, photo.thumbnailBlob);
            photoDetails.push({
              path: `img/${filename}`,
              id: photo.id,
              mimeType: photo.mimeType,
              width: photo.width,
              height: photo.height,
              thumbnailPath: `img/${thumbFilename}`,
              createdAt: new Date(photo.createdAt).toISOString(),
            });
          }

          markdownContent += `**Photos :** ${photos.length}\n\n`;
          for (const detail of photoDetails) {
            markdownContent += `![Photo](${detail.path})\n\n`;
          }
        } else {
          markdownContent += `**Photos :** Aucune\n\n`;
        }

        // Add to JSON data
        exportData.issues.push(createIssueExportData(issue, roomName, photoDetails));
      } catch (err) {
        console.error('Error processing photos for issue:', issue.id, err);
        markdownContent += `**Photos :** Erreur de chargement\n\n`;
        
        exportData.issues.push(createIssueExportData(issue, roomName, []));
      }

      markdownContent += `---\n\n`;
    }
  }

  // Add markdown file to zip
  zip.file('report.md', markdownContent);

  // Add JSON file to zip
  zip.file('report.json', JSON.stringify(exportData, null, 2));

  // Generate and download zip file
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pasfini-reserves-${exportDate.toISOString().split('T')[0]}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// --- Import ZIP ---

export type ImportMode = 'replace' | 'merge';

export async function importZip(file: File, mode: ImportMode): Promise<{ issueCount: number; photoCount: number }> {
  const zip = await JSZip.loadAsync(file);

  // Read report.json
  const reportFile = zip.file('report.json');
  if (!reportFile) {
    throw new Error('Fichier report.json introuvable dans le ZIP');
  }

  const reportText = await reportFile.async('string');
  const reportData = JSON.parse(reportText);

  if (!reportData.issues || !Array.isArray(reportData.issues)) {
    throw new Error('Format de données invalide dans report.json');
  }

  // Safe image extensions allowlist
  const SAFE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

  // If replacing, clear all existing data
  if (mode === 'replace') {
    await clearAllData();
  }

  // Restore rooms if present
  if (reportData.rooms && Array.isArray(reportData.rooms)) {
    const validRooms = reportData.rooms.filter(
      (r: unknown): r is Room =>
        typeof r === 'object' && r !== null &&
        typeof (r as Room).slug === 'string' && (r as Room).slug.length > 0 &&
        typeof (r as Room).name === 'string' && (r as Room).name.length > 0
    );
    if (validRooms.length > 0) {
      localStorage.setItem('rooms', JSON.stringify(validRooms));
    }
  }

  let issueCount = 0;
  let photoCount = 0;

  for (const issueData of reportData.issues) {
    // Validate required fields
    if (!issueData.id || !issueData.roomSlug || !issueData.title) {
      continue;
    }

    const status = issueData.status === 'done' ? 'done' : 'open';

    // Restore photos
    const photoIds: string[] = [];
    if (issueData.photos && Array.isArray(issueData.photos)) {
      for (const photoData of issueData.photos) {
        // Support both old format (string paths) and new format (objects with metadata)
        const isOldFormat = typeof photoData === 'string';
        const photoPath = isOldFormat ? photoData : photoData.path;
        if (!photoPath) continue;

        // Validate file extension from path
        const pathExtension = photoPath.split('.').pop()?.toLowerCase();
        if (!pathExtension || !SAFE_EXTENSIONS.includes(pathExtension)) continue;

        const photoFile = zip.file(photoPath);
        if (!photoFile) continue;

        const blob = await photoFile.async('blob');

        // Try to load thumbnail
        let thumbnailBlob: Blob;
        const thumbPath = isOldFormat ? null : photoData.thumbnailPath;
        if (thumbPath) {
          const thumbExtension = thumbPath.split('.').pop()?.toLowerCase();
          if (thumbExtension && SAFE_EXTENSIONS.includes(thumbExtension)) {
            const thumbFile = zip.file(thumbPath);
            if (thumbFile) {
              thumbnailBlob = await thumbFile.async('blob');
            } else {
              thumbnailBlob = blob;
            }
          } else {
            thumbnailBlob = blob;
          }
        } else {
          thumbnailBlob = blob;
        }

        const photoId = isOldFormat ? crypto.randomUUID() : (photoData.id || crypto.randomUUID());
        const mimeType = isOldFormat ? `image/${pathExtension === 'jpg' ? 'jpeg' : pathExtension}` : (photoData.mimeType || 'image/jpeg');
        const width = isOldFormat ? 0 : (photoData.width || 0);
        const height = isOldFormat ? 0 : (photoData.height || 0);
        const photoCreatedAt = isOldFormat ? Date.now() : (photoData.createdAt ? new Date(photoData.createdAt).getTime() : Date.now());

        const photoRef: PhotoRef = {
          id: photoId,
          issueId: issueData.id,
          mimeType,
          width,
          height,
          createdAt: photoCreatedAt,
          blob,
          thumbnailBlob,
        };

        await savePhoto(photoRef);
        photoIds.push(photoId);
        photoCount++;
      }
    }

    const issue: Issue = {
      id: issueData.id,
      roomSlug: issueData.roomSlug,
      title: issueData.title,
      description: issueData.description || '',
      status,
      createdAt: issueData.createdAt ? new Date(issueData.createdAt).getTime() : Date.now(),
      updatedAt: issueData.updatedAt ? new Date(issueData.updatedAt).getTime() : Date.now(),
      photos: photoIds,
    };

    await saveIssue(issue);
    issueCount++;
  }

  return { issueCount, photoCount };
}
